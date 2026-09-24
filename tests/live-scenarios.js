// ─────────────────────────────────────────────────────────────
// 실제 LLM으로 5가지 협상 사례를 끝까지 돌려보는 테스트
//
//   ANTHROPIC_API_KEY=sk-ant-... node tests/live-scenarios.js
//   (또는 .env 에 키를 넣고: npm run test:live)
//   특정 사례만: node tests/live-scenarios.js A C
//
// 동작: "가상 사용자"(같은 LLM이 페르소나를 연기)가 AI의 질문에 답하고,
//       정리 카드가 나오면 사전에 정한 다양한 표현으로 동의/수정하고,
//       ITEM 생성 → 자연어 수정까지 진행합니다.
// 자동 점검(실패 조건 재현):
//   1) 사용자가 말하지 않은 업종 용어 유출   2) 금액이 필요 없는 협상에서 금액 질문
//   3) 같은 질문 반복                          4) 금액 변경이 최종 결과에 반영되는가
//   5) 정리→ITEM→수정 끝까지 도달했는가
// 대화 전문은 tests/out/*.md 에 저장됩니다. 자동 점검은 보조 수단이므로 반드시 대화록을 눈으로 확인하세요.
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropicLLM } from '../lib/llm.js';
import { chatTurn, createItems, reviseItems } from '../lib/negotiation.js';
import { emptyState } from '../lib/state.js';
import { findLeakedTerms, collectText } from '../lib/guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  for (const line of fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 필요합니다.');
  process.exit(1);
}
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const llm = createAnthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, model });

// ── 사례 정의 ──────────────────────────────────────────────────
// facts: 가상 사용자가 "알고 있는 것". 여기에 없는 것은 "아직 정하지 않았다/모른다"고 답합니다.
const SCENARIOS = {
  A: {
    name: '계약에 없던 기능 추가 요청',
    opening: '고객사가 원래 계약에 없던 기능을 계속 추가해달라고 합니다. 추가비용과 일정조정을 얘기하고 싶어요.',
    facts: '추가 요청 기능은 3가지 정도. 기존 계약서에는 기능 목록이 정해져 있었음. 추가 작업비는 100만원 정도 생각. 일정은 일주일 정도 늘리고 싶음. 상대는 고객사 담당자.',
    confirmScript: ['생각해보니 금액은 80만원으로 할게요', '좋아 진행해줘'],
    expectAmountTopic: true,
    expectAmountInItems: ['800,000', '80만'],
    forbidInItems: ['1,000,000', '100만'],
    edit: { instruction: '1번 금액 90만원으로 바꿔줘', expectIncludes: ['900,000', '90만'] },
  },
  B: {
    name: '퇴직 후 업무 질문 대응',
    opening: '퇴직했는데 회사에서 계속 업무 질문이 옵니다. 앞으로는 일정 기간만 유료로 대응하고 싶어요.',
    facts: '퇴직한 지 2주. 이전 팀 동료들이 카톡으로 질문함. 대응 기간은 30일 정도. 보상은 50만원 정도 생각. 상대는 전 직장 팀.',
    confirmScript: ['맞아요'],
    expectAmountTopic: true,
    edit: { instruction: '표현을 좀 더 부드럽게 바꿔줘', expectSameCount: true },
  },
  C: {
    name: '동업 정리 (장비·고객 분배)',
    opening: '같이 하던 사업을 정리하려고 하는데 장비와 기존 고객을 어떻게 나눌지 이야기하고 싶습니다.',
    facts: '공동 운영자 1명과 정리. 장비는 둘이 함께 샀음. 고객은 각자 담당하던 고객 위주로 나누고 싶음. 돈 문제는 아직 생각 안 해봤음. 정리 시점은 다음 달 말.',
    confirmScript: ['응'],
    expectAmountTopic: false,
    edit: { instruction: '마지막 항목은 삭제해줘', expectFewerItems: true },
  },
  D: {
    name: '영상 사용기간·2차 사용범위',
    opening: '광고주가 제가 만든 영상을 계약보다 오래 사용하려고 합니다. 사용기간과 2차 사용범위를 정하고 싶어요.',
    facts: '원래 계약은 3개월 사용. 광고주는 1년 쓰려고 함. 2차 사용은 온라인 광고 외에 매장 디스플레이까지 쓰려는 상황. 금액 얘기는 일단 하고 싶지 않고 기간과 범위만 정리하고 싶음.',
    confirmScript: ['그래'],
    expectAmountTopic: false,
  },
  E: {
    name: '아파트 지정주차 조건',
    opening: '아파트 주차 문제 때문에 관리업체와 지정주차 조건을 확실히 합의하고 싶어요.',
    facts: '지금은 구두로만 안내받음. 세대 지정 주차 1면 사용을 확실히 하고 싶음. 방문차량 이용 조건도 정하고 싶음. 돈과는 상관없는 문제.',
    confirmScript: ['이대로 해줘'],
    expectAmountTopic: false,
  },
};

// ── 가상 사용자 ────────────────────────────────────────────────
async function simulateUser(sc, transcript) {
  const out = await llm({
    system: `당신은 협상 정리 서비스와 채팅 중인 평범한 사용자를 연기합니다.
- 아래 [알고 있는 사실]에 있는 것만 말합니다. 없는 것을 물으면 "아직 안 정했어요" 또는 "잘 모르겠어요"라고 답합니다.
- 한두 문장, 구어체 한국어, 약간 두서없게 답합니다. AI의 질문에만 답하고 새 정보를 덧붙이지 않습니다.
[알고 있는 사실]
${sc.facts}`,
    messages: [{ role: 'user', content: '지금까지 대화:\n' + transcript.map((m) => `${m.role === 'user' ? '나' : 'AI'}: ${m.content}`).join('\n') + '\n\n다음에 내가 할 말을 작성하세요.' }],
    tool: {
      name: 'user_reply',
      description: '사용자의 다음 발언',
      input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
    maxTokens: 300,
  });
  return String(out.message || '').trim() || '잘 모르겠어요.';
}

// ── 보조 점검 ──────────────────────────────────────────────────
const AMOUNT_RE = /금액|얼마|비용|가격|대금|보수|보상금|얼마나 받/;
const bigrams = (s) => new Set(s.replace(/\s+/g, '').split('').map((c, i, a) => c + (a[i + 1] || '')));
const sim = (a, b) => {
  const A = bigrams(a), B = bigrams(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
};

async function runScenario(key) {
  const sc = SCENARIOS[key];
  const messages = [];
  const log = [];
  const issues = [];
  const warnings = [];
  let state = emptyState();
  let phase = 'intake';
  let confirmIdx = 0;
  let turns = 0;
  let itemsDone = false;
  let userLine = sc.opening;
  const aiReplies = [];

  const say = (role, content, meta = '') => log.push(`**${role === 'user' ? '사용자' : 'AI'}**${meta}: ${content}`);

  while (turns < 10 && !itemsDone) {
    turns++;
    messages.push({ role: 'user', content: userLine });
    say('user', userLine);
    const res = await chatTurn(llm, { messages, state, phase });
    state = res.state;
    phase = res.phase;
    messages.push({ role: 'assistant', content: res.reply, action: res.action });
    aiReplies.push({ text: res.reply, action: res.action, beforeUserMentionedAmount: !messages.some((m) => m.role === 'user' && AMOUNT_RE.test(m.content)) });
    say('assistant', res.reply, ` [${res.action}]`);
    if (res.action === 'summarize') log.push('```json\n' + JSON.stringify({ ...state, items: undefined }, null, 2) + '\n```');

    if (res.action === 'generate_items') {
      const made = await createItems(llm, { messages, state });
      state = made.state;
      log.push(`**AI(ITEM 생성)**: ${made.reply}`, '```json\n' + JSON.stringify(state.items, null, 2) + '\n```');
      itemsDone = true;
      break;
    }
    if (res.action === 'summarize' || (phase === 'confirming' && res.action === 'reply_only')) {
      userLine = sc.confirmScript[Math.min(confirmIdx++, sc.confirmScript.length - 1)];
    } else {
      userLine = await simulateUser(sc, messages);
    }
  }

  if (!itemsDone) issues.push('ITEM 생성까지 도달하지 못함');

  // 1) 용어 유출
  const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const leaked = findLeakedTerms([aiReplies.map((a) => a.text), state], userTexts);
  if (leaked.length) issues.push('사용자가 말하지 않은 용어 유출: ' + leaked.join(', '));

  // 2) 불필요한 금액 질문
  if (!sc.expectAmountTopic) {
    const asked = aiReplies.filter((a) => a.action === 'ask' && AMOUNT_RE.test(a.text));
    if (asked.length) warnings.push(`금액이 필요 없는 협상에서 금액 관련 질문 ${asked.length}회: "${asked[0].text.slice(0, 60)}…"`);
    if (state.items.some((it) => it.amount)) warnings.push('사용자가 말하지 않은 금액 필드가 ITEM에 존재: ' + state.items.filter((i) => i.amount).map((i) => i.amount).join(', '));
  }

  // 2b) ITEM 분리 기준: 한 ITEM에 금액과 기간을 섞지 않는다 / kind 지정
  if (itemsDone) {
    for (const it of state.items) {
      if (!it.kind) warnings.push(`ITEM "${it.title}"에 kind(금액/기간/조건)가 없음`);
      if (it.amount && it.period) issues.push(`ITEM "${it.title}"에 금액과 기간이 섞여 있음(종류별 분리 위반)`);
      if (it.kind === 'amount' && !sc.expectAmountTopic) warnings.push(`금액이 필요 없는 협상에 금액 ITEM이 생김: "${it.title}"`);
    }
  }

  // 3) 질문 반복
  const asks = aiReplies.filter((a) => a.action === 'ask');
  for (let i = 1; i < asks.length; i++) if (sim(asks[i].text, asks[i - 1].text) > 0.85) warnings.push('연속된 질문이 거의 동일함');
  if (asks.length > 4) warnings.push(`정리 전 질문이 ${asks.length}회로 많음`);

  // 4) 금액 변경 반영
  if (itemsDone && sc.expectAmountInItems) {
    const all = collectText(state.items);
    if (!sc.expectAmountInItems.some((t) => all.includes(t))) issues.push('변경된 금액이 ITEM에 반영되지 않음');
    if (sc.forbidInItems?.some((t) => all.includes(t))) issues.push('이전 금액이 ITEM에 남아 있음');
  }

  // 5) 자연어 수정
  if (itemsDone && sc.edit) {
    const before = state.items.length;
    const rev = await reviseItems(llm, { messages, state, instruction: sc.edit.instruction });
    log.push(`**사용자(수정)**: ${sc.edit.instruction}`, `**AI**: ${rev.reply}`, '```json\n' + JSON.stringify(rev.state.items, null, 2) + '\n```');
    const all = collectText(rev.state.items);
    if (sc.edit.expectIncludes && !sc.edit.expectIncludes.some((t) => all.includes(t))) issues.push(`수정 요청이 반영되지 않음("${sc.edit.instruction}")`);
    if (sc.edit.expectSameCount && rev.state.items.length !== before) issues.push('표현 수정인데 ITEM 개수가 바뀜');
    if (sc.edit.expectFewerItems && before > 1 && rev.state.items.length !== before - 1) issues.push('삭제 요청이 정확히 1개 삭제로 반영되지 않음');
    const leaked2 = findLeakedTerms(rev, [...userTexts, sc.edit.instruction]);
    if (leaked2.length) issues.push('수정 결과에 용어 유출: ' + leaked2.join(', '));
    state = rev.state;
  }

  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', `${key}.md`), `# 사례 ${key} — ${sc.name}\n\n모델: ${model}\n\n` + log.join('\n\n') + '\n');
  return { key, name: sc.name, turns, itemCount: state.items.length, issues, warnings };
}

const only = process.argv.slice(2).map((s) => s.toUpperCase());
const keys = Object.keys(SCENARIOS).filter((k) => !only.length || only.includes(k));
const results = [];
for (const k of keys) {
  process.stdout.write(`사례 ${k} 실행 중… `);
  try {
    const r = await runScenario(k);
    results.push(r);
    console.log(r.issues.length ? '실패' : r.warnings.length ? '통과(경고 있음)' : '통과');
  } catch (e) {
    results.push({ key: k, name: SCENARIOS[k].name, turns: 0, itemCount: 0, issues: ['실행 오류: ' + e.message], warnings: [] });
    console.log('오류', e.message);
  }
}

console.log('\n═══ 결과 요약 ═══');
for (const r of results) {
  console.log(`\n[사례 ${r.key}] ${r.name} — 대화 ${r.turns}턴, ITEM ${r.itemCount}개`);
  r.issues.forEach((i) => console.log('  ✗ ' + i));
  r.warnings.forEach((w) => console.log('  △ ' + w));
  if (!r.issues.length && !r.warnings.length) console.log('  ✓ 자동 점검 통과');
}
console.log('\n대화 전문: tests/out/*.md  (자동 점검이 못 잡는 "의미 이해"는 대화록을 직접 읽어 확인하세요)');
process.exit(results.some((r) => r.issues.length) ? 1 : 0);
