// 회고 마법사가 만든 스토리 ↔ 원본 Notion 회고 페이지 매핑.
//
// 재생 화면은 이 매핑을 보고, 스토리 안에서 "그때의 나에게" 보낸 메시지를 어느 Notion
// 페이지에 붙일지 판단한다. 매핑이 없는 스토리(직접 만든 것 등)는 저장 통로 자체가
// 열리지 않는다. 스토리 자체가 브라우저 로컬에 사는 데이터라 매핑도 같은 곳에 둔다.

const KEY_PREFIX = 'twine-retro-page.';

export interface RetroLink {
	// Notion "N주차 회고" 페이지 ID.
	pageId: string;
	title: string;
}

export function retroLinkForStory(storyId: string): RetroLink | undefined {
	try {
		const raw = window.localStorage.getItem(KEY_PREFIX + storyId);

		if (!raw) {
			return undefined;
		}

		const parsed = JSON.parse(raw);

		if (typeof parsed?.pageId !== 'string' || !parsed.pageId) {
			return undefined;
		}

		return {pageId: parsed.pageId, title: String(parsed.title ?? '')};
	} catch {
		// 저장소 접근 불가 또는 깨진 JSON — 매핑 없음으로 취급한다.
		return undefined;
	}
}

export function setRetroLinkForStory(storyId: string, link: RetroLink) {
	try {
		window.localStorage.setItem(KEY_PREFIX + storyId, JSON.stringify(link));
	} catch {
		// 저장 못 해도 회고 생성 흐름은 막지 않는다. 메시지 저장만 비활성화된다.
	}
}
