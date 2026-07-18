# 회고 → 인터랙티브 스토리: 설계·결정 노트

작성 2026-07-18. 이 문서는 "왜 이렇게 정했는지"를 남기는 결정 로그다.
구현 진행 계획은 `~/.claude/plans/radiant-juggling-lynx.md`(Vercel 배포 플랜) 참고.

## 무엇을 만드나
Notion에 쓴 주간 회고를 Twine(twinejs)의 **twee 인터랙티브 픽션**으로 번역해,
독자가 "평행우주"를 넘나들며 회고를 되짚게 하는 도구.

- 로컬 CLI: `npm start`(`scripts/retro.mjs`) — env 검증 → stories DB 확보 → 주차 선택
  → Notion 초안 읽기 → Anthropic 번역 → stories DB upsert → Play.
- (구) 개발 서버 동기화: `vite-plugin-notion-sync.ts`(dev 전용). 앱은 로드 시 stories DB를 pull.

## 핵심 결정 로그

### 1. 스킬/CLI 구조
- 번역 규칙·서사 컨셉·twee 형식의 **단일 소스 = `scripts/retro-prompt.md`**. `retro.mjs`가 런타임에 읽어 시스템 프롬프트로 사용. CLAUDE.md·SKILL.md는 요약+포인터만(중복 금지).
- `retro-to-twee` 스킬(`.claude/skills/`)은 Claude Code에서 사람이 수동으로 같은 작업을 할 때의 참고서.

### 2. 비밀/보안 처리
- 토큰·페이지 ID·노션 URL·워크스페이스명 등 **식별 정보는 코드/문서에 하드코딩 금지**, `.env.local`(gitignore)에만.
- 커밋 전 매번 민감정보 스캔. 실제 토큰/키/ID가 커밋 파일에 없는지 확인.

### 3. 모델(LLM)
- **Anthropic만** 사용. 모델 `claude-opus-4-8`, adaptive thinking, structured output. 공식 SDK `@anthropic-ai/sdk`.
- OpenAI 폴백은 **넣지 않기로** 함(단순성 우선). 나중에 필요하면 `translate()`만 프로바이더 분기.
- Anthropic 키는 처음엔 `.env.local`. 웹 배포판에선 **사용자 Notion에 적어두고 서버측에서만 읽기**로 전환(브라우저에 안 옴).

### 4. 서사 컨셉 — "평행우주 여행"
- 잘한 결정(후회 없음)은 분기 없이 통과(단일 우주). **후회 지점마다 평행우주(분기) 생성.**
- 모든 우주를 허브에서 탐색 → **가장 마음에 드는 우주 선택** → **그때의 나에게 메시지** 작성
  (Harlowe `(input-box:)`), 전송 후 `(after:)`로 "시공 너머 도착" 연출, `$message` 되비춤.
- 버튼 텍스트: "그때의 나에게 전송".

### 5. 우주 테마 UI
- twee에 `[stylesheet]` 구절을 **자동 주입**(`retro.mjs`의 `COSMIC_STYLESHEET`, `withCosmicUI()`):
  성운 그라디언트 + 256px 타일로 반복되는 촘촘한 별밭 + 반짝임/워프 애니메이션 + 발광 링크.
  `html/body/tw-story`에 `!important`로 Harlowe 기본값을 덮음.
- 배경이 "안 이쁘던" 원인: 초기 CSS가 짙은 네이비 + 점 몇 개로 너무 옅어서였음(플럼빙은 정상).

### 6. 같은 주차 덮어쓰기
- upsert 매칭 키를 **제목 → 주차 번호**로 변경. 모델이 제목을 매번 다르게 내도 **같은 주차는 덮어쓰기**(중복 방지).
- 그래서 StoryTitle은 "N주차"로 시작하도록 프롬프트에 규정.

### 7. Notion 구조 단순화 (2026-07-18)
- 예전: 루트 → "N주차 회고" → "회고 초안"(소스) + "인터랙티브 회고"(사본). **→ 폐기.**
- 지금: 루트 → **"N주차 회고" 페이지 본문에 회고 직접 작성.** 하위 페이지 불필요.
  - 소스 = 주차 페이지 본문(하위 페이지/DB로는 파고들지 않음). 옛 "회고 초안" 하위 페이지가 있으면 우선 사용.
  - 결과물(twee) = stories DB. ("인터랙티브 회고" 페이지 안 만듦.)
  - 원본 회고 본문 갱신 시 **하위 페이지/DB 보존, 텍스트 블록만 교체**(`replaceTextChildren`).

### 8. `npm start` 진입점
- `npm run dev` = vite 개발 서버. `npm start` = 회고 온보딩 오케스트레이터.
- 첫 실행 시 **"몇 주차 회고를 쓸까요?"를 항상 물어봄**, 그 주차의 회고가 있는지 확인.

## Vercel 배포 설계 (진행 중)
목표: 여러 사람이 각자 브라우저에서 사용. 로그인 계정 DB 없이 스토리는 **각자 localStorage**.

- **인증 = Notion OAuth 로그인 + httpOnly 쿠키.** 토큰을 JS가 못 읽어 스토리 XSS로도 안 털림.
- **Anthropic 키 = 사용자 Notion 설정 페이지**에 두고 서버리스에서만 읽음(브라우저 미노출).
- **재생 격리 = sandbox iframe**(`srcDoc`, `allow-scripts`, no `allow-same-origin`) → 스토리 JS가
  부모 앱의 쿠키/스토리지/DOM 접근 불가. 트레이드오프: Harlowe 게임 세이브(localStorage)는 못 씀.
- 서버리스 `/api`: `notion/{login,callback,logout}`, `session`, `notion/{weeks,draft}`,
  `notion-sync/*`(기존 미들웨어 로직 이식), `translate`(retro.mjs 로직 이식). **무DB·무로깅.**
- 빌드: `vite build` → `dist/web`(HashRouter라 rewrite 불필요), `vercel.json` 추가.
- Vercel env: `NOTION_OAUTH_CLIENT_ID/SECRET`, `NOTION_REDIRECT_URI`, `COOKIE_SECRET`.
  (**Anthropic 키는 env 아님** — 사용자 Notion에서.)

### 진행 상태
- **Phase 1 완료**: 재생 sandbox iframe 격리(`SandboxedStoryPlayer`, play/proof/test 라우트),
  `vercel.json`, `vite build` 검증.
- **Phase 2 완료(코드)**: `api/` 서버리스 — 세션 쿠키(`api/_lib/session.ts`, AES-GCM),
  Notion 헬퍼(`api/_lib/notion.ts`), OAuth(`api/notion/{login,callback,logout}.ts`),
  `api/session.ts`, sync 프록시(`api/notion-sync/{status,stories}`). 클라는 안 고치고
  `vercel.json` rewrite로 기존 `/__notion-sync/*`를 함수로 보냄. api/ 타입체크 0 에러.
  **런타임 검증은 배포 후**(OAuth 왕복은 로컬 불가).
- **Phase 3(예정)**: `/api/notion/{weeks,draft}` + `/api/translate` + 회고 위저드 UI
  (Notion 연결 → 회고 루트 선택 → stories DB 확보해 세션에 `dbId` 기록 → 주차→Q&A→Play/보완).
  ※ sync는 세션에 `dbId`가 있어야 활성 → 위저드가 그걸 채운다.

## Vercel 배포 방법 (준비)
1. **Notion public OAuth 통합 등록** (https://www.notion.so/my-integrations → 새 통합 → Public):
   - Redirect URI = `https://<앱>.vercel.app/api/notion/callback`
   - `client_id`, `client_secret` 확보.
2. **Vercel 프로젝트** 연결(이 저장소). 빌드는 `vercel.json`이 `vite build`→`dist/web`로 처리.
3. **Vercel 환경변수** 설정:
   - `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`
   - `NOTION_REDIRECT_URI` = 위 콜백 URL
   - `COOKIE_SECRET` = 임의의 긴 랜덤 문자열(세션 암호화 키)
   - (Anthropic 키는 **여기 넣지 않음** — 각 사용자가 자기 Notion 설정 페이지에 적어두면 서버가 읽음)
4. 배포 후 검증: `/api/session`이 `{connected:false}` → "Notion 연결" → 콜백 후 `{connected:true}`,
   재생 iframe 안에서 `parent.document.cookie` 접근이 막히는지 확인.

### 남은 결정/선행조건
- Phase 2·3은 **배포해야 검증 가능**(로컬에서 OAuth 왕복 불가).
- 선행: Notion **public OAuth 통합 등록**(client_id/secret, redirect URI = Vercel 도메인) + Vercel 프로젝트.
- 공유 배포 시 "내 배포가 남의 키를 거친다"는 신뢰 부담 → 사용법에 "키는 본인 브라우저/서버 무저장, 재생 격리" 명시.
