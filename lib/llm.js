// ─────────────────────────────────────────────────────────────
// LLM 호출 계층 (서버 전용)
//
// - API 키는 서버 환경변수에서만 읽습니다. 브라우저로는 절대 나가지 않습니다.
// - 구조화된 결과가 필요하므로 "도구 호출 강제(tool_choice)"로 JSON을 받습니다.
//   (모델이 자유 텍스트 대신 스키마에 맞는 JSON을 채우게 됩니다.)
// - 외부 SDK 없이 fetch만 사용합니다.
// ─────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export class LLMError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * 시스템 프롬프트 중 매번 같은 앞부분(행동 원칙·규칙)을 캐시해, AI가 매 호출마다 다시 읽지 않게 한다.
 * <negotiation_state> 앞까지가 고정 부분이고 그 뒤(현재 상태·정정 지시)는 매번 달라진다.
 * 고정 부분이 모델의 최소 캐시 길이보다 짧으면 API가 조용히 캐시하지 않을 뿐 오류는 없다.
 */
const CACHE_SPLIT = '<negotiation_state>';
export function cacheableSystem(system) {
  const i = typeof system === 'string' ? system.indexOf(CACHE_SPLIT) : -1;
  if (i <= 0) return system;
  return [
    { type: 'text', text: system.slice(0, i), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system.slice(i) },
  ];
}

/** 호출마다 걸린 시간과 토큰 수를 로그로 남긴다(응답 지연 원인 확인용). */
export function logTiming(tag, toolName, started, inTok, outTok, cachedTok) {
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  const tok = inTok != null || outTok != null ? ` in=${inTok ?? '?'} out=${outTok ?? '?'}${cachedTok ? ` cached=${cachedTok}` : ''}` : '';
  console.log(`[${tag}] ${toolName} ${sec}s${tok}`);
}

/**
 * @param {{apiKey: string, model: string, timeoutMs?: number}} opts
 * @returns {(req: {system: string, messages: Array, tool: object, maxTokens?: number}) => Promise<object>}
 *          도구 입력(JSON 객체)을 반환하는 함수
 */
export function createAnthropicLLM({ apiKey, model, timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 60_000, baseUrl = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE }) {
  if (!apiKey) {
    // 키가 없으면 호출 시점에 명확한 오류를 냅니다(서버는 그대로 뜹니다).
    return async () => {
      throw new LLMError('서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.', { status: 503 });
    };
  }

  // effort(output_config.effort)를 받는 모델에만 보낸다. 지원하지 않는 모델(Haiku 4.5 등)은 400을 낸다.
  const supportsEffort = /opus-4-[5-9]|opus-5|sonnet-4-6|sonnet-5|fable|mythos/.test(model);
  // 최신 모델(Sonnet 5 등)은 thinking을 생략하면 답하기 전에 숨은 "생각"을 먼저 만든다(adaptive).
  // 그 시간이 응답 지연의 큰 부분이라, 요청이 noThinking이면 명시적으로 끈다.
  // (Fable·Opus 5.5·Mythos는 끌 수 없어 보내지 않는다 — 그 모델들은 이 앱의 강제 도구 호출도 지원하지 않는다.)
  const canDisableThinking = !/fable|opus-5-5|mythos/.test(model);

  async function once({ system, messages, tool, maxTokens, effort, noThinking }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await fetch(baseUrl + '/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: cacheableSystem(system),
          messages,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
          ...(effort && supportsEffort ? { output_config: { effort } } : {}),
          ...(noThinking && canDisableThinking ? { thinking: { type: 'disabled' } } : {}),
        }),
      });
    } catch (err) {
      // 시간 초과는 재시도하지 않는다. 이미 오래 기다린 요청을 처음부터 다시 부르면
      // 사용자 대기 시간만 두 배가 된다(연결 실패처럼 금방 끝난 오류만 재시도).
      const aborted = err?.name === 'AbortError';
      throw new LLMError(aborted ? 'AI 응답 시간이 초과되었습니다.' : 'AI 서버에 연결하지 못했습니다.', {
        status: 504,
        retryable: !aborted,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || '';
      } catch {}
      console.error(`[llm] HTTP ${res.status} ${detail}`);
      throw new LLMError(
        res.status === 401 ? 'AI API 키가 올바르지 않습니다.' : 'AI가 잠시 응답하지 못했습니다.',
        { status: res.status === 401 ? 503 : 502, retryable },
      );
    }

    const data = await res.json();
    logTiming('llm', tool.name, started, data.usage?.input_tokens, data.usage?.output_tokens, data.usage?.cache_read_input_tokens);
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (!block || typeof block.input !== 'object') {
      throw new LLMError('AI 응답 형식이 올바르지 않았습니다.', { status: 502, retryable: true });
    }
    return block.input;
  }

  // 일시적 오류(429/5xx/타임아웃)는 1회 재시도합니다.
  return async function callTool(req) {
    const args = { maxTokens: 3000, ...req };
    try {
      return await once(args);
    } catch (err) {
      if (err instanceof LLMError && err.retryable) {
        await new Promise((r) => setTimeout(r, 800));
        return once(args);
      }
      throw err;
    }
  };
}
