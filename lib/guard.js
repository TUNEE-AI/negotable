// ─────────────────────────────────────────────────────────────
// 용어 유출 감시 (안전망)
//
// 이 파일은 "의미를 이해하는" 로직이 아닙니다. 대화 이해는 전적으로 LLM이 합니다.
// 여기서는 이전 프로토타입의 실패 사례 — 사용자가 말하지 않은 업종 특화 용어가
// AI 출력에 섞여 나오는 것 — 을 "탐지"해서, 발견되면 LLM에게 다시 쓰라고 1회 되돌려 보냅니다.
//
// 사용자가 그 용어를 직접 말했다면(대화 어디에서든) 통과시킵니다.
// 목록은 자유롭게 늘리거나 줄여도 됩니다.
// ─────────────────────────────────────────────────────────────

export const WATCHED_TERMS = [
  '공사대금',
  '공사비',
  '추가공사비',
  '잔금',
  '중도금',
  '계약금',
  '착수금',
  '용역대금',
  '퇴직금',
  '임대보증금',
  '보증금',
];

const squash = (s) => String(s).replace(/\s+/g, '');

/** 객체/배열/문자열 안의 모든 문자열을 이어붙인 텍스트 */
export function collectText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (typeof value === 'object') return Object.values(value).map(collectText).join('\n');
  return '';
}

/**
 * @param {unknown} output      AI 출력(reply, state, items …)
 * @param {string[]} userTexts  사용자가 실제로 입력한 모든 텍스트
 * @returns {string[]}          사용자가 말하지 않았는데 출력에 등장한 감시 용어
 */
export function findLeakedTerms(output, userTexts, terms = WATCHED_TERMS) {
  const out = squash(collectText(output));
  const said = squash(userTexts.join('\n'));
  return terms.filter((t) => out.includes(t) && !said.includes(t));
}

export function correctionNote(leaked) {
  return `\n\n## 정정 지시\n직전 응답에 사용자가 말한 적 없는 용어(${leaked
    .map((t) => `"${t}"`)
    .join(', ')})가 포함되어 있었습니다. 그 용어와 그 의미에 기대지 말고, 사용자가 실제로 쓴 표현만으로 상황과 조건을 다시 서술해 응답을 처음부터 다시 작성하세요.`;
}
