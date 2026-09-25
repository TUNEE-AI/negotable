// ─────────────────────────────────────────────────────────────
// OpenRouter 어댑터 — createAnthropicLLM과 완전히 같은 인터페이스를 씁니다.
//
//   const llm = createOpenRouterLLM({ apiKey, model });
//   const args = await llm({ system, messages, tool, maxTokens });
//
// OpenRouter는 OpenAI 호환 형식(chat/completions + tools/tool_calls)을 쓰기 때문에,
// Anthropic의 messages API(tool_choice + content 블록)와는 요청·응답 모양이 다릅니다.
// 그 차이를 이 파일 안에서만 흡수하고, 바깥(negotiation.js 등)은 그대로 씁니다.
//
// 무료 모델을 쓰실 거라면 반드시 "도구 호출(tool calling)"을 지원하는 모델을 고르세요.
// 예: openai/gpt-oss-120b:free, openai/gpt-oss-20b:free, deepseek/deepseek-v4-flash:free
// (OpenRouter의 모델 목록에서 "supports tool calling" 여부는 수시로 바뀔 수 있으니
//  실제로 쓰기 전에 https://openrouter.ai/models?supported_parameters=tools 에서 확인하세요.)
// ─────────────────────────────────────────────────────────────

import { LLMError, logTiming } from './llm.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function createOpenRouterLLM({
  apiKey,
  model,
  timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 60_000,
  siteUrl = '',
  siteName = 'NegoTable',
  allowPaidModel = false,
  // 추론(생각) 모델은 답하기 전에 숨은 생각 토큰을 길게 만들어 응답이 크게 느려진다.
  // 이 앱의 작업(대화 정리·JSON 작성)에는 깊은 추론이 필요 없으므로 기본은 'low'.
  // 추론을 지원하지 않는 모델에서는 OpenRouter가 이 값을 무시한다. 빈 문자열이면 보내지 않는다.
  reasoningEffort = process.env.OPENROUTER_REASONING_EFFORT ?? 'low',
}) {
  if (!apiKey) {
    return async () => {
      throw new LLMError('서버에 OPENROUTER_API_KEY가 설정되지 않았습니다.', { status: 503 });
    };
  }

  // 안전장치: 모델 이름에 ":free"가 없으면 과금될 수 있는 모델이다.
  // 실수로(오타·복사 실수 등) 유료 모델을 넣었다가 모르고 과금되는 사고를 막기 위해,
  // 명시적으로 ALLOW_PAID_OPENROUTER_MODEL=true 를 설정하지 않는 한 시작 자체를 막는다.
  const looksFree = model.endsWith(':free') || model === 'openrouter/free';
  if (!looksFree && !allowPaidModel) {
    return async () => {
      throw new LLMError(
        `OPENROUTER_MODEL("${model}")이 무료 모델이 아닌 것 같습니다. 과금을 막기 위해 호출을 중단했습니다. ` +
          `정말 이 모델을 쓰려면 서버에 ALLOW_PAID_OPENROUTER_MODEL=true 를 함께 설정하세요.`,
        { status: 503 },
      );
    };
  }

  async function once({ system, messages, tool, maxTokens }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          // OpenRouter 순위 페이지에 앱을 표시하기 위한 선택 헤더. 없어도 동작에는 지장 없다.
          ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
          ...(siteName ? { 'X-Title': siteName } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
          tools: [
            {
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
            },
          ],
          tool_choice: { type: 'function', function: { name: tool.name } },
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
        }),
      });
    } catch (err) {
      // 시간 초과는 재시도하지 않는다(대기 시간만 두 배가 됨). 연결 실패만 재시도.
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
      console.error(`[llm:openrouter] HTTP ${res.status} ${detail}`);
      throw new LLMError(
        res.status === 401 ? 'AI API 키가 올바르지 않습니다.' : 'AI가 잠시 응답하지 못했습니다.',
        { status: res.status === 401 ? 503 : 502, retryable },
      );
    }

    const data = await res.json();
    logTiming('llm:openrouter', tool.name, started, data.usage?.prompt_tokens, data.usage?.completion_tokens);
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    let raw = call?.function?.arguments;

    // 일부 무료·소형 모델은 강제 도구 호출을 무시하고 본문에 JSON 텍스트만 돌려주기도 한다.
    // 그 경우를 대비해, 본문(content)에서라도 JSON을 하나 더 찾아본다.
    if (!raw) {
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        const match = content.match(/\{[\s\S]*\}/);
        raw = match?.[0];
      }
    }
    if (!raw) {
      throw new LLMError('AI 응답 형식이 올바르지 않았습니다. (이 모델이 도구 호출을 지원하지 않을 수 있습니다)', {
        status: 502,
        retryable: true,
      });
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new LLMError('AI 응답을 해석하지 못했습니다.', { status: 502, retryable: true });
    }
  }

  // 일시적 오류(429/5xx/타임아웃/형식 오류)는 1회 재시도한다.
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
