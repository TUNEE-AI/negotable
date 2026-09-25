// ─────────────────────────────────────────────────────────────
// negotiationState — 대화 전체에서 "현재 확정된 협상 상태"를 담는 구조
//
//  {
//    counterparty:        string      상대방 (사용자가 말한 표현 그대로의 일반화된 호칭)
//    situation:           string      현재 상황 (중립적 서술)
//    issues:              string[]    핵심 쟁점
//    desiredOutcome:      string      사용자가 원하는 결과
//    conditions:          Condition[] 조정하고 싶은 조건들 (금액/기간/범위/역할/권리 …)
//    rationale:           string[]    요구를 뒷받침하는 근거 (사용자가 말한 것만)
//    existingAgreements:  string[]    상대방과 이미 합의된 내용
//    confirmedFacts:      string[]    사용자가 직접 말한 확정 사실
//    unknownFacts:        string[]    아직 정해지지 않았거나 사용자가 모르는 내용
//    coverage:            {항목: known|unknown|not_applicable|not_asked}  정리 전 확인 체크리스트
//    items:               Item[]      확정 후 생성·수정되는 협상 ITEM
//  }
//
//  Condition = { kind: 'amount'|'period'|'scope'|'role'|'right'|'service'|'other',
//                topic: string, detail: string }
//  Item      = { id, kind: 'amount'|'period'|'condition', title, headline, issue, request, scope, period, amount, rationale }
//
// 매 턴마다 LLM이 이 상태 "전체"를 갱신해서 돌려주고, 서버가 검증·정리한 뒤
// 클라이언트에 반환합니다. 다음 턴에는 이 상태가 다시 프롬프트에 들어갑니다.
// ─────────────────────────────────────────────────────────────

// 정리 카드를 보여주기 전에 확인해야 하는 항목들과 그 상태
export const COVERAGE_KEYS = ['counterparty', 'situation', 'issues', 'desiredOutcome', 'conditions', 'amount', 'period', 'rationale'];
export const COVERAGE_VALUES = ['not_asked', 'known', 'unknown', 'not_applicable'];
export const emptyCoverage = () => Object.fromEntries(COVERAGE_KEYS.map((k) => [k, 'not_asked']));

// ITEM은 "조건의 종류"로 나눈다: 금액 / 기간 / 조건(범위·역할·권리·사용권 등 그 외)
export const ITEM_KINDS = ['amount', 'period', 'condition'];

export const CONDITION_KINDS = ['amount', 'period', 'scope', 'role', 'right', 'service', 'other'];

const LIMITS = {
  short: 200,
  long: 900,
  arrayLen: 12,
  itemCount: 10,
};

export function emptyState() {
  return {
    counterparty: '',
    situation: '',
    issues: [],
    desiredOutcome: '',
    conditions: [],
    rationale: [],
    existingAgreements: [],
    confirmedFacts: [],
    unknownFacts: [],
    coverage: emptyCoverage(),
    items: [],
  };
}

// ── JSON Schema (LLM 도구 입력 스키마) ─────────────────────────

const str = (description) => ({ type: 'string', description });
const strArr = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const STATE_SCHEMA = {
  type: 'object',
  description: '갱신된 협상 상태 전체. 이전 상태의 내용을 유지하면서 이번 발언을 통합한 결과.',
  properties: {
    counterparty: str('상대방. 알 수 없으면 빈 문자열.'),
    situation: str('현재 상황을 중립적 문장으로. 알 수 없으면 빈 문자열.'),
    issues: strArr('핵심 쟁점 목록. 각 쟁점은 짧은 명사구.'),
    desiredOutcome: str('사용자가 원하는 결과. 알 수 없으면 빈 문자열.'),
    conditions: {
      type: 'array',
      description: '사용자가 조정하고 싶은 조건. 사용자가 말한 것만 담는다.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: CONDITION_KINDS },
          topic: str('무엇에 대한 조건인지 (짧게)'),
          detail: str('조건 내용. 사용자가 말한 값(금액·기간 등)을 그대로 반영.'),
        },
        required: ['kind', 'topic', 'detail'],
      },
    },
    rationale: strArr('요구의 근거. 사용자가 말한 것만.'),
    existingAgreements: strArr('상대방과 이미 합의된 내용. 사용자가 말한 것만.'),
    confirmedFacts: strArr('사용자가 직접 말한 확정 사실. 추측 금지.'),
    unknownFacts: strArr('아직 정해지지 않았거나 사용자가 모른다고/정하지 않았다고 한 내용.'),
    coverage: {
      type: 'object',
      description:
        '정리 전 확인 체크리스트. 항목별로 known=사용자가 말함, unknown=물었는데 모르거나 아직 안 정함, not_applicable=이 협상에는 해당 없거나 제안을 쓰는 데 필요 없음이 사용자 이야기에서 분명함, not_asked=아직 확인하지 않았고 제안에 필요할 수 있음.',
      properties: Object.fromEntries(COVERAGE_KEYS.map((k) => [k, { type: 'string', enum: COVERAGE_VALUES }])),
      required: COVERAGE_KEYS,
    },
  },
  required: [
    'counterparty',
    'situation',
    'issues',
    'desiredOutcome',
    'conditions',
    'rationale',
    'existingAgreements',
    'confirmedFacts',
    'unknownFacts',
    'coverage',
  ],
};

export const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: str('기존 항목을 수정·유지할 때는 받은 id를 그대로. 새로 만든 항목이면 빈 문자열.'),
    kind: { type: 'string', enum: ITEM_KINDS, description: '이 ITEM이 다루는 조건의 종류. amount=금액·보상·비용, period=기간·일정·기한, condition=그 밖의 범위·역할·책임·권리 등. 한 ITEM에는 한 종류만.' },
    title: str('ITEM 제목. 짧은 명사구(20자 안팎).'),
    headline: str(
      '상대방이 카드를 보자마자 알아야 할 핵심 조건 한 줄(24자 안팎). 금액이 있으면 금액, 없으면 핵심 기간·범위·조건을 짧게.',
    ),
    issue: str('무엇에 대한 협의인지 한 줄. 중립적으로.'),
    request: str('제안자가 요청하는 내용.'),
    scope: str('범위. 해당 없으면 빈 문자열.'),
    period: str('기간·일정. 사용자가 말했거나 명백할 때만. 없으면 빈 문자열.'),
    amount: str('금액. 사용자가 말했을 때만. 없으면 빈 문자열.'),
    rationale: str('근거. 사용자가 말한 근거에 기반. 없으면 빈 문자열.'),
  },
  required: ['kind', 'title', 'headline', 'request'],
};

// ── 정리(normalize) ────────────────────────────────────────────

const clampStr = (v, max = LIMITS.short) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const clampArr = (v, max = LIMITS.short) =>
  Array.isArray(v)
    ? v
        .map((x) => clampStr(x, max))
        .filter(Boolean)
        .slice(0, LIMITS.arrayLen)
    : [];

export function newId() {
  return 'it_' + Math.random().toString(36).slice(2, 9);
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const item = {
    id: clampStr(raw.id, 40) || newId(),
    kind: ITEM_KINDS.includes(raw.kind) ? raw.kind : '',
    title: clampStr(raw.title, 80),
    headline: clampStr(raw.headline, 80),
    issue: clampStr(raw.issue, 200),
    request: clampStr(raw.request, LIMITS.long),
    scope: clampStr(raw.scope, 300),
    period: clampStr(raw.period, 120),
    amount: clampStr(raw.amount, 80),
    rationale: clampStr(raw.rationale, LIMITS.long),
  };
  if (!item.title && !item.request) return null;
  if (!item.title) item.title = item.request.slice(0, 24);
  if (!item.headline) item.headline = item.amount || item.period || '조건 협의';
  return item;
}

export function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const seen = new Set();
  const out = [];
  for (const r of rawItems.slice(0, LIMITS.itemCount)) {
    const it = normalizeItem(r);
    if (!it) continue;
    while (seen.has(it.id)) it.id = newId();
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function normalizeCoverage(raw) {
  const out = emptyCoverage();
  if (raw && typeof raw === 'object') for (const k of COVERAGE_KEYS) if (COVERAGE_VALUES.includes(raw[k])) out[k] = raw[k];
  return out;
}

export const pendingCoverage = (state) => COVERAGE_KEYS.filter((k) => state.coverage?.[k] === 'not_asked');

/**
 * LLM(또는 클라이언트)이 준 상태를 검증해 안전한 형태로 만든다.
 * @param {object} raw   새 상태 후보
 * @param {object} prev  이전 상태 (items 보존용)
 */
export function normalizeState(raw, prev = emptyState()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const conditions = Array.isArray(r.conditions)
    ? r.conditions
        .map((c) => ({
          kind: CONDITION_KINDS.includes(c?.kind) ? c.kind : 'other',
          topic: clampStr(c?.topic, 100),
          detail: clampStr(c?.detail, 300),
        }))
        .filter((c) => c.topic || c.detail)
        .slice(0, LIMITS.arrayLen)
    : [];
  return {
    counterparty: clampStr(r.counterparty, 100),
    situation: clampStr(r.situation, LIMITS.long),
    issues: clampArr(r.issues, 160),
    desiredOutcome: clampStr(r.desiredOutcome, 500),
    conditions,
    rationale: clampArr(r.rationale, 300),
    existingAgreements: clampArr(r.existingAgreements, 300),
    confirmedFacts: clampArr(r.confirmedFacts, 300),
    unknownFacts: clampArr(r.unknownFacts, 300),
    coverage: normalizeCoverage(r.coverage),
    items: normalizeItems(prev?.items),
  };
}

/** 클라이언트가 보낸 state를 신뢰하지 않고 같은 규칙으로 정리 */
export function sanitizeIncomingState(raw) {
  const base = normalizeState(raw, { items: raw?.items });
  return base;
}

export function isStateUsable(s) {
  return Boolean(s && s.issues.length > 0 && (s.situation || s.desiredOutcome));
}

/** 프롬프트에 넣을 상태(items 제외) */
export function stateForPrompt(s) {
  const { items, ...rest } = s;
  return rest;
}
