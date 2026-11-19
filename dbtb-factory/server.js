import fs from 'node:fs';
import { createApp } from './app.js';
import { createStore } from './lib/store.js';
import { createAI } from './lib/ai.js';

// .env 를 단순하게 읽습니다(호스팅 환경변수가 우선).
try {
  for (const line of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const apiKey = (process.env.ANTHROPIC_API_KEY || '').includes('여기에') ? '' : process.env.ANTHROPIC_API_KEY;
const ai = createAI({
  apiKey,
  model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 120_000,
  useFallbacks: process.env.AI_FALLBACKS !== 'off',
});
if (ai.mock) console.warn('⚠️  ANTHROPIC_API_KEY 가 없어 "데모 엔진"으로 동작합니다(결과에 데모 표시).');
else console.log(`AI 모델: ${ai.model}`);

const store = createStore(process.env.DATA_FILE || new URL('./data/db.json', import.meta.url).pathname);
const app = createApp({ store, ai });
const port = Number(process.env.PORT || 3100);
app.listen(port, () => console.log(`DBTB FACTORY → http://localhost:${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
