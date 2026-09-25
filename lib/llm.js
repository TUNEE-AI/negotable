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

/** 호출마다 걸린 시간과 토큰 수를 로그로 남긴다(응답 지연 원인 확인용). */
export function logTiming(tag, toolName, started, inTok, outTok) {
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  const tok = inTok != null || outTok != null ? ` in=${inTok ?? '?'} out=${outTok ?? '?'}` : '';
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

  async function once({ system, messages, tool, maxTokens, effort }) {
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
          system,
          messages,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
          ...(effort && supportsEffort ? { output_config: { effort } } : {}),
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
    logTiming('llm', tool.name, started, data.usage?.input_tokens, data.usage?.output_tokens);
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
