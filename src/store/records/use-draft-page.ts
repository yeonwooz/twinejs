// 스토리 이름으로 그 원고가 들어 있는 노션 초안 페이지를 찾는다.
//
// 예전에는 util/retro-link가 localStorage에 `twine-retro-page.<storyId>` → pageId를
// 적어 뒀다. 브라우저를 바꾸거나 저장소를 비우면 "그때의 나에게" 메시지를 보낼 통로가
// 조용히 사라졌고, 그런 줄도 몰랐다. 제목 매칭이 같은 일을 더 잘 한다 —
// scripts/retro-prompt.md가 `StoryTitle`을 초안 제목 그대로 쓰라고 못 박아 두어서
// (안 그러면 덮어쓸 대상을 못 찾는다) 이 대응이 성립한다.
import * as React from 'react';
import {fetchDrafts, RawDraft} from './use-records';
import {normalizeTitle} from './use-records';

export function useDraftPageForStory(storyName?: string) {
	const [draft, setDraft] = React.useState<RawDraft>();

	React.useEffect(() => {
		if (!storyName) {
			setDraft(undefined);
			return;
		}

		const controller = new AbortController();

		fetchDrafts(controller.signal)
			.then(drafts => {
				const found = drafts.find(
					d => normalizeTitle(d.title) === normalizeTitle(storyName)
				);

				if (!controller.signal.aborted) {
					setDraft(found);
				}
			})
			// 노션을 못 물어봐도 재생 자체는 막지 않는다.
			.catch(() => undefined);

		return () => controller.abort();
	}, [storyName]);

	return draft;
}
