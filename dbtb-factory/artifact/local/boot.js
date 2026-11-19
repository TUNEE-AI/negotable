// 브라우저 데모 부팅: 같은 API 코드를 데모 엔진으로 실행하고 프론트엔드에 연결한다.
import { registerApi } from '../lib/api.js';
import { createMiniApp } from './mini-app.js';
import { createBrowserStore } from './browser-store.js';

const app = createMiniApp();
const ai = { mock: true, model: 'demo-engine', async json() { throw new Error('demo'); } };
registerApi(app, { store: createBrowserStore(), ai, config: {} });

window.__dbtbLocal = async (method, url, body, owner) => {
  await new Promise((r) => setTimeout(r, 60)); // 네트워크처럼 아주 짧게 지연
  return app.handle(method, url, body, { 'x-dbtb-owner': owner, 'content-type': 'application/json' });
};
