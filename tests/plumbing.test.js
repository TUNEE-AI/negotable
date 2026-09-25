// 실제 LLM 없이 "서버 배관"을 검증하는 테스트입니다. (node --test tests/)
//  - 상태가 턴마다 이어지는가
//  - 순서 규칙(정리 카드 전에는 ITEM 생성 불가)이 지켜지는가
//  - 사용자가 말하지 않은 업종 용어가 나오면 재작성을 요청하는가
//  - 입력 검증 / 이벤트 기록 / 프롬프트 위생
// 의미 이해 품질은 이 테스트로 확인할 수 없습니다 → tests/live-scenarios.js 로 실제 모델을 테스트하세요.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { WATCHED_TERMS, findLeakedTerms } from '../lib/guard.js';
import { buildChatSystem, buildItemsSystem, buildEditSystem } from '../lib/prompts.js';
import { emptyState, normalizeState } from '../lib/state.js';

const config = {
  model: 'fake',
  dailyLlmLimit: 1000,
  rateLimitPer15Min: 1000,
  applyUrl: 'https://example.com/form',
  benefitText: 'x',
  eventWebhookUrl: '',
  demoVideoId: '',
  posterUrl: '/images/showreel-poster.jpg',
  adminToken: 'test-token-123',
  maxVideoMb: 1,
};

async function boot(llm, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nego-'));
  const app = createApp({ llm, config: { ...config, ...overrides }, dataDir });
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { post, base, dataDir, close: () => server.close() };
}

const goodState = (over = {}) => ({
  counterparty: '관리업체',
  situation: '지정주차 조건을 명확히 하고 싶음',
  issues: ['지정주차 사용 조건'],
  desiredOutcome: '지정주차 조건에 대한 명확한 합의',
  conditions: [{ kind: 'scope', topic: '주차 사용', detail: '지정 면 사용' }],
  rationale: [],
  existingAgreements: [],
  confirmedFacts: ['관리업체와 지정주차 조건을 합의하고 싶다'],
  unknownFacts: [],
  coverage: { counterparty: 'known', situation: 'known', issues: 'known', desiredOutcome: 'known', conditions: 'known', amount: 'not_applicable', period: 'unknown', rationale: 'unknown' },
  ...over,
});

test('chat: 상태가 정규화되어 반환되고 items가 보존된다', async () => {
  const seen = [];
  const srv = await boot(async ({ system, messages, tool }) => {
    seen.push({ system, messages, tool: tool.name });
    return { reply: '정리해볼게요.', next_action: 'summarize', state: goodState() };
  });
  const prevItems = [{ id: 'a1', title: 't', headline: 'h', request: 'r' }];
  const r = await srv.post('/api/chat', {
    messages: [{ role: 'assistant', content: '안내' }, { role: 'user', content: '주차 문제로 관리업체와 합의하고 싶어요' }],
    state: { ...emptyState(), items: prevItems },
    phase: 'intake',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'summarize');
  assert.equal(r.body.phase, 'confirming');
  assert.equal(r.body.state.items[0].id, 'a1');
  // 첫 메시지는 user여야 하므로 선행 assistant 메시지는 제거되어야 한다
  assert.equal(seen[0].messages[0].role, 'user');
  // 현재 상태가 프롬프트에 주입된다
  assert.match(seen[0].system, /<negotiation_state>/);
  srv.close();
});

test('chat: 이전 상태가 다음 턴 프롬프트에 그대로 전달된다(기억 유지)', async () => {
  let lastSystem = '';
  const srv = await boot(async ({ system }) => {
    lastSystem = system;
    return { reply: '네', next_action: 'ask', state: goodState({ issues: ['A', 'B'] }) };
  });
  const st = goodState({ counterparty: '상대 팀', issues: ['기존 쟁점'] });
  await srv.post('/api/chat', { messages: [{ role: 'user', content: '하나 더 있어요' }], state: st, phase: 'intake' });
  assert.ok(lastSystem.includes('기존 쟁점') && lastSystem.includes('상대 팀'));
  srv.close();
});

test('chat: 정리 카드 전에는 generate_items가 summarize로 강등된다', async () => {
  const srv = await boot(async () => ({ reply: '좋아요', next_action: 'generate_items', state: goodState() }));
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '진행해줘' }], state: emptyState(), phase: 'intake' });
  assert.equal(r.body.action, 'summarize');
  const r2 = await srv.post('/api/chat', { messages: [{ role: 'user', content: '응' }], state: goodState(), phase: 'confirming' });
  assert.equal(r2.body.action, 'generate_items');
  assert.equal(r2.body.phase, 'items');
  srv.close();
});

test('chat: 정리할 정보가 없으면 summarize가 ask로 바뀐다', async () => {
  const srv = await boot(async () => ({ reply: '정리', next_action: 'summarize', state: { ...goodState(), issues: [], situation: '', desiredOutcome: '' } }));
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '안녕하세요' }], state: emptyState(), phase: 'intake' });
  assert.equal(r.body.action, 'ask');
  srv.close();
});

test('guard: 사용자가 말하지 않은 업종 용어가 나오면 1회 재작성을 요청한다', async () => {
  let calls = 0;
  const srv = await boot(async ({ system }) => {
    calls++;
    if (calls === 1) return { reply: '잔금 조건이군요.', next_action: 'ask', state: goodState() };
    assert.match(system, /정정 지시/);
    return { reply: '주차 조건이군요.', next_action: 'ask', state: goodState() };
  });
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '주차 조건을 정하고 싶어요' }], state: emptyState(), phase: 'intake' });
  assert.equal(calls, 2);
  assert.equal(r.body.reply, '주차 조건이군요.');
  srv.close();
});

test('guard: 사용자가 직접 말한 용어는 재작성 없이 통과한다', async () => {
  let calls = 0;
  const srv = await boot(async () => {
    calls++;
    return { reply: '잔금 조건이군요.', next_action: 'ask', state: goodState() };
  });
  await srv.post('/api/chat', { messages: [{ role: 'user', content: '잔금 날짜를 조정하고 싶어요' }], state: emptyState(), phase: 'intake' });
  assert.equal(calls, 1);
  srv.close();
});

test('findLeakedTerms: 공백이 섞여도 감지한다', () => {
  assert.ok(findLeakedTerms('추가 공사비 협의', ['다른 이야기']).includes('공사비'));
  assert.deepEqual(findLeakedTerms('추가 공사비 협의', ['추가 공사비 얘기예요']), []);
});

test('items: 금액 없는 ITEM도 만들고, id를 서버가 부여한다', async () => {
  const srv = await boot(async () => ({
    reply: '2개로 나눴어요.',
    items: [
      { title: '지정 주차 조건', headline: '지정 주차면 사용', request: '지정 주차면 사용 조건을 명확히 한다', id: '' },
      { title: '변경 절차', headline: '사전 안내 후 변경', request: '조건 변경 시 사전 안내', period: '', amount: '' },
    ],
  }));
  const r = await srv.post('/api/items', { messages: [{ role: 'user', content: '주차 합의' }], state: goodState() });
  assert.equal(r.status, 200);
  assert.equal(r.body.state.items.length, 2);
  assert.ok(r.body.state.items.every((i) => i.id && i.amount === ''));
  srv.close();
});

test('items: 상태가 비어 있으면 400', async () => {
  const srv = await boot(async () => ({}));
  const r = await srv.post('/api/items', { messages: [{ role: 'user', content: 'x' }], state: emptyState() });
  assert.equal(r.status, 400);
  srv.close();
});

test('edit: 수정된 목록으로 교체되고, 지시문이 프롬프트가 아닌 user 메시지로 전달된다', async () => {
  let got;
  const srv = await boot(async ({ messages, system }) => {
    got = { messages, system };
    return { reply: '1번 금액을 바꿨어요.', items: [{ id: 'x1', title: 'A', headline: '800,000원', request: 'r', amount: '800,000원' }] };
  });
  const state = { ...goodState(), items: [{ id: 'x1', title: 'A', headline: '1,000,000원', request: 'r', amount: '1,000,000원' }] };
  const r = await srv.post('/api/edit', { messages: [{ role: 'user', content: '금액은 100만원' }], state, instruction: '1번 금액 80만원으로 바꿔줘' });
  assert.equal(r.status, 200);
  assert.equal(r.body.state.items[0].amount, '800,000원');
  assert.equal(got.messages[0].content, '1번 금액 80만원으로 바꿔줘');
  assert.ok(got.system.includes('1,000,000원')); // 현재 ITEM이 프롬프트에 들어간다
  srv.close();
});

test('입력 검증: 너무 긴 메시지·빈 대화·잘못된 설문 값', async () => {
  const srv = await boot(async () => ({}));
  assert.equal((await srv.post('/api/chat', { messages: [{ role: 'user', content: 'a'.repeat(2001) }], state: emptyState() })).status, 400);
  assert.equal((await srv.post('/api/chat', { messages: [], state: emptyState() })).status, 400);
  assert.equal((await srv.post('/api/feedback', { sid: 's1', choice: 'hack' })).status, 400);
  srv.close();
});

test('이벤트·설문은 파일에 기록되고 대화 내용은 기록되지 않는다', async () => {
  const srv = await boot(async () => ({ reply: '비밀 대화 내용', next_action: 'ask', state: goodState() }));
  await srv.post('/api/chat', { messages: [{ role: 'user', content: '아주 민감한 대화' }], state: emptyState() });
  await srv.post('/api/event', { sid: 's_abc', type: 'preview_viewed' });
  await srv.post('/api/feedback', { sid: 's_abc', choice: 'now' });
  const text = fs.readFileSync(path.join(srv.dataDir, 'events.jsonl'), 'utf8');
  assert.match(text, /preview_viewed/);
  assert.match(text, /"choice":"now"/);
  assert.ok(!text.includes('민감한'));
  srv.close();
});

test('LLM 실패 시 사용자에게 안전한 오류 메시지를 준다', async () => {
  const { LLMError } = await import('../lib/llm.js');
  const srv = await boot(async () => {
    throw new LLMError('AI가 잠시 응답하지 못했습니다.', { status: 502 });
  });
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '안녕' }], state: emptyState() });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /AI/);
  srv.close();
});

test('/config.js 는 신청 URL을 노출하지만 API 키는 노출하지 않는다', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-test';
  const srv = await boot(async () => ({}));
  const t = await (await fetch(srv.base + '/config.js')).text();
  assert.match(t, /example\.com\/form/);
  assert.ok(!t.includes('sk-ant'));
  srv.close();
});

test('프롬프트 위생: 감시 대상 업종 용어가 프롬프트에 들어 있지 않다', () => {
  const st = normalizeState({}, { items: [] });
  const prompts = [
    buildChatSystem({ state: st, phase: 'intake', userTurns: 1 }),
    buildChatSystem({ state: st, phase: 'confirming', userTurns: 5 }),
    buildItemsSystem({ state: st }),
    buildEditSystem({ state: st, items: [] }),
  ].join('\n');
  for (const term of WATCHED_TERMS) assert.ok(!prompts.includes(term), `프롬프트에 "${term}" 이(가) 포함됨`);
});

test('LLM 클라이언트: 요청 형식(키 헤더·도구 강제)과 응답 파싱, 5xx 1회 재시도', async () => {
  const http = await import('node:http');
  const { createAnthropicLLM } = await import('../lib/llm.js');
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-api-key'], ver: req.headers['anthropic-version'], body: JSON.parse(body) });
      if (seen.length === 1) return res.writeHead(529).end('{"error":{"message":"overloaded"}}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 't', input: { ok: true } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const llm = createAnthropicLLM({ apiKey: 'k-test', model: 'm-test', baseUrl: `http://127.0.0.1:${mock.address().port}` });
  const out = await llm({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tool: { name: 't', description: 'd', input_schema: { type: 'object', properties: {} } } });
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.length, 2); // 첫 요청 529 → 재시도
  assert.equal(seen[1].url, '/v1/messages');
  assert.equal(seen[1].key, 'k-test');
  assert.equal(seen[1].ver, '2023-06-01');
  assert.deepEqual(seen[1].body.tool_choice, { type: 'tool', name: 't' });
  assert.equal(seen[1].body.model, 'm-test');
  mock.closeAllConnections?.(); mock.close();
});

test('게이트: 확인하지 않은 항목이 남았는데 정리로 넘어가려 하면 1회 다시 묻게 한다', async () => {
  let calls = 0;
  const notAsked = { ...goodState().coverage, amount: 'not_asked', rationale: 'not_asked' };
  const srv = await boot(async ({ system }) => {
    calls++;
    if (calls === 1) return { reply: '정리해볼게요.', next_action: 'summarize', state: goodState({ coverage: notAsked }) };
    assert.match(system, /아직 확인하지 않은 항목이 있습니다: amount, rationale/);
    return { reply: '금액도 관련이 있나요?', next_action: 'ask', state: goodState({ coverage: notAsked }) };
  });
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '이야기' }], state: emptyState(), phase: 'intake' });
  assert.equal(calls, 2);
  assert.equal(r.body.action, 'ask');
  assert.equal(r.body.phase, 'intake');
  srv.close();
});

test('게이트: 충분히 대화했으면(7턴) 남은 항목이 있어도 정리로 넘어간다', async () => {
  let calls = 0;
  const notAsked = { ...goodState().coverage, rationale: 'not_asked' };
  const srv = await boot(async () => {
    calls++;
    return { reply: '정리할게요', next_action: 'summarize', state: goodState({ coverage: notAsked }) };
  });
  const msgs = [];
  for (let i = 0; i < 7; i++) msgs.push({ role: 'user', content: '답변 ' + i }, { role: 'assistant', content: '질문 ' + i });
  msgs.pop();
  const r = await srv.post('/api/chat', { messages: msgs, state: goodState(), phase: 'intake' });
  assert.equal(calls, 1);
  assert.equal(r.body.action, 'summarize');
  srv.close();
});

test('게이트: 정리 확인(confirming) 단계에서는 적용되지 않는다', async () => {
  const notAsked = { ...goodState().coverage, rationale: 'not_asked' };
  const srv = await boot(async () => ({ reply: '좋아요', next_action: 'generate_items', state: goodState({ coverage: notAsked }) }));
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '응' }], state: goodState(), phase: 'confirming' });
  assert.equal(r.body.action, 'generate_items');
  srv.close();
});

test('게이트: 첫 응답이 시간 예산을 넘기면 재요청 없이 그대로 정리로 넘어간다(대기 시간 상한)', async () => {
  process.env.GATE_RETRY_BUDGET_MS = '30';
  let calls = 0;
  const notAsked = { ...goodState().coverage, rationale: 'not_asked' };
  const srv = await boot(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 60));
    return { reply: '정리해볼게요.', next_action: 'summarize', state: goodState({ coverage: notAsked }) };
  });
  const r = await srv.post('/api/chat', { messages: [{ role: 'user', content: '이야기' }], state: emptyState(), phase: 'intake' });
  delete process.env.GATE_RETRY_BUDGET_MS;
  assert.equal(calls, 1);
  assert.equal(r.body.action, 'summarize');
  srv.close();
});

test('LLM 클라이언트: 시간 초과는 재시도하지 않는다(대기 시간이 두 배가 되지 않게)', async () => {
  const http = await import('node:http');
  const { createAnthropicLLM } = await import('../lib/llm.js');
  let hits = 0;
  const mock = http.createServer(() => { hits++; }); // 응답하지 않음 → 시간 초과
  await new Promise((r) => mock.listen(0, r));
  const llm = createAnthropicLLM({ apiKey: 'k', model: 'm', timeoutMs: 50, baseUrl: `http://127.0.0.1:${mock.address().port}` });
  await assert.rejects(llm({ system: 's', messages: [{ role: 'user', content: 'hi' }], tool: { name: 't', input_schema: { type: 'object' } } }), /시간이 초과/);
  assert.equal(hits, 1);
  mock.closeAllConnections?.(); mock.close();
});

test('items: kind(금액/기간/조건)가 보존되고 잘못된 값은 빈 값이 된다', async () => {
  const srv = await boot(async () => ({
    reply: 'ok',
    items: [
      { kind: 'amount', title: 'A 금액', headline: '협의', request: 'r', amount: '800,000원' },
      { kind: 'period', title: 'A 기간', headline: '7일', request: 'r', period: '7일' },
      { kind: 'nonsense', title: 'A 조건', headline: 'x', request: 'r' },
    ],
  }));
  const r = await srv.post('/api/items', { messages: [{ role: 'user', content: 'x' }], state: goodState() });
  assert.deepEqual(r.body.state.items.map((i) => i.kind), ['amount', 'period', '']);
  srv.close();
});

test('프롬프트: ITEM을 금액/기간/조건 종류로 나누라는 규칙이 들어 있다', () => {
  const p = buildItemsSystem({ state: normalizeState({}, { items: [] }) });
  assert.match(p, /amount\(금액\)/);
  assert.match(p, /period\(기간\)/);
  assert.match(p, /condition\(조건\)/);
});

test('영상 업로드: 토큰 없이 설정된 경우 401, 토큰 자체가 없으면 503', async () => {
  const srv = await boot(async () => ({}));
  const noAuth = await fetch(srv.base + '/api/admin/video');
  assert.equal(noAuth.status, 401);
  const wrongAuth = await fetch(srv.base + '/api/admin/video', { headers: { 'x-admin-token': 'nope' } });
  assert.equal(wrongAuth.status, 401);
  const srv2 = await boot(async () => ({}), { adminToken: '' });
  const disabled = await fetch(srv2.base + '/api/admin/video', { headers: { 'x-admin-token': 'anything' } });
  assert.equal(disabled.status, 503);
  srv.close();
  srv2.close();
});

test('영상 업로드: 올바른 토큰 + mp4 파일 → 저장되고 /media 로 제공되며, 삭제도 된다', async () => {
  const srv = await boot(async () => ({}));
  const fd = new FormData();
  fd.append('video', new Blob([new Uint8Array(1000)], { type: 'video/mp4' }), 'clip.mp4');
  const up = await fetch(srv.base + '/api/admin/video', { method: 'POST', headers: { 'x-admin-token': 'test-token-123' }, body: fd });
  const upBody = await up.json();
  assert.equal(up.status, 200);
  assert.match(upBody.url, /^\/media\/showreel\.mp4\?v=/);

  const served = await fetch(srv.base + upBody.url);
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, 1000);

  const status = await (await fetch(srv.base + '/api/admin/video', { headers: { 'x-admin-token': 'test-token-123' } })).json();
  assert.equal(status.exists, true);

  const cfgText = await (await fetch(srv.base + '/config.js')).text();
  assert.match(cfgText, /"videoUrl":"\/media\/showreel\.mp4/);

  const del = await fetch(srv.base + '/api/admin/video', { method: 'DELETE', headers: { 'x-admin-token': 'test-token-123' } });
  assert.equal((await del.json()).removed, true);
  const gone = await fetch(srv.base + '/api/admin/video', { headers: { 'x-admin-token': 'test-token-123' } });
  assert.equal((await gone.json()).exists, false);
  const notFound = await fetch(srv.base + upBody.url);
  assert.equal(notFound.status, 404);
  srv.close();
});

test('영상 업로드: 허용되지 않는 형식과 용량 초과는 400', async () => {
  const srv = await boot(async () => ({}));
  const fd1 = new FormData();
  fd1.append('video', new Blob([new Uint8Array(10)], { type: 'image/png' }), 'x.png');
  const r1 = await fetch(srv.base + '/api/admin/video', { method: 'POST', headers: { 'x-admin-token': 'test-token-123' }, body: fd1 });
  assert.equal(r1.status, 400);

  const fd2 = new FormData();
  fd2.append('video', new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'video/mp4' }), 'big.mp4'); // maxVideoMb=1
  const r2 = await fetch(srv.base + '/api/admin/video', { method: 'POST', headers: { 'x-admin-token': 'test-token-123' }, body: fd2 });
  assert.equal(r2.status, 400);
  srv.close();
});

test('영상 업로드: 새 영상을 올리면 이전 영상 파일은 지워지고 하나만 남는다', async () => {
  const srv = await boot(async () => ({}));
  const upload = (bytes, type, name) => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array(bytes)], { type }), name);
    return fetch(srv.base + '/api/admin/video', { method: 'POST', headers: { 'x-admin-token': 'test-token-123' }, body: fd });
  };
  await upload(100, 'video/mp4', 'a.mp4');
  await upload(100, 'video/webm', 'b.webm');
  const files = fs.readdirSync(path.join(srv.dataDir, 'uploads'));
  assert.deepEqual(files, ['showreel.webm']);
  srv.close();
});

test('프롬프트: 구어체를 격식체로 바꾸라는 규칙과 예시가 ITEM 규칙에 들어 있다', () => {
  const p = buildItemsSystem({ state: normalizeState({}, { items: [] }) });
  assert.match(p, /격식체/);
  assert.match(p, /안 주는거야/); // 구체적 예시가 실제로 포함되어 있는지
  const e = buildEditSystem({ state: normalizeState({}, { items: [] }), items: [] });
  assert.match(e, /격식체/); // 수정 시에도 같은 규칙(ITEM_RULES 공유)이 적용되는지
});

test('OpenRouter 어댑터: 요청 형식(OpenAI 호환 tools)과 정상 응답 파싱', async () => {
  const http = await import('node:http');
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name: 't', arguments: JSON.stringify({ ok: true }) } }] } }],
      }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const port = mock.address().port;
  const orig = global.fetch;
  global.fetch = (url, opts) => orig(url.replace('https://openrouter.ai/api/v1/chat/completions', `http://127.0.0.1:${port}/`), opts);
  const llm = createOpenRouterLLM({ apiKey: 'or-test', model: 'openai/gpt-oss-120b:free' });
  const out = await llm({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tool: { name: 't', description: 'd', input_schema: { type: 'object', properties: {} } } });
  global.fetch = orig;
  assert.deepEqual(out, { ok: true });
  assert.equal(seen[0].model, 'openai/gpt-oss-120b:free');
  assert.equal(seen[0].messages[0].role, 'system');
  assert.deepEqual(seen[0].tool_choice, { type: 'function', function: { name: 't' } });
  assert.equal(seen[0].tools[0].function.name, 't');
  assert.deepEqual(seen[0].reasoning, { effort: 'low' }); // 추론 모델의 숨은 생각 시간을 줄인다
  mock.closeAllConnections?.(); mock.close();
});

test('OpenRouter 어댑터: 모델이 tool_calls 대신 본문에 JSON 텍스트만 준 경우도 복구한다', async () => {
  const http = await import('node:http');
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const mock = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '여기 결과예요: {"ok":true} 감사합니다.' } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const port = mock.address().port;
  const orig = global.fetch;
  global.fetch = (url, opts) => orig(url.replace('https://openrouter.ai/api/v1/chat/completions', `http://127.0.0.1:${port}/`), opts);
  const llm = createOpenRouterLLM({ apiKey: 'or-test', model: 'm:free' });
  const out = await llm({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tool: { name: 't', description: 'd', input_schema: {} } });
  global.fetch = orig;
  assert.deepEqual(out, { ok: true });
  mock.closeAllConnections?.(); mock.close();
});

test('OpenRouter 어댑터: 키가 없으면 503으로 명확히 안내한다', async () => {
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const llm = createOpenRouterLLM({ apiKey: '', model: 'm' });
  await assert.rejects(() => llm({ system: 's', messages: [], tool: { name: 't', description: 'd', input_schema: {} } }), /OPENROUTER_API_KEY/);
});

test('OpenRouter 어댑터: ":free"가 없는 모델은 과금 방지를 위해 기본적으로 막는다', async () => {
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const llm = createOpenRouterLLM({ apiKey: 'k', model: 'openai/gpt-5.5' }); // 유료로 보이는 모델명
  await assert.rejects(() => llm({ system: 's', messages: [], tool: { name: 't', description: 'd', input_schema: {} } }), /과금|ALLOW_PAID_OPENROUTER_MODEL/);
});

test('OpenRouter 어댑터: allowPaidModel:true 로 명시하면 유료로 보이는 모델도 호출을 시도한다', async () => {
  const http = await import('node:http');
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const mock = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 't', arguments: '{"ok":true}' } }] } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const port = mock.address().port;
  const orig = global.fetch;
  global.fetch = (url, opts) => orig(url.replace('https://openrouter.ai/api/v1/chat/completions', `http://127.0.0.1:${port}/`), opts);
  const llm = createOpenRouterLLM({ apiKey: 'k', model: 'openai/gpt-5.5', allowPaidModel: true });
  const out = await llm({ system: 's', messages: [], tool: { name: 't', description: 'd', input_schema: {} } });
  global.fetch = orig;
  assert.deepEqual(out, { ok: true });
  mock.closeAllConnections?.(); mock.close();
});

test('OpenRouter 어댑터: "openrouter/free" 라우터 이름은 그대로 허용한다', async () => {
  const { createOpenRouterLLM } = await import('../lib/llm-openrouter.js');
  const llm = createOpenRouterLLM({ apiKey: '', model: 'openrouter/free' });
  // 키가 없어서 어차피 막히지만, "과금 방지"가 아니라 "키 없음" 사유여야 한다(=free 판정을 통과했다는 뜻)
  await assert.rejects(() => llm({ system: 's', messages: [], tool: { name: 't', description: 'd', input_schema: {} } }), /OPENROUTER_API_KEY/);
});
