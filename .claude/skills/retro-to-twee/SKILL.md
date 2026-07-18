---
name: retro-to-twee
description: Notion 회고 초안을 twee 인터랙티브 회고로 번역해서 Twine stories DB에 올려 로컬 앱에서 바로 재생할 수 있게 한다. 사용자가 "회고 번역", "회고를 twee로", "인터랙티브 회고 만들어", "노션 회고 초안 번역" 같은 요청을 하면 사용.
---

# 회고 초안 → 인터랙티브 회고 (twee) 번역

Notion에 서술형으로 적힌 **회고 초안**을 Twine의 **twee 소스**로 번역해, 독자가
갈림길에서 선택하며 따라가는 인터랙티브 픽션으로 만든다.

> 자동 경로는 `npm start`(`scripts/retro.mjs`)다 — env 검증 → stories DB 자동 생성 →
> Anthropic API로 번역 → upsert → Play까지 스크립트가 처리한다. 이 스킬은 Claude Code에서
> 사람이 직접(수동으로) 같은 작업을 할 때의 절차·규칙 참고서다.

**결과물은 stories DB에 올려야 로컬 앱이 재생한다.** 로컬 앱은 로드 시
`mergeStoriesFromNotion`으로 stories DB만 pull 하므로(`src/store/persistence/notion-sync/`),
번역한 twee는 반드시 stories DB의 스토리(= `Story ID` 속성 + twee code 블록)로 올린다.

## Notion 구조

- **소스**: 루트 페이지(env `NOTION_RETRO_ROOT_PAGE_ID`) 아래
  ```
  루트 페이지
  └─ "N주차 회고"  (child_page, 여러 개면 주차 숫자 최대 = 최신)
     ├─ "회고 초안"        (child_page) ← 번역 소스
     └─ "인터랙티브 회고"  (child_page) ← 사람이 읽는 사본(선택)
  ```
- **재생 대상**: stories DB(env `NOTION_STORIES_DB_ID`) — 앱이 pull 하는 곳.
  각 스토리 = 페이지, 속성 `Name`(title)·`Story ID`(rich_text)·`IFID`(rich_text)·`Last Synced`(date),
  본문은 twee **code 블록**(language `plain text`). 규약은 `vite-plugin-notion-sync.ts` 참고.

## 설정 / 인증

토큰·ID·URL 등 워크스페이스 식별 정보는 **하드코딩하지 않는다.** `npm start`로 실행되면
`NOTION_TOKEN` / `NOTION_RETRO_ROOT_PAGE_ID` / `NOTION_STORIES_DB_ID`가 환경변수로 주어진다.
직접 실행할 땐 `.env.local`에서 읽는다.

```bash
TOKEN=${NOTION_TOKEN:-$(grep -o 'NOTION_TOKEN=.*' .env.local | cut -d= -f2- | tr -d '"'"'"')}
ROOT=${NOTION_RETRO_ROOT_PAGE_ID:-$(grep -o 'NOTION_RETRO_ROOT_PAGE_ID=.*' .env.local | cut -d= -f2- | tr -d '"'"'"')}
DB=${NOTION_STORIES_DB_ID:-$(grep -o 'NOTION_STORIES_DB_ID=.*' .env.local | cut -d= -f2- | tr -d '"'"'"')}
# 모든 요청 헤더: -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28"
```

## 절차

### 1. 어느 주차인지 정하기
루트 페이지의 child_page에서 "N주차 회고" 목록을 읽는다.
- 여러 주차가 있으면 **어느 주차를 작업할지 사용자에게 물어본다** (기본 추천 = 주차 숫자 최대).
- 고른 주차 페이지의 child_page에서 "회고 초안"(소스)과 "인터랙티브 회고"(선택 사본)의 id를 찾는다.

### 2. 회고 초안 읽기
"회고 초안" 페이지 블록을 읽는다. `has_children=true`면 재귀적으로 내려가 전부 수집,
`rich_text[].plain_text`를 이어 붙인다.

### 3. 비어있는 조건 채우기 (중요)
초안의 갈림길 중 **결과/후속이 안 적힌 분기**가 있으면 지어내지 말고 **사용자에게 물어본다.**
답을 받으면 twee에 반영하고 **원본 "회고 초안" 페이지도 완전한 내용으로 업데이트**한다.

### 4. twee로 번역 (규칙 · 컨셉)
**번역 규칙·평행우주 컨셉·twee 형식은 `scripts/retro-prompt.md`가 단일 소스다.** 그 파일을 따른다
(자동 경로 `npm start`도 이 파일을 시스템 프롬프트로 그대로 쓴다). 여기 옮겨 적지 않는다.

요지만: 회고를 평행우주 여행으로 — 후회 없는 결정은 분기 없이 통과, 후회 지점마다 평행우주 생성 →
허브 탐색 → 우주 선택 → `(input-box:)`로 "현실의 나에게 메시지" 작성. 구절 제목/링크 정확 일치,
`StoryData.start`는 시작 구절명과 일치, IFID는 재번역 시 기존 값 유지.
우주 테마 `[stylesheet]` 구절은 만들지 않는다 — retro.mjs가 자동으로 붙인다(수동 작업이면 마지막에 그 CSS를 붙인다).

### 5. 검증
- 모든 `[[...->제목]]`의 대상이 실제 `:: 제목`으로 존재(끊긴 링크 없음).
- `StoryData.start`가 존재하는 구절.
- 도달 불가능한 구절 없음.
문제가 있으면 고치고 다시 검증한다.

### 6. stories DB에 upsert (재생 대상)
stories DB를 스토리 이름(StoryTitle)으로 조회한다.
- **없으면**: `Story ID`에 새 소문자 UUID를 발급해 페이지 생성(속성 + twee code 블록).
- **있으면**: 그 페이지의 기존 `Story ID`를 **유지**하고, 자식 code 블록을 전부 DELETE → 새 twee로 PATCH.
  (`Story ID`가 곧 앱의 story id이자 Play URL이므로 절대 바꾸지 않는다.)

```
POST /v1/databases/<DB>/query   {"filter":{"property":"Name","title":{"equals":"<StoryTitle>"}}}
# 신규:
POST /v1/pages  {"parent":{"database_id":"<DB>"},
  "properties":{"Name":{"title":[{"text":{"content":"<제목>"}}]},
    "Story ID":{"rich_text":[{"text":{"content":"<uuid>"}}]},
    "IFID":{"rich_text":[{"text":{"content":"<ifid>"}}]}},
  "children":[{"type":"code","code":{"language":"plain text",
    "rich_text":[{"type":"text","text":{"content":"<TWEE (2000자↑면 분할)>"}}]}}]}
```
(선택) 같은 twee를 그 주차의 "인터랙티브 회고" 페이지에도 사람용 사본으로 넣어둔다.

### 7. 완료 → Play / 보완
번역·업로드가 끝나면 **[Play / 보완]** 을 묻는다(수동 진행 시 `AskUserQuestion`).
- **보완**: 사용자 피드백대로 4~6단계를 다시 하고 (같은 `Story ID` 유지) 이 질문을 반복.
- **Play**: 개발 서버(`npm run dev`)를 띄우고 `/#/stories/<storyId>/play` 를 열어 재생한다.
  (자동 경로에서는 `scripts/retro.mjs`가 `npm run dev -- --open <playPath>`로 처리한다.)

## 원칙
- 초안에 없는 사실을 지어내지 않는다. 모르면 3번처럼 물어본다.
- 회고는 짧을 수 있다. 억지로 분기를 늘리지 말고 초안의 실제 갈림길만 선택지로 만든다.
