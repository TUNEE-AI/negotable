# NegoTable — AI 중개 협상테이블 (시장검증용 MVP)

“사람과 싸우지 말고, 문제를 테이블에 올리세요.” · “하나의 협상, 여러 개의 합의.”

## 실행 (로컬)
```bash
npm install
cp .env.example .env        # ANTHROPIC_API_KEY 입력
npm start                   # http://localhost:3000
```
- 서버 배관 테스트(키 불필요): `npm test`
- **실제 LLM으로 5개 사례 테스트(키 필요)**: `npm run test:live` → 대화록은 `tests/out/*.md`
- 화면 흐름만 확인(가짜 AI): `node tests/ui-harness.js` → http://localhost:4173

## 배포 (Render 기준, 5분)
1. 이 폴더를 GitHub 저장소로 올립니다. (`.env`, `node_modules`는 `.gitignore`로 제외됨)
2. Render → New → Web Service → 저장소 선택
   - Build Command: `npm install` / Start Command: `npm start` / Node 20+
3. Environment 에 추가: `ANTHROPIC_API_KEY`, (선택) `APPLY_URL`, `DAILY_LLM_LIMIT`
4. 배포 완료 후 발급된 URL을 참가자에게 공유합니다.
Railway / Fly.io / Cloud Run 도 동일하게 `npm start` + 환경변수로 동작합니다. 서버는 세션을 저장하지 않으므로 인스턴스를 늘려도 됩니다.

> 무료 플랜은 파일이 재시작 시 사라지므로 설문 결과는 `EVENT_WEBHOOK_URL`(Google Apps Script 등)로 함께 받거나 로그(`[event]`)에서 확인하세요.

## AI 제공사 바꾸기 (Anthropic ↔ OpenRouter)
기본은 Anthropic(Claude)입니다. 비용 없이 테스트하고 싶다면 OpenRouter의 무료 모델로 바꿀 수 있습니다.

```
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-oss-120b:free   # 기본값. 다른 모델로 바꿔도 됨
```

**과금 방지 안전장치가 코드에 들어 있습니다.** `OPENROUTER_MODEL`에 `:free`가 붙지 않은 모델을 넣으면(오타나 실수 포함) 서버가 호출 자체를 막고 503 오류를 돌려줍니다. 정말 유료 모델을 쓰기로 결정했다면 `ALLOW_PAID_OPENROUTER_MODEL=true`를 함께 설정해야 합니다. 다만 이 안전장치는 **모델 이름만** 확인하므로, OpenRouter 계정에 크레딧을 충전해두고 유료 모델을 의도적으로 쓰는 경우까지 막지는 못합니다 — 그 경우는 스스로 비용을 인지하고 계신 상황일 것입니다.

⚠️ 무료 모델을 바꿔서 쓰려면 반드시 **도구 호출(tool calling)을 지원**하는 모델인지 먼저 확인하세요 ([목록](https://openrouter.ai/models?supported_parameters=tools)). 이 앱은 AI 응답을 구조화된 JSON으로 강제로 받는 방식으로 동작해서, 도구 호출을 지원하지 않는 모델을 쓰면 대화 자체가 안 됩니다. 무료 모델은 요청 한도가 낮고, 한국어 격식체 변환 품질이 Claude보다 떨어질 수 있으며, 예고 없이 목록에서 사라질 수 있습니다. 어댑터 코드는 `lib/llm-openrouter.js`에 있습니다.

## 자주 수정하는 곳
| 하고 싶은 일 | 위치 |
|---|---|
| Google Form 주소 넣기 | `.env`의 `APPLY_URL` 또는 `config.js`의 `applyUrl` |
| 랜딩 페이지 영상 올리기 | `/admin-video.html` (관리자 토큰 필요, `.env`의 `ADMIN_TOKEN`) |
| 혜택 문구 변경 | `config.js`의 `benefitText` |
| AI 행동 원칙(말투·질문 방식·중립 표현) | `lib/prompts.js` |
| 업종 용어 유출 감시 목록 | `lib/guard.js`의 `WATCHED_TERMS` |
| negotiationState 구조 | `lib/state.js` |
| 사용 모델 | `.env`의 `ANTHROPIC_MODEL` |
| AI 제공사(무료 모델 등) | `.env`의 `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| 비용 보호 한도 | `.env`의 `RATE_LIMIT_PER_15MIN`, `DAILY_LLM_LIMIT` |
| AI 응답 속도 관련 | `.env`의 `LLM_TIMEOUT_MS`(기본 60000), `GATE_RETRY_BUDGET_MS`(기본 20000), `OPENROUTER_REASONING_EFFORT`(기본 low). 서버 로그의 `[llm]`·`[chat]` 줄에 호출별 시간·토큰 수가 찍힙니다 |
| 첫 인사말·플레이스홀더 | `public/app.js` 상단 상수 |
| 색·글꼴·레이아웃 | `public/styles.css` 상단 `:root` 토큰 |
| 화면 문구/구조 | `public/index.html` |

## 제안 정보 · 첨부파일
랜딩 페이지 15초 영상, 두 가지 방법 중 하나로 넣을 수 있습니다.

- **직접 영상 파일 올리기 (권장)**: `/admin-video.html`에서 관리자 토큰을 입력하고 mp4/webm/mov 파일을 끌어다 놓으면 즉시 랜딩 페이지에 반영됩니다. 이 페이지를 쓰려면 `.env`에 `ADMIN_TOKEN`을 아무 문자열이나 정해서 넣어야 합니다(값이 없으면 업로드 기능 자체가 꺼집니다 — 회원가입 없이도 아무나 영상을 바꿔치기 못하게 하는 최소한의 잠금장치입니다). 업로드 최대 용량은 `MAX_VIDEO_MB`(기본 80MB)로 조절합니다.
- **유튜브 링크로 넣기**: `.env`의 `DEMO_VIDEO_ID`(또는 `config.js`의 `demoVideoId`)에 유튜브 영상 ID만 넣으면 됩니다. 직접 올린 영상 파일이 있으면 그 파일이 항상 우선합니다.

둘 다 비어 있으면 "영상 준비 중" 안내가 보입니다.

⚠️ Render 무료 플랜 등 디스크가 재시작·재배포 시 초기화되는 호스팅에서는 올린 영상 파일도 함께 사라집니다. 지속 디스크를 쓰지 않는다면 배포할 때마다 다시 올려야 합니다.

`받는 분`, `보내는 분`은 ITEM 확인 화면에서 입력합니다. 첨부파일은 대화 입력창(클립 버튼)과 ITEM 카드별로 붙일 수 있고, 항목에 붙인 파일은 상대방 Preview의 해당 항목 상세에 표시됩니다. **첨부파일은 서버로 전송되지 않고 AI도 읽지 않습니다**(파일 이름·크기만 브라우저에 표시). 실제 파일 업로드가 필요해지면 서버 저장소 연동과 개인정보 정책이 먼저 필요합니다.

## 수집되는 데이터
대화 내용은 **저장하지 않습니다.** 익명 세션 ID와 퍼널 이벤트(chat_start, summary_shown, items_generated, preview_viewed, pdf_clicked, apply_clicked, delivery_kakao/sms/email/copy)와 설문 응답만 `data/events.jsonl`에 기록됩니다.
