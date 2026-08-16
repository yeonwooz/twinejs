# twinejs

Twine(인터랙티브 픽션 저작 도구) 저장소. dev 서버에 Notion sync가 붙어 있어
스토리가 twee 소스로 Notion stories DB에 미러링된다(`vite-plugin-notion-sync.ts`,
`src/store/persistence/notion-sync/`). 로컬 앱은 stories DB만 pull 한다 — 로드 시
한 번, 그리고 앱이 켜져 있는 동안 5초마다(`src/store/use-notion-sync-pull.ts`).
폴링은 `GET /__notion-sync/stories?meta=1`로 타임스탬프만 받아보고, 지문이 바뀌었을
때만 twee 본문까지 받는다. 노션에서 직접 고친 내용이 새로고침 없이 반영된다.

## 실행 진입점

- `npm run dev` — vite 개발 서버만 (기존 `npm start`).
- `npm start` — 회고 온보딩 플로우(`scripts/retro.mjs`): env 검증 → stories DB 없으면
  자동 생성 → 노션 초안을 읽어 **Anthropic API(`@anthropic-ai/sdk`, `claude-opus-4-8`)로
  twee 번역** → stories DB에 upsert → Play 선택 시 dev 서버 띄워 재생. (Claude Code 설치 불필요.)

## 설정 / 비밀

전부 `.env.local`(gitignore됨)에 둔다. 이 파일이나 스킬 문서에는
토큰·페이지 ID·노션 URL 같은 워크스페이스 식별 정보를 **하드코딩하지 않는다.**
`.env.example` 참고 — fork 사용자는 아래 셋만 채우면 된다:
- `NOTION_TOKEN` — 통합 토큰(비밀)
- `NOTION_RETRO_ROOT_PAGE_ID` — 회고 루트 페이지 링크/ID
- `ANTHROPIC_API_KEY` — Anthropic API 키(비밀)

그리고 자동 생성·기록되는 것:
- `NOTION_STORIES_DB_ID` — 첫 `npm start` 때 루트 페이지 아래에 만들어 `.env.local`에 기록.

## 회고 → 인터랙티브 회고 번역

Notion의 회고 초안을 twee 인터랙티브 회고로 번역해 **stories DB에 올려 앱에서 재생**하는 작업.
**전체 절차는 `retro-to-twee` 스킬(`.claude/skills/retro-to-twee/SKILL.md`)로 실행한다** —
"회고 번역해줘" / "인터랙티브 회고 만들어" 라고 하면 그 스킬을 쓰면 된다.
(스킬 파일을 만든 세션에서는 아직 목록에 안 떠서 SKILL.md 절차를 직접 따라야 할 수 있음.)

### Notion 구조

`NOTION_RETRO_ROOT_PAGE_ID`가 가리키는 루트 페이지 아래:

```
루트 페이지
└─ "N주차 회고"  (child_page, 여러 개면 주차 숫자 최대 = 최신)
      → 페이지 본문에 회고 내용을 직접 작성. (별도 "회고 초안" 하위 페이지는 필요 없음.
        예전처럼 "회고 초안" 하위 페이지가 있으면 그걸 우선 사용)
```

- **소스**: "N주차 회고" 페이지 본문(하위 페이지로는 파고들지 않음).
- **결과물(twee)**: stories DB(`NOTION_STORIES_DB_ID`)에 저장 → 앱이 pull. (Notion에 "인터랙티브 회고" 페이지를 따로 두지 않는다.)

주차 페이지 ID는 하드코딩하지 않고 루트에서 런타임에 탐색한다.
접근은 `NOTION_TOKEN` + 헤더 `Notion-Version: 2022-06-28`.
stories DB의 twee는 **code 블록(language `plain text`)** 으로 저장하고, 갱신 시
"기존 자식 블록 DELETE → 새 code 블록 PATCH" 패턴을 쓴다. 원본 회고 본문을 갱신할 땐
하위 페이지/DB는 보존하고 텍스트 블록만 교체한다.

## 창작 시나리오 (회고와 나란한 두 번째 위저드)

스토리 목록 툴바의 "시나리오" 버튼 → `/scenario`. 같은 위저드 컴포넌트(`RetroRoute`)를
`mode="scenario"`로 재사용한다 — 연결/루트/AI 키 단계는 공유하고, 다음이 갈린다:

- 프롬프트: `scripts/scenario-prompt.md` (창작 컨셉 — 3막, 성향/경로 선택, 변수 누적
  멀티엔딩. 평행우주/허브 구조 금지). 스타일시트: `scripts/scenario-stylesheet.txt`
  (원고지 테마 — 우주 테마와 구분).
- API: `/api/translate`에 `mode: 'scenario'`, `/api/notion/retros`에 `kind=scenario`.
- Notion 보관: 루트 바로 아래가 아니라 루트 아래 **"시나리오" 폴더 페이지**의 하위
  페이지로 모은다(첫 생성 때 폴더 자동 생성). 회고 목록에서는 이 폴더를 걸러낸다.
- "그때의 나에게" 메시지 저장(retro-link)은 회고 전용 — 시나리오는 만들지 않는다.

### 번역 규칙 / 컨셉 (단일 소스)

번역 규칙·평행우주 컨셉·twee 형식은 **`scripts/retro-prompt.md`가 단일 소스**다.
`npm start`(retro.mjs)가 이 파일을 그대로 시스템 프롬프트로 읽고, 수동 작업도 이걸 따른다.
규칙을 바꾸려면 그 파일만 고친다 — 여기와 SKILL에는 옮겨 적지 않는다.

요지: 회고를 "평행우주 여행" 서사로 만든다. 후회 없는 결정은 분기 없이 통과(단일 우주),
후회 지점마다 평행우주(분기) 생성 → 허브에서 모두 탐색 → 가장 마음에 드는 우주 선택 →
"현실의 나에게 메시지"를 `(input-box:)`로 직접 작성. 우주 테마 CSS는 retro.mjs가 자동으로 입힌다.
비어있는 조건이 있으면 물어보고 원본 초안도 채워 넣는다.
