// ─────────────────────────────────────────────────────────────
// AI 호출 계층 (서버 전용).
// - 공식 Anthropic SDK 를 사용합니다. API 키는 서버 환경변수에서만 읽습니다.
// - 구조화 결과는 structured outputs(output_config.format = json_schema)로 받습니다.
// - 키가 없으면 "데모 엔진"으로 동작합니다(결과에 데모임을 명확히 표시).
// ─────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';

export class AIError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * @returns {{ mock: boolean, model: string, json: (req: {system: string, user: string, schema: object, effort?: string, maxTokens?: number, tag?: string}) => Promise<{data: object, usage: object}> }}
 */
export function createAI({ apiKey, model = 'claude-opus-5-5', timeoutMs = 120_000, useFallbacks = true } = {}) {
  if (!apiKey) {
    return {
      mock: true,
      model: 'demo-engine',
      async json() {
        throw new AIError('데모 엔진은 json() 을 호출하지 않습니다.', { status: 500 });
      },
    };
  }

  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });

  async function json({ system, user, schema, effort = 'medium', maxTokens = 16000, tag = 'ai' }) {
    const started = Date.now();
    let res;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: { type: 'json_schema', schema } },
        ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AIError('AI API 키가 올바르지 않습니다.', { status: 503 });
      if (err instanceof Anthropic.RateLimitError) throw new AIError('AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.', { status: 429, retryable: true });
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AIError('AI 응답 시간이 초과되었습니다.', { status: 504, retryable: true });
      if (err instanceof Anthropic.APIConnectionError) throw new AIError('AI 서버에 연결하지 못했습니다.', { status: 504, retryable: true });
      if (err instanceof Anthropic.APIError) {
        console.error(`[ai] HTTP ${err.status} ${err.message}`);
        throw new AIError('AI가 잠시 응답하지 못했습니다.', { status: 502, retryable: (err.status ?? 500) >= 500 });
      }
      throw err;
    }

    const usage = { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, model: res.model, ms: Date.now() - started };
    console.log(`[${tag}] ${((Date.now() - started) / 1000).toFixed(1)}s in=${usage.input_tokens} out=${usage.output_tokens} model=${res.model}`);

    if (res.stop_reason === 'refusal') throw new AIError('AI가 이 요청을 처리하지 않았습니다. 입력 내용을 바꿔 다시 시도하세요.', { status: 422 });
    if (res.stop_reason === 'max_tokens') throw new AIError('AI 응답이 너무 길어 중간에 끊겼습니다. 재료를 줄여 다시 시도하세요.', { status: 502, retryable: true });

    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return { data: JSON.parse(text), usage };
    } catch {
      throw new AIError('AI 응답 형식이 올바르지 않았습니다.', { status: 502, retryable: true });
    }
  }

  return { mock: false, model, json };
}
