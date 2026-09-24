// UI 확인용 하네스: 가짜 LLM(고정 응답)으로 서버를 띄워 화면 흐름만 점검합니다.
// AI 품질 테스트가 아닙니다. 사용법: node tests/ui-harness.js  → http://localhost:4173
import { createApp } from '../app.js';

let turn = 0;
const llm = async ({ tool }) => {
  if (tool.name === 'negotiation_turn') {
    turn++;
    const state = {
      counterparty: '아파트 관리업체',
      situation: '지정주차 조건을 명확히 합의하고 싶음',
      issues: ['지정주차면 배정', '방문차량 이용 조건', '조건 변경 시 안내 방식'],
      desiredOutcome: '지정주차 사용 조건에 대한 서면 합의',
      conditions: [{ kind: 'scope', topic: '주차면', detail: '세대별 지정 1면' }, { kind: 'period', topic: '적용 기간', detail: '아직 미정' }],
      rationale: ['현재 조건이 구두로만 안내됨'],
      existingAgreements: [],
      confirmedFacts: ['관리업체와 지정주차 조건을 합의하고 싶다'],
      unknownFacts: ['적용 기간'],
    };
    if (turn === 1) return { reply: '제가 이해한 내용을 먼저 정리해보겠습니다.', next_action: 'summarize', state };
    return { reply: '좋아요, 협상 ITEM으로 나눠볼게요.', next_action: 'generate_items', state };
  }
  if (tool.name === 'create_items')
    return {
      reply: '협상 ITEM 3개로 정리했어요. 카드를 직접 고치거나 아래 입력창에 말로 수정을 요청해보세요.',
      items: [
        { title: '지정주차면 배정', headline: '세대별 지정 1면', issue: '지정주차면의 배정 방식과 사용 범위 확인', request: '세대별로 지정 주차면 1면을 배정하고 그 위치를 서면으로 확정한다.', scope: '세대 전용 주차면 1면', rationale: '현재 조건이 구두 안내에 그치고 있어 명확한 기준이 필요함' },
        { title: '방문차량 이용 조건', headline: '방문차량 사전 등록', issue: '방문차량의 이용 범위와 절차 협의', request: '방문차량은 사전 등록 후 지정된 구역을 이용한다.', period: '방문 당일 기준' },
        { title: '조건 변경 안내', headline: '변경 전 사전 공지', issue: '주차 조건이 바뀔 때의 안내 절차', request: '조건 변경 시 시행 전에 서면으로 안내하고 의견을 받는다.', rationale: '예측 가능한 운영을 위함' },
      ],
    };
  if (tool.name === 'revise_items') return { reply: '2번 항목 표현을 부드럽게 바꿨어요.', items: null };
  return {};
};
createApp({ llm, config: { model: 'fake', dailyLlmLimit: 9999, rateLimitPer15Min: 9999, applyUrl: '', benefitText: 'NegoTable 정식 서비스 출시 후 1년 무료 이용 혜택' }, dataDir: '/tmp/nego-ui' }).listen(4173, () => console.log('http://localhost:4173'));
