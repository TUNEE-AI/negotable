// ─────────────────────────────────────────────────────────────
// NegoTable 설정 — 자주 바꾸는 값은 이 파일 한 곳에 모아두었습니다.
// 환경변수(.env)로도 덮어쓸 수 있습니다.
// ─────────────────────────────────────────────────────────────
export default {
  // "테스트 완료 신청하기" 버튼이 이동할 Google Form 주소.
  // 아직 없다면 비워두세요. (버튼을 누르면 "준비 중" 안내가 표시됩니다.)
  applyUrl: process.env.APPLY_URL || '',

  // 상대방 Preview 아래 안내 문구에 들어가는 혜택 문구
  benefitText: 'NegoTable 정식 서비스 출시 후 1년 무료 이용 혜택',

  // 랜딩 페이지 소개 영상. 유튜브에 업로드한 뒤 그 영상의 ID만 넣으면 됩니다.
  // 예: https://youtube.com/watch?v=ABC123xyz 라면 'ABC123xyz'
  // 직접 올린 영상 파일이 있으면 그 파일이 우선 표시됩니다(아래 관리자 업로드 참고).
  demoVideoId: process.env.DEMO_VIDEO_ID || 'IdW1zD_k33w',

  // 자체 업로드 영상의 재생 전 미리보기 이미지(포스터). 기본 제공 영상 기준이며,
  // 관리자가 다른 영상으로 교체하면 이 포스터와 실제 내용이 다를 수 있다(MVP 단순화).
  posterUrl: '/images/showreel-poster.jpg',

  // 관리자 영상 업로드(/admin/video.html)에 필요한 비밀 값. 반드시 직접 설정하세요.
  // 비어 있으면 업로드 기능이 막힙니다(회원가입 없이 아무나 영상을 바꿔치기하지 못하도록).
  adminToken: process.env.ADMIN_TOKEN || '',

  // 업로드 가능한 영상 최대 용량(MB)
  maxVideoMb: Number(process.env.MAX_VIDEO_MB || 80),

  // 사용 모델
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',

  // AI 제공사 선택: 'anthropic'(기본) 또는 'openrouter'.
  // openrouter로 두면 아래 OPENROUTER_* 값으로 무료·저비용 모델을 대신 쓸 수 있습니다.
  llmProvider: (process.env.LLM_PROVIDER || 'anthropic').toLowerCase(),
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  // 기본값은 도구 호출(tool calling)을 지원하는 무료 모델입니다. 다른 모델로 바꾸려면
  // 반드시 "도구 호출 지원" 여부를 OpenRouter 모델 목록에서 확인하세요 — 지원하지 않으면
  // 이 앱의 핵심 기능(정리된 JSON으로 응답받기)이 동작하지 않습니다.
  openrouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free',
  // 과금 방지 안전장치: 모델 이름에 ":free"가 없으면 기본적으로 호출을 막습니다.
  // 정말 유료 모델을 쓰기로 결정했을 때만 이 값을 true로 바꾸세요.
  allowPaidOpenrouterModel: process.env.ALLOW_PAID_OPENROUTER_MODEL === 'true',

  // 비용 보호 장치
  rateLimitPer15Min: Number(process.env.RATE_LIMIT_PER_15MIN || 60),
  dailyLlmLimit: Number(process.env.DAILY_LLM_LIMIT || 3000),

  // 이벤트 웹훅 (선택)
  eventWebhookUrl: process.env.EVENT_WEBHOOK_URL || '',
};
