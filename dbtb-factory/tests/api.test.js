// PRD 13.1 핵심 E2E 인수 테스트 (API 수준). 데모 엔진/가짜 AI 사용 — 키 불필요.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createStore } from '../lib/store.js';
import { createAI, AIError } from '../lib/ai.js';
import { transition } from '../lib/status.js';

const OWNER = 'test_owner_1234567890';

async function boot({ ai = createAI({}), fetchImpl } = {}) {
  const store = createStore(null);
  const app = createApp({ store, ai, config: { fetchImpl } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, owner = OWNER) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-dbtb-owner': owner }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { call, store, close: () => server.close() };
}

async function waitRun(call, id) {
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', `/api/runs/${id}`);
    if (['succeeded', 'failed'].includes(r.body.state)) return r.body;
    await new Promise((x) => setTimeout(x, 20));
  }
  throw new Error('run timeout');
}

test('상태 전이는 뒤로 가지 않는다', () => {
  assert.equal(transition('DRAFT', 'project_defined'), 'PROJECT_READY');
  assert.equal(transition('WAREHOUSED', 'material_added'), 'WAREHOUSED');
  assert.equal(transition('REVIEWED', 'reprocess_chosen'), 'PROCESSING_NEW_VERSION');
});

test('전체 공정: 프로젝트 → 원재료 → 가공 → 재가공 → 검수 → 실험실 → 조립 → 창고 → 외부 이관', async () => {
  const { call, close } = await boot({
    fetchImpl: async () => ({ ok: true, json: async () => ({ docs: [{ key: '/works/OL1W', title: '린 스타트업', author_name: ['에릭 리스'], first_publish_year: 2011, isbn: ['9788966260010'] }] }) }),
  });
  try {
    // 식별값 없으면 거부
    assert.equal((await call('GET', '/api/projects', null, '')).status, 401);

    // UX-01: 이름·목표만으로 생성
    assert.equal((await call('POST', '/api/projects', { name: '' , goal: 'x' })).status, 400);
    const pj = (await call('POST', '/api/projects', { name: '우리 매장 재방문 전략', goal: '단골 재방문율을 높인다' })).body;
    assert.equal(pj.status, 'PROJECT_READY');

    // 다른 사용자는 볼 수 없다
    assert.equal((await call('GET', `/api/projects/${pj.id}`, null, 'someone_else_123456789')).status, 404);

    // 도서 식별
    const books = (await call('POST', '/api/materials/books/resolve', { title: '린 스타트업', author: '에릭 리스' })).body;
    assert.equal(books.candidates[0].author, '에릭 리스');

    // UX-02/03: 복수 원재료
    const book = (await call('POST', `/api/projects/${pj.id}/materials`, { type: 'book', title: '린 스타트업', author: '에릭 리스', rights_status: 'public' })).body;
    const news = (await call('POST', `/api/projects/${pj.id}/materials`, { type: 'news', title: '동네 카페 재방문 기사', excerpt: '재방문 고객의 60%가 직원의 이름 기억을 이유로 꼽았다.', rights_status: 'user_provided' })).body;
    assert.equal(book.analysis_mode, 'public_info_only');
    assert.equal(news.analysis_mode, 'text_provided');
    assert.equal((await call('POST', `/api/projects/${pj.id}/materials`, { type: 'ebook', title: '개인 PDF' })).status, 400, '전자책은 권리 확인 필요');
    assert.equal((await call('POST', `/api/projects/${pj.id}/materials`, { type: 'news', title: 'x', uri: 'javascript:alert(1)' })).status, 400);
    assert.equal((await call('GET', `/api/projects/${pj.id}`)).body.status, 'MATERIAL_READY');

    const rec = (await call('GET', `/api/projects/${pj.id}/recommendations`)).body.tool_ids;
    assert.equal(rec.length, 3);
    assert.ok(rec.includes('funnel'), '재방문 → 퍼널 추천');

    // 가공 → Prototype 01 자동 저장
    const run1 = (await call('POST', `/api/projects/${pj.id}/runs`, { tool_id: 'swot', idempotency_key: 'k1' })).body;
    const done1 = await waitRun(call, run1.id);
    assert.equal(done1.state, 'succeeded');
    // 같은 키 재시도 → 같은 작업(중복 버전 없음)
    assert.equal((await call('POST', `/api/projects/${pj.id}/runs`, { tool_id: 'swot', idempotency_key: 'k1' })).body.id, run1.id);
    let protos = (await call('GET', `/api/projects/${pj.id}/prototypes`)).body;
    assert.equal(protos.length, 1);
    assert.equal(protos[0].version_label, 'Prototype 01');
    const p1Snapshot = JSON.stringify(protos[0].content);

    // 검수실
    const rv = (await call('POST', '/api/review-sessions', { prototype_id: protos[0].id })).body;
    assert.equal(rv.options.length, 5);
    const chat = (await call('POST', `/api/review-sessions/${rv.id}/messages`, { text: '퍼널로도 보고 싶어요' })).body;
    assert.equal(chat.chat.length, 2);
    const ch = (await call('POST', `/api/review-sessions/${rv.id}/choose`, { option_id: 'other_tool' })).body;
    assert.equal(ch.next, 'tools');
    assert.equal(ch.project.status, 'REVIEWED');

    // 재가공 → Prototype 02 (부모 = 01), 01 불변
    const run2 = (await call('POST', `/api/projects/${pj.id}/runs`, { tool_id: 'funnel', source_prototype_id: protos[0].id, idempotency_key: 'k2' })).body;
    assert.equal((await waitRun(call, run2.id)).state, 'succeeded');
    protos = (await call('GET', `/api/projects/${pj.id}/prototypes`)).body;
    assert.equal(protos.length, 2);
    assert.equal(protos[1].version_label, 'Prototype 02');
    assert.equal(protos[1].parent_id, protos[0].id);
    assert.equal(JSON.stringify(protos[0].content), p1Snapshot);

    // 원재료 삭제 → 프로토타입 보존 + 근거 상태 표시
    await call('DELETE', `/api/materials/${book.id}`);
    protos = (await call('GET', `/api/projects/${pj.id}/prototypes`)).body;
    assert.equal(protos.length, 2);
    assert.deepEqual(protos[0].missing_material_ids, [book.id]);

    // 샤크탱크: 사용자 자유 발언 → 심사역 반응, 요약 → 새 프로토타입
    const cv = (await call('POST', '/api/conversations', { project_id: pj.id, lab_id: 'shark', source_prototype_id: protos[1].id })).body;
    assert.ok(cv.messages.length >= 3);
    const cv2 = (await call('POST', `/api/conversations/${cv.id}/messages`, { text: '월 매출 1000만원을 목표로 합니다' })).body;
    assert.ok(cv2.messages.some((m) => m.speaker_id === 'user'));
    assert.ok(cv2.messages.length > cv.messages.length + 1);
    const sum = (await call('POST', `/api/conversations/${cv.id}/summary`)).body;
    assert.equal(sum.prototype.version_label, 'Prototype 03');
    assert.equal(sum.prototype.parent_id, protos[1].id);

    // 유명인 관점: 가상 시뮬레이션 표시
    assert.equal((await call('POST', '/api/conversations', { project_id: pj.id, lab_id: 'celeb', personas: ['한 명'] })).status, 400);
    const celeb = (await call('POST', '/api/conversations', { project_id: pj.id, lab_id: 'celeb', personas: ['스티브 잡스', '피터 드러커'] })).body;
    assert.match(celeb.disclaimer, /가상 시뮬레이션/);
    assert.match(celeb.participants[0].name, /추정 관점/);

    // 개인 스킬 → Prototype 01로 PPT 패키지
    const sk = (await call('POST', '/api/custom-skills', { name: '사장님 보고용', instruction: '결론 먼저, 쉬운 말', tone: '담백' })).body;
    const fp = (await call('POST', '/api/final-packages', { prototype_id: protos[0].id, custom_skill_id: sk.id, format: 'ppt', final_name: '재방문 3배 프로젝트', idempotency_key: 'pk1' })).body;
    assert.equal(fp.prototype_label, 'Prototype 01');
    assert.equal(fp.custom_skill_snapshot.version, 1);
    assert.ok(fp.package.production_prompt.length > 20);
    assert.equal((await call('POST', '/api/final-packages', { prototype_id: protos[0].id, format: 'ppt', final_name: '재방문 3배 프로젝트', idempotency_key: 'pk1' })).body.id, fp.id);

    // 스킬 수정은 기존 패키지를 바꾸지 않는다
    await call('PUT', `/api/custom-skills/${sk.id}`, { name: '사장님 보고용', instruction: '완전히 다른 지시' });
    const again = (await call('GET', `/api/final-packages/${fp.id}`)).body;
    assert.equal(again.custom_skill_snapshot.instruction, '결론 먼저, 쉬운 말');

    // 창고 검색 + 다운로드
    const wh = (await call('GET', `/api/warehouse?q=${encodeURIComponent('재방문 3배')}`)).body;
    assert.equal(wh.length, 1);
    assert.equal((await call('GET', '/api/warehouse?q=없는이름')).body.length, 0);
    const dl = await call('GET', `/api/final-packages/${fp.id}/download`);
    assert.match(dl.body, /외부 AI 제작 지시문/);

    // 외부 이관: 권리 확인 없으면 거부
    assert.equal((await call('POST', '/api/external-handoffs', { final_package_id: fp.id, provider: 'chatgpt' })).status, 400);
    const ho = (await call('POST', '/api/external-handoffs', { final_package_id: fp.id, provider: 'chatgpt', rights_ack: { rights: true, sensitive: true } })).body;
    assert.equal(ho.url, 'https://chatgpt.com/');
    assert.equal((await call('GET', `/api/projects/${pj.id}`)).body.status, 'EXTERNAL_HANDOFF');
  } finally {
    close();
  }
});

test('가공 실패 시 원재료·기존 버전 유지, 재시도 가능', async () => {
  let fail = true;
  const fakeAI = {
    mock: false,
    model: 'fake',
    async json({ schema }) {
      if (fail) throw new AIError('AI가 잠시 응답하지 못했습니다.', { status: 502, retryable: true });
      const fill = (s) => (s.type === 'object' ? Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, fill(v)])) : s.type === 'array' ? [fill(s.items)] : s.enum ? s.enum[0] : s.type === 'boolean' ? true : 'x');
      return { data: fill(schema), usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
  const { call, close } = await boot({ ai: fakeAI });
  try {
    const pj = (await call('POST', '/api/projects', { name: 'p', goal: 'g' })).body;
    await call('POST', `/api/projects/${pj.id}/materials`, { type: 'culture', title: '연극 한 편' });
    const r1 = (await call('POST', `/api/projects/${pj.id}/runs`, { tool_id: 'lean', idempotency_key: 'a' })).body;
    const f = await waitRun(call, r1.id);
    assert.equal(f.state, 'failed');
    assert.ok(f.error);
    assert.equal((await call('GET', `/api/projects/${pj.id}/materials`)).body.length, 1);
    assert.equal((await call('GET', `/api/projects/${pj.id}/prototypes`)).body.length, 0);
    fail = false;
    const r2 = (await call('POST', `/api/projects/${pj.id}/runs`, { tool_id: 'lean', idempotency_key: 'b' })).body;
    assert.equal((await waitRun(call, r2.id)).state, 'succeeded');
    assert.equal((await call('GET', `/api/projects/${pj.id}/prototypes`)).body.length, 1);
  } finally {
    close();
  }
});
