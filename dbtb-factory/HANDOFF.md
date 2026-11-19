# DBTB FACTORY 인수인계 (다른 AI·개발자용)

이 문서를 먼저 읽고 작업을 이어가세요.

## 무엇인가
- 기획서: `DBTB FACTORY PRD v1.0` (DON'T BUY THE BOOK | KNOWLEDGE ONTOLOGY FACTORY)
- 프로젝트 설계 → 원재료 투입 → 가공설비/특별 실험실 → 프로토타입(버전 보존) → 공장장 검수 → 최종 조립 → 완제품 창고 → 외부 AI 이관
- 저장소: `tunee-ai/negotable`, 브랜치 `claude/happy-ramanujan-hbebne`, 폴더 `dbtb-factory/`
  (저장소의 다른 파일은 별개 제품 "두딜"이므로 건드리지 마세요)

## 실행
```bash
cd dbtb-factory
npm install
cp .env.example .env    # ANTHROPIC_API_KEY 넣으면 실제 AI, 비우면 데모 엔진
npm start               # http://localhost:3100
npm test                # API 인수 테스트 3개
node scripts/build-artifact.mjs   # 서버 없이 도는 브라우저 데모판 → dist-artifact/
```

## 파일 구조
| 위치 | 역할 |
|---|---|
| `server.js` / `app.js` | 서버 시작, express 설정 |
| `lib/api.js` | 모든 API 라우트 (서버·브라우저 데모 공용) |
| `lib/engine.js` | AI 프롬프트·출력 스키마, 데모 엔진 결과 |
| `lib/ai.js` | Anthropic SDK 호출 (structured outputs) |
| `lib/catalog.js` | 원재료 6종, 가공설비 12종, 실험실 3종, 출력 형식, 외부 AI 링크 |
| `lib/status.js` | 프로젝트 상태 전이 (PRD 3장) |
| `lib/store.js` | JSON 파일 저장소 (`data/db.json`) |
| `public/app.js` | 화면 전체 (바닐라 JS, 해시 라우팅) |
| `public/wall.js` | 첫 화면 벽 사진 위 페인트 글씨 (캔버스) |
| `public/icons.js` | 금속판 스타일 SVG 아이콘 |
| `public/styles.css` | 디자인 토큰·스타일 |
| `public/images/` | 공장 정문·설계실·원재료 창고·가공설비실·생산라인·책장 벽 사진 |
| `artifact/local/` | 브라우저 데모판용 미니 라우터·localStorage 저장소 |

## 지금까지 반영된 디자인 결정 (사용자 요청)
- 첫 화면: 책장 벽돌 벽 사진 위에 흰색 페인트 글씨 **DON'T BUY THE BOOK** + **KNOWLEDGE ONTOLOGY FACTORY**. 줄눈·결이 비치게 처리. 설명 문구 없음.
- 그 아래 공장 정문 사진: 흑백, 아래 바닥 잘라냄, 철문 클릭 = 입장 (사진 위 입장 버튼 없음)
- 각 작업실 상단 이미지: 원본 비율 그대로 (잘림 없음)
- 원재료 보관함: 창고 사진 선반 클릭 → 원재료 종류 선택. 가공설비실: 사진 속 기계 클릭 → 설비 선택
- 상단 로고: 브랜드 글꼴(Alfa Slab One) 흰색 DON'T BUY THE BOOK
- 화면에 P1~P9 같은 페이지 번호는 표시하지 않음

## 남은 일
- 사용자가 준 아이콘 시트 3장(금속 아이콘)으로 교체: 아직 파일을 받지 못해 `public/icons.js`에 비슷한 스타일로 직접 그린 아이콘이 들어가 있음. 시트를 잘라 투명 PNG로 만든 뒤 같은 이름(book, funnel, swot …)으로 바꿔 끼우면 됨
- 로그인 방식(지금은 브라우저별 익명 ID), DB(지금은 JSON 파일), PDF/EPUB 본문 추출, 과금 정책 — PRD 14.1 미확정 항목
- 사진 이용권 확인 (책장 벽 사진 출처)
