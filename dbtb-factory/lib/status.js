// PRD 3. 핵심 공정·상태 모델
export const STATUSES = ['DRAFT', 'PROJECT_READY', 'MATERIAL_READY', 'PROTOTYPE_SAVED', 'REVIEWED', 'PROCESSING_NEW_VERSION', 'FINALIZING', 'WAREHOUSED', 'EXTERNAL_HANDOFF'];

export const STATUS_LABELS = {
  DRAFT: '초안',
  PROJECT_READY: '프로젝트 설계 완료',
  MATERIAL_READY: '원재료 투입',
  PROTOTYPE_SAVED: '프로토타입 저장',
  REVIEWED: '공장장 검수 완료',
  PROCESSING_NEW_VERSION: '재가공 중',
  FINALIZING: '최종 조립 중',
  WAREHOUSED: '창고 입고',
  EXTERNAL_HANDOFF: '외부 AI 이관',
};

// 이벤트 → (허용되는 현재 상태들, 다음 상태)
const T = {
  project_defined: [['DRAFT'], 'PROJECT_READY'],
  material_added: [['PROJECT_READY'], 'MATERIAL_READY'],
  prototype_saved: [['PROJECT_READY', 'MATERIAL_READY', 'PROCESSING_NEW_VERSION', 'PROTOTYPE_SAVED', 'REVIEWED', 'FINALIZING', 'WAREHOUSED', 'EXTERNAL_HANDOFF'], 'PROTOTYPE_SAVED'],
  review_done: [['PROTOTYPE_SAVED', 'REVIEWED'], 'REVIEWED'],
  reprocess_chosen: [['REVIEWED', 'PROTOTYPE_SAVED', 'FINALIZING', 'WAREHOUSED', 'EXTERNAL_HANDOFF'], 'PROCESSING_NEW_VERSION'],
  finalize_chosen: [['REVIEWED', 'PROTOTYPE_SAVED', 'WAREHOUSED', 'EXTERNAL_HANDOFF'], 'FINALIZING'],
  package_saved: [['FINALIZING', 'REVIEWED', 'PROTOTYPE_SAVED', 'WAREHOUSED', 'EXTERNAL_HANDOFF'], 'WAREHOUSED'],
  handoff: [['WAREHOUSED', 'EXTERNAL_HANDOFF'], 'EXTERNAL_HANDOFF'],
};

/** 허용되지 않는 전이는 무시하고 현재 상태를 그대로 돌려준다(상태가 뒤로 가지 않게). */
export function transition(status, event) {
  const rule = T[event];
  if (!rule) return status;
  return rule[0].includes(status) ? rule[1] : status;
}
