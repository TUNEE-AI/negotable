// ─────────────────────────────────────────────────────────────
// 협상 처리 로직 — 서버는 "상태를 유지하고 검증"하고, "이해"는 LLM이 합니다.
// 서버는 세션을 저장하지 않습니다(stateless). 클라이언트가 negotiationState를
// 들고 다니며 매 요청에 함께 보내고, 서버는 검증해서 돌려줍니다.
// ─────────────────────────────────────────────────────────────

import {
  STATE_SCHEMA,
  ITEM_SCHEMA,
  emptyState,
  normalizeState,
  normalizeItems,
  sanitizeIncomingState,
  isStateUsable,
  pendingCoverage,
} from './state.js';
import {
  CHAT_TOOL,
  ITEMS_TOOL,
  REVISE_TOOL,
  buildChatSystem,
  buildItemsSystem,
  buildEditSystem,
} from './prompts.js';
import { findLeakedTerms, correctionNote } from './guard.js';

export class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const MAX_MESSAGES = 40;
const MAX_CHARS = 2000;
const HISTORY_WINDOW = 30; // 프롬프트에 넣는 최근 대화 수. 나머지는 state가 기억합니다.

// ── 입력 검증 ──────────────────────────────────────────────────

function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequest('messages가 필요합니다.');
  if (raw.length > MAX_MESSAGES * 2) throw new BadRequest('대화가 너무 깁니다.');
  const msgs = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    let content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    if (content.length > MAX_CHARS) {
      if (m.role === 'user') throw new BadRequest(`한 번에 ${MAX_CHARS}자까지 입력할 수 있습니다.`);
      content = content.slice(0, MAX_CHARS);
    }
    // 정리 카드가 표시된 턴이었다는 사실을 모델이 알 수 있도록 표시
    if (m.role === 'assistant' && m.action === 'summarize') {
      content += '\n(이 턴에 사용자에게 "이해한 내용" 정리 카드가 표시되었습니다.)';
    }
    msgs.push({ role: m.role, content });
  }
  return msgs;
}

/** Anthropic API 규칙: 첫 메시지는 user, 같은 역할 연속 금지, 마지막은 user */
function toApiMessages(msgs) {
  const out = [];
  for (const m of msgs.slice(-HISTORY_WINDOW)) {
    if (out.length === 0 && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  if (out.length === 0 || out[out.length - 1].role !== 'user') {
    throw new BadRequest('마지막 메시지는 사용자 메시지여야 합니다.');
  }
  return out;
}

const userTexts = (msgs) => msgs.filter((m) => m.role === 'user').map((m) => m.content);

// ── LLM 호출 + 용어 유출 1회 재시도 ─────────────────────────────

async function callGuarded(llm, { system, messages, tool, said, pick }) {
  let out = await llm({ system, messages, tool });
  const leaked = findLeakedTerms(pick(out), said);
  if (leaked.length) {
    console.warn('[guard] 사용자가 말하지 않은 용어 감지 → 재작성 요청:', leaked.join(', '));
    out = await llm({ system: system + correctionNote(leaked), messages, tool });
    const still = findLeakedTerms(pick(out), said);
    if (still.length) console.warn('[guard] 재작성 후에도 남음:', still.join(', '));
  }
  return out;
}

// ── 1) 대화 턴 ─────────────────────────────────────────────────

export async function chatTurn(llm, body) {
  const msgs = cleanMessages(body?.messages);
  const apiMessages = toApiMessages(msgs);
  const prev = sanitizeIncomingState(body?.state ?? emptyState());
  const phase = body?.phase === 'confirming' ? 'confirming' : 'intake';
  const userTurns = msgs.filter((m) => m.role === 'user').length;

  const system = buildChatSystem({ state: prev, phase, userTurns });
  const call = (sys) =>
    callGuarded(llm, {
      system: sys,
      messages: apiMessages,
      tool: CHAT_TOOL(STATE_SCHEMA),
      said: userTexts(msgs),
      pick: (o) => [o.reply, o.state],
    });
  let out = await call(system);
  let state = normalizeState(out.state, prev);

  // 확인 체크리스트 게이트(구조 규칙): 확인하지 않은 항목이 남았는데 정리로 넘어가려 하면
  // 정리하지 말고 남은 항목을 묻도록 1회 다시 요청한다. (충분히 대화했으면 통과)
  if (phase === 'intake' && out.next_action === 'summarize' && userTurns < 7) {
    const pending = pendingCoverage(state);
    if (pending.length) {
      out = await call(
        system +
          `\n\n## 정정 지시\n아직 확인하지 않은 항목이 있습니다: ${pending.join(', ')}. 정리 카드로 넘어가지 말고(next_action은 "ask"), 이 중 가장 중요한 1~2개를 자연스럽게 물어보세요. 이미 사용자가 말한 내용이면 known으로, 사용자 이야기상 해당 없음이 명백하면 not_applicable로 표시하세요.`,
      );
      state = normalizeState(out.state, prev);
    }
  }
  let action = ['ask', 'summarize', 'generate_items', 'reply_only'].includes(out.next_action)
    ? out.next_action
    : 'ask';

  // 서버 안전장치(의미 판단이 아니라 "순서" 규칙):
  //  - 정리 카드를 보여주기 전에는 ITEM 생성으로 갈 수 없다.
  //  - 정리할 최소 정보(쟁점+상황/원하는 결과)가 없으면 정리 카드를 보여줄 수 없다.
  if (action === 'generate_items' && phase !== 'confirming') action = 'summarize';
  if (action === 'summarize' && !isStateUsable(state)) action = 'ask';
  if (action === 'generate_items' && !isStateUsable(state)) action = 'ask';

  const nextPhase =
    action === 'summarize' ? 'confirming' : action === 'generate_items' ? 'items' : action === 'ask' ? 'intake' : phase;

  const reply = String(out.reply || '').trim() || '말씀을 조금 더 들려주시겠어요?';
  return { reply, action, phase: nextPhase, state };
}

// ── 2) ITEM 생성 ───────────────────────────────────────────────

export async function createItems(llm, body) {
  const msgs = cleanMessages(body?.messages);
  const prev = sanitizeIncomingState(body?.state);
  if (!isStateUsable(prev)) throw new BadRequest('정리된 협상 내용이 아직 없습니다.');

  const out = await callGuarded(llm, {
    system: buildItemsSystem({ state: prev }),
    messages: [
      {
        role: 'user',
        content: '위 협상 상태를 협상 ITEM으로 구조화해주세요.\n\n[참고: 사용자가 실제로 한 말]\n' + userTexts(msgs).slice(-12).join('\n---\n'),
      },
    ],
    tool: ITEMS_TOOL(ITEM_SCHEMA),
    said: userTexts(msgs),
    pick: (o) => [o.reply, o.items],
  });

  const items = normalizeItems((Array.isArray(out.items) ? out.items : []).map((it) => ({ ...it, id: '' })));
  if (items.length === 0) throw Object.assign(new Error('ITEM을 만들지 못했습니다.'), { status: 502 });
  return {
    reply: String(out.reply || '').trim() || `협상 ITEM ${items.length}개로 정리했어요.`,
    state: { ...prev, items },
  };
}

// ── 3) 자연어 수정 ─────────────────────────────────────────────

export async function reviseItems(llm, body) {
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) throw new BadRequest('수정 요청 내용이 필요합니다.');
  if (instruction.length > 600) throw new BadRequest('수정 요청은 600자까지 입력할 수 있습니다.');

  const msgs = body?.messages ? cleanMessages(body.messages) : [];
  const prev = sanitizeIncomingState(body?.state);
  if (prev.items.length === 0) throw new BadRequest('수정할 ITEM이 없습니다.');

  const out = await callGuarded(llm, {
    system: buildEditSystem({ state: prev, items: prev.items }),
    messages: [{ role: 'user', content: instruction }],
    tool: REVISE_TOOL(ITEM_SCHEMA),
    said: [...userTexts(msgs), instruction],
    pick: (o) => [o.reply, o.items],
  });

  const items = normalizeItems(out.items);
  // 기존 id가 유지된 항목은 그대로, 새 id는 새 항목
  const finalItems = items.length ? items : prev.items;
  return {
    reply: String(out.reply || '').trim() || '반영했어요.',
    state: { ...prev, items: finalItems },
  };
}
