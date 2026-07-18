# twinejs

Twine(인터랙티브 픽션 저작 도구) 저장소. dev 서버에 Notion sync가 붙어 있어
스토리가 twee 소스로 Notion stories DB에 미러링된다(`vite-plugin-notion-sync.ts`,
`src/store/persistence/notion-sync/`).

설정·비밀은 전부 `.env.local`(gitignore됨)에 둔다. 이 파일이나 스킬 문서에는
토큰·페이지 ID·노션 URL 같은 워크스페이스 식별 정보를 **하드코딩하지 않는다.**
- `NOTION_TOKEN` — 통합 토큰
- `NOTION_STORIES_DB_ID` — 스토리 미러링 DB
- `NOTION_RETRO_ROOT_PAGE_ID` — 회고 루트 페이지 ID

## 회고 → 인터랙티브 회고 번역

Notion의 회고 초안을 twee 인터랙티브 회고로 번역하는 작업.
**전체 절차는 `retro-to-twee` 스킬(`.claude/skills/retro-to-twee/SKILL.md`)로 실행한다** —
"회고 번역해줘" / "인터랙티브 회고 만들어" 라고 하면 그 스킬을 쓰면 된다.
(스킬 파일을 만든 세션에서는 아직 목록에 안 떠서 SKILL.md 절차를 직접 따라야 할 수 있음.)

### Notion 구조

`NOTION_RETRO_ROOT_PAGE_ID`가 가리키는 루트 페이지 아래:

```
루트 페이지
└─ "N주차 회고"  (child_page, 여러 개면 주차 숫자 최대 = 최신)
   ├─ "회고 초안"        (child_page) ← 소스
   └─ "인터랙티브 회고"  (child_page) ← 결과물 (twee를 code 블록으로 저장)
```

개별 주차/초안/인터랙티브 페이지 ID는 하드코딩하지 않고 루트에서 런타임에 탐색한다.
접근은 `NOTION_TOKEN` + 헤더 `Notion-Version: 2022-06-28`.
twee는 sync 규약대로 **code 블록(language `plain text`)** 으로 저장하고, 갱신 시
"기존 자식 블록 DELETE → 새 code 블록 PATCH" 패턴을 쓴다.

### 번역 규칙

- 만약 회고에 비어있는 조건이 있으면 물어봐서 채워넣고, 원본(노션 회고 초안)도 업데이트할 것
- 어디서 구절을 끊을지 — 한 구절이 너무 길지 않게, 선택 직전에서 자르도록
- 선택지 인식 — 자연어 속 갈림길("A하면 이쪽, B하면 저쪽")을 `[[선택지->구절제목]]` 링크로 바꾸기
- 구절 제목 일관성 — 링크와 목적지 제목이 정확히 일치해야 함(띄어쓰기 하나만 틀려도 링크가 깨짐)
- 특수기호 충돌 — 본문에 `[[`나 `->`가 들어가면 twee 문법과 부딪히지 않게 이스케이프
- 재번역 시 링크 유지 — 제목이 바뀌면 기존 링크가 깨지므로 제목을 고정
