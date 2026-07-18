---
name: retro-to-twee
description: Notion의 최신 주차 "회고 초안"을 twee 문법(구절 + [[선택지->구절]] 링크)의 인터랙티브 회고로 번역해서 같은 주차의 "인터랙티브 회고" Notion 페이지에 반영한다. 사용자가 "회고 번역", "회고를 twee로", "인터랙티브 회고 만들어", "노션 회고 초안 번역" 같은 요청을 하면 사용.
---

# 회고 초안 → 인터랙티브 회고 (twee) 번역

Notion에 서술형으로 적힌 **회고 초안**을 Twine의 **twee 소스**로 번역한다.
독자가 갈림길에서 선택하며 회고를 따라가는 인터랙티브 픽션 형태.

소스와 결과물 모두 Notion에 있고, 접근은 `.env.local`의 `NOTION_TOKEN`으로 한다.

## Notion 구조

루트 페이지(env `NOTION_RETRO_ROOT_PAGE_ID`) 아래:

```
루트 페이지
└─ "N주차 회고"  (child_page, 여러 개일 수 있음 → 최신 = 주차 숫자 최대)
   ├─ "회고 초안"        (child_page) ← 소스
   └─ "인터랙티브 회고"  (child_page) ← 결과물 (code 블록으로 twee 저장)
```

## 설정 / 인증

토큰·ID·URL 등 워크스페이스 식별 정보는 **하드코딩하지 않는다.** 전부 `.env.local`(gitignore됨)에서 읽는다.

```bash
TOKEN=$(grep -o 'NOTION_TOKEN=.*' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")
ROOT=$(grep -o 'NOTION_RETRO_ROOT_PAGE_ID=.*' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")
# 모든 요청에 헤더 두 개:
#   -H "Authorization: Bearer $TOKEN"
#   -H "Notion-Version: 2022-06-28"
```

## 절차

### 1. 최신 주차 + 소스/타겟 페이지 찾기
루트 페이지의 child_page 목록에서 "N주차 회고" 중 **주차 숫자가 가장 큰 것**을 고른다.
그 안의 child_page에서 "회고 초안"과 "인터랙티브 회고"의 id를 찾는다.

```bash
# 루트 children (주차 페이지 목록)
curl -s "https://api.notion.com/v1/blocks/$ROOT/children?page_size=100" \
  -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28"
# 그 주차 페이지의 children → "회고 초안" / "인터랙티브 회고" id
curl -s "https://api.notion.com/v1/blocks/<WEEK_PAGE_ID>/children?page_size=100" \
  -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28"
```

### 2. 회고 초안 읽기
"회고 초안" 페이지의 블록을 읽는다. `has_children=true`인 블록은 재귀적으로 내려가서 전부 수집.
paragraph/heading/bulleted_list_item 등의 `rich_text[].plain_text`를 이어 붙인다.

```bash
curl -s "https://api.notion.com/v1/blocks/<DRAFT_PAGE_ID>/children?page_size=100" \
  -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28"
```

### 3. 비어있는 조건 채우기 (중요)
초안의 갈림길("A하면 이쪽, B하면 저쪽") 중에서 **결과/후속이 안 적힌 분기**가 있으면
그냥 지어내지 말고 **사용자에게 물어본다.** 답을 받으면:
- twee에 반영하고
- **원본 "회고 초안" 페이지도 그 내용으로 업데이트한다** (초안이 항상 완전한 상태로 남도록).

### 4. twee로 번역 (규칙)
- **구절 끊기** — 한 구절이 너무 길지 않게, **선택 직전에서** 자른다.
- **선택지 인식** — 자연어 속 갈림길을 `[[선택지 문구->구절제목]]` 링크로 바꾼다.
- **제목 일관성** — 링크의 `->구절제목`과 실제 `:: 구절제목`이 **한 글자(띄어쓰기 포함)도 안 틀리게** 일치.
- **특수기호 충돌** — 본문에 `[[`, `]]`, `->`, `{`, `}` 가 들어가면 twee 문법과 부딪히므로 `\`로 이스케이프.
- **재번역 시 링크 유지** — 기존 "인터랙티브 회고"가 있으면 먼저 읽고, **구절 제목을 고정**한다(제목이 바뀌면 링크가 깨짐).

twee 형식:
```twee
:: StoryTitle
1주차 인터랙티브 회고

:: StoryData
{"ifid":"...","format":"Harlowe","format-version":"3.3.9","start":"시작"}

:: 시작
어제 서비스 롤링배포를 했다. 사이드이펙트를 고려했어야 했는데...
[[락 TTL을 5분으로 잡고 배포한다->락 TTL 조정]]
[[락 거는 코드 없이 푸는 코드만 먼저 배포한다->해제 코드 선배포]]

:: 락 TTL 조정
...
```
- `:: 구절명` 이 구절 헤더, `[[문구->대상]]` 이 선택지 링크.
- `StoryData`의 `start`는 시작 구절명과 일치. 재번역이면 기존 `StoryData`(ifid 등)를 재사용.

### 5. "인터랙티브 회고" 페이지에 반영
기존 sync 규약(`vite-plugin-notion-sync.ts`)과 동일하게, twee를 **code 블록**(language `plain text`)으로 저장한다.
기존 내용이 있으면 **덮어쓰기 전에 사용자에게 확인**받는다.

```
# a) 기존 자식 블록 조회 → 전부 DELETE
GET    /v1/blocks/<TARGET_PAGE_ID>/children?page_size=100
DELETE /v1/blocks/<each block id>
# b) 새 code 블록 PATCH (twee가 2000자↑면 2000자 단위로 rich_text item 분할)
PATCH  /v1/blocks/<TARGET_PAGE_ID>/children
       {"children":[{"object":"block","type":"code",
         "code":{"language":"plain text",
                  "rich_text":[{"type":"text","text":{"content":"<TWEE>"}}]}}]}
```

### 6. 검증
- 모든 `[[...->제목]]`의 대상 제목이 실제 `:: 제목`으로 존재하는지 (끊긴 링크 없음).
- `StoryData.start`가 존재하는 구절인지.
- 도달 불가능한 구절이 없는지.
끊긴 링크가 있으면 고치고 다시 반영한다.

## 원칙
- 초안에 없는 사실을 지어내지 않는다. 모르면 3번처럼 물어본다.
- 회고는 짧을 수 있다. 억지로 분기를 늘리지 말고 초안의 실제 갈림길만 선택지로 만든다.
