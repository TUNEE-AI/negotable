// ─────────────────────────────────────────────────────────────
// 공장 카탈로그 — 원재료 종류, 가공설비(A군), 특별 실험실(B군),
// 출력 형식, 외부 AI 링크, 공장장 객관식 선택지.
// 관리자가 바꾸고 싶은 값은 대부분 이 파일에 있습니다.
// ─────────────────────────────────────────────────────────────

export const MATERIAL_TYPES = {
  book: { label: '책', icon: '📕', fields: ['title', 'author', 'isbn', 'note'], hint: '제목·저자·ISBN(선택). 원문이 없으면 "공개자료 기반 관점 분석"으로 처리합니다.' },
  paper: { label: '논문', icon: '📄', fields: ['title', 'author', 'doi', 'uri', 'excerpt', 'note'], hint: '제목/DOI/링크. 분석할 초록·발췌문을 붙여넣어 주세요.' },
  ebook: { label: '전자책', icon: '💾', fields: ['title', 'author', 'file_name', 'excerpt', 'note'], hint: '본인이 권리를 가진 PDF/EPUB. 원문은 재배포되지 않습니다.' },
  video: { label: '영상', icon: '🎞', fields: ['title', 'author', 'uri', 'excerpt', 'note'], hint: '스크립트/자막을 붙여넣거나 이용이 허용된 링크를 입력하세요.' },
  culture: { label: '문화콘텐츠', icon: '🎭', fields: ['title', 'author', 'genre', 'excerpt', 'note'], hint: '영화·연극·드라마 작품명과 감상/자료.' },
  news: { label: '뉴스', icon: '📰', fields: ['title', 'author', 'uri', 'excerpt', 'note'], hint: '기사 본문을 붙여넣거나 허용된 URL을 입력하세요.' },
};

export const RIGHTS_STATUS = {
  user_provided: '사용자 제공',
  public: '공개 자료',
  rights_confirmed: '권리 확인됨',
  unknown: '권리 미확인',
};

// A군 — 자동 가공설비 (PRD 6.1)
export const TOOLS = [
  { id: 'swot', name: 'SWOT', category: 'A', input: '프로젝트/시장/강·약점 자료', output: '4분면 SWOT + 실행전략', sections: ['강점(S)', '약점(W)', '기회(O)', '위협(T)', 'SO/ST/WO/WT 실행전략'], keywords: ['경쟁', '강점', '약점', '시장', '전략', '매장', '사업'] },
  { id: 'stp', name: 'STP', category: 'A', input: '고객·시장 자료', output: '세분시장·타깃·포지셔닝', sections: ['시장 세분화', '타깃 선정', '포지셔닝 문장', '포지셔닝 맵 축'], keywords: ['고객', '타깃', '세분', '포지셔닝', '브랜드', '대상'] },
  { id: 'funnel', name: '퍼널', category: 'A', input: '유입·구매단계·수치', output: '단계별 병목 및 개선방안', sections: ['인지', '관심', '구매', '재방문/유지', '추천', '병목과 개선 우선순위'], keywords: ['재방문', '전환', '유입', '매출', '구매', '마케팅', '리텐션', '퍼널'] },
  { id: 'lean', name: '린 스타트업', category: 'A', input: '사업 가설·제약', output: 'MVP·실험 설계·학습 지표', sections: ['핵심 가설', 'MVP 정의', '실험 설계', '학습 지표', '피벗/지속 기준'], keywords: ['창업', '아이템', '가설', 'mvp', '스타트업', '검증', '신규'] },
  { id: '4p', name: '4P', category: 'A', input: '제품·가격·채널·홍보', output: '마케팅 믹스 개선안', sections: ['Product', 'Price', 'Place', 'Promotion', '믹스 조정안'], keywords: ['가격', '채널', '홍보', '제품', '판매', '마케팅'] },
  { id: 'blueocean', name: '블루오션', category: 'A', input: '경쟁 요소·고객 대안', output: '제거/감소/증가/창조 전략', sections: ['업계 경쟁 요소', '제거', '감소', '증가', '창조', '새 가치 곡선'], keywords: ['차별화', '경쟁', '레드오션', '새로운', '혁신'] },
  { id: 'bmc', name: '비즈니스 모델 캔버스', category: 'A', input: '가치·고객·파트너·비용', output: '9블록 사업구조', sections: ['고객 세그먼트', '가치 제안', '채널', '고객 관계', '수익원', '핵심 자원', '핵심 활동', '핵심 파트너', '비용 구조'], keywords: ['수익', '사업모델', '비즈니스', '파트너', '비용', '구조'] },
  { id: 'pest', name: 'PEST', category: 'A', input: '지역·산업·기간', output: '외부 환경 요인과 영향', sections: ['정치/규제(P)', '경제(E)', '사회/문화(S)', '기술(T)', '영향도와 대응'], keywords: ['정책', '규제', '트렌드', '환경', '산업', '거시'] },
  { id: 'porter5', name: '포터 5 Forces', category: 'A', input: '산업·경쟁자 정보', output: '경쟁구조 가설 및 리스크', sections: ['기존 경쟁 강도', '신규 진입 위협', '대체재 위협', '공급자 교섭력', '구매자 교섭력', '종합 리스크'], keywords: ['산업', '경쟁자', '진입', '대체', '공급'] },
  { id: 'journey', name: '고객 여정', category: 'A', input: '고객 행동·접점', output: '단계별 고충·기회', sections: ['인지 단계', '탐색 단계', '구매/이용 단계', '사후 단계', '고충(Pain) 목록', '기회(Gain) 목록'], keywords: ['고객', '경험', '여정', '접점', '서비스', '재방문'] },
  { id: 'designthinking', name: '디자인 씽킹', category: 'A', input: '고객 문제·인터뷰', output: '문제 정의·아이디어·검증', sections: ['공감', '문제 정의(POV)', '아이디어', '프로토타입', '테스트 계획'], keywords: ['문제', '인터뷰', '공감', '사용자', '아이디어', '학습'] },
  { id: 'scamper', name: 'SCAMPER', category: 'A', input: '제품·서비스 아이디어', output: '변형·조합 아이디어', sections: ['대체(S)', '결합(C)', '적용(A)', '수정/확대(M)', '용도 변경(P)', '제거(E)', '재배열(R)'], keywords: ['아이디어', '변형', '신제품', '개선', '창의'] },
];

export const DEFAULT_RECOMMENDATION = ['swot', 'funnel', 'lean'];

/** 프로젝트 내용과 원재료를 보고 설비 3종을 추천한다(결정적·무비용 휴리스틱). */
export function recommendTools(project, materials = []) {
  const text = [project?.name, project?.goal, project?.audience, project?.expected, ...materials.map((m) => `${m.title} ${m.note || ''}`)]
    .join(' ')
    .toLowerCase();
  const scored = TOOLS.map((t, idx) => ({
    id: t.id,
    score: t.keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0) + (DEFAULT_RECOMMENDATION.includes(t.id) ? 0.5 : 0) - idx * 0.001,
  })).sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.id);
}

// B군 — 특별 대화형 시스템 (PRD 6.2). 역할 이름·규칙은 여기서 바꿀 수 있습니다(관리자 설정).
export const LABS = {
  masks: {
    id: 'masks',
    name: '여덟 가면 회의',
    desc: '여덟 개의 역할이 동시에 관점을 내고, 서로 반박·보완합니다.',
    disclaimer: '모든 가면은 AI가 연기하는 사고 역할입니다.',
    participants: [
      { id: 'sun', name: '햇빛 가면', role: '낙관가 — 가능성과 이점을 찾는다' },
      { id: 'iron', name: '무쇠 가면', role: '비판가 — 위험과 허점을 찌른다' },
      { id: 'ledger', name: '장부 가면', role: '사실 검증가 — 숫자·근거·가정을 구분한다' },
      { id: 'heart', name: '심장 가면', role: '감정가 — 고객과 팀의 감정 반응을 본다' },
      { id: 'spark', name: '불꽃 가면', role: '발명가 — 엉뚱한 대안과 조합을 낸다' },
      { id: 'mirror', name: '거울 가면', role: '고객 대변인 — 실제 사용자 입장에서 말한다' },
      { id: 'coin', name: '동전 가면', role: '재무관 — 비용·수익·자원을 따진다' },
      { id: 'clock', name: '시계 가면', role: '진행자 — 논의를 정리하고 다음 질문을 정한다' },
    ],
  },
  shark: {
    id: 'shark',
    name: 'AI 샤크탱크',
    desc: '아이디어를 피칭하면 심사역들이 가정을 추궁하고 개선점을 찾습니다.',
    disclaimer: '심사역은 가상 캐릭터입니다. 투자 성공률을 산정하지 않습니다.',
    participants: [
      { id: 'fin', name: '재무 심사역', role: '수익 구조, 단위 경제성, 숫자의 가정을 추궁' },
      { id: 'mkt', name: '시장 심사역', role: '시장 크기, 경쟁, 차별화 근거를 추궁' },
      { id: 'ops', name: '운영 심사역', role: '실행 가능성, 공급·인력·프로세스를 추궁' },
      { id: 'cus', name: '고객 심사역', role: '실제 고객 문제와 지불 의향을 추궁' },
      { id: 'risk', name: '리스크 심사역', role: '법·규제·평판·의존성 위험을 추궁' },
    ],
  },
  celeb: {
    id: 'celeb',
    name: '유명인 관점 브레인스토밍',
    desc: '공개적으로 알려진 사상·스타일을 바탕으로 한 추정형 캐릭터 토론입니다.',
    disclaimer: '가상 시뮬레이션: 실제 인물의 발언이 아니며, 실제 인용을 만들지 않습니다.',
    suggestions: ['스티브 잡스', '피터 드러커', '세스 고딘', '레오나르도 다빈치', '워런 버핏', '마리 퀴리', '이순신', '오프라 윈프리'],
    participants: [],
  },
};

export const LAB_LIMITS = {
  maxUserTurns: Number((typeof process !== 'undefined' && process.env.LAB_MAX_USER_TURNS) || 12),
  maxHistoryMessages: 40, // 컨텍스트 상한(최근 메시지만 모델에 전달)
};

// DATA-03 공장장 객관식
export const REVIEW_OPTIONS = [
  { id: 'changed', label: '방향이 달라졌다', next: 'tools' },
  { id: 'new_idea', label: '새로운 아이디어가 생겼다', next: 'lab' },
  { id: 'compare', label: '더 비교해보고 싶다', next: 'prototypes' },
  { id: 'other_tool', label: '다른 설비로 재가공', next: 'tools' },
  { id: 'finalize', label: '최종 마무리', next: 'assembly' },
];

// 8.1 출력 형식
export const FORMATS = {
  doc: { label: '문서', spec: '목차·상세 본문·논거·톤·검토 사항·작성 지시문' },
  ppt: { label: 'PPT', spec: '슬라이드별 타이틀·핵심 메시지·비주얼 제안·발표 대상·디자인 톤' },
  video: { label: '영상', spec: '목적·대상·씬별 스크립트·내레이션·자막·편집·길이 가이드' },
  podcast: { label: '팟캐스트', spec: '에피소드 구성·화자·핵심 논점·사실 확인 주석' },
  other: { label: '기타', spec: '공통 프로젝트 브리프 + 선택한 결과물별 제작 규격' },
};

// 8.2 외부 서비스 링크 (공식 URL)
export const PROVIDERS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', note: '설계문서를 복사해 붙여넣거나 .md 파일을 첨부하세요.' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', note: '설계문서를 복사해 붙여넣거나 파일을 첨부하세요.' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', note: '설계문서를 복사해 붙여넣거나 파일을 첨부하세요.' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', note: '설계문서를 복사해 붙여넣으세요.' },
  { id: 'notebooklm', name: 'NotebookLM', url: 'https://notebooklm.google.com/', note: '출처 자료 업로드는 서비스별 요건과 권리 범위 안에서만 가능합니다. 원문 업로드 전 권리를 확인하세요.' },
];

// 9.2 신뢰도 레이어
export const EVIDENCE_LAYERS = {
  confirmed: '출처 확인',
  author_claim: '저자 주장',
  ai_interpretation: 'AI 해석',
  hypothesis: '가설/검증 필요',
  user_input: '사용자 제공',
};

export function publicCatalog() {
  return { materialTypes: MATERIAL_TYPES, rights: RIGHTS_STATUS, tools: TOOLS.map(({ keywords, ...t }) => t), labs: LABS, labLimits: LAB_LIMITS, reviewOptions: REVIEW_OPTIONS, formats: FORMATS, providers: PROVIDERS, evidenceLayers: EVIDENCE_LAYERS };
}
