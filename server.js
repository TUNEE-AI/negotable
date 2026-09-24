import fs from 'node:fs';
import { createApp } from './app.js';
import { createAnthropicLLM } from './lib/llm.js';
import { createOpenRouterLLM } from './lib/llm-openrouter.js';

// .env 를 아주 단순하게 읽습니다(별도 패키지 없이). 호스팅 서비스의 환경변수가 우선합니다.
try {
  for (const line of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
} catch {}

// .env 를 읽은 뒤에 config 를 불러와야 환경변수가 반영됩니다(그래서 동적 import)
const { default: cfg } = await import('./config.js');

const looksUnset = (v) => !v || v.includes('여기에');

let llm;
if (cfg.llmProvider === 'openrouter') {
  if (looksUnset(cfg.openrouterApiKey)) {
    console.warn('⚠️  OPENROUTER_API_KEY 가 설정되지 않았습니다. 화면은 뜨지만 AI 대화는 동작하지 않습니다.');
  }
  llm = createOpenRouterLLM({
    apiKey: looksUnset(cfg.openrouterApiKey) ? '' : cfg.openrouterApiKey,
    model: cfg.openrouterModel,
    allowPaidModel: cfg.allowPaidOpenrouterModel,
  });
  console.log(`AI 제공사: OpenRouter (model: ${cfg.openrouterModel})`);
} else {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (looksUnset(apiKey)) {
    console.warn('⚠️  ANTHROPIC_API_KEY 가 설정되지 않았습니다. 화면은 뜨지만 AI 대화는 동작하지 않습니다.');
  }
  llm = createAnthropicLLM({ apiKey: looksUnset(apiKey) ? '' : apiKey, model: cfg.model });
}

const app = createApp({ llm, config: cfg });

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`NegoTable → http://localhost:${port}`));
