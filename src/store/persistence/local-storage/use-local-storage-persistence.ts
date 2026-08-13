import * as React from 'react';
import * as prefs from './prefs';
import * as stories from './stories';
import * as storyFormats from './story-formats';
import {
	mergeStoriesFromNotion,
	notionSaveMiddleware,
	pullRemoteChanges
} from '../notion-sync';
import {StoriesAction, StoriesState, Story} from '../../stories';

/**
 * Writes the result of a Notion merge to local storage, so the on-disk working
 * copy doesn't drift from what's in memory. This has to be done by hand: the
 * 'init' action that carries merged stories into the store deliberately writes
 * nothing, and a story living only in memory would be half-persisted the moment
 * the user edited one of its passages.
 */
function persistMerge(
	previous: StoriesState,
	merged: Story[],
	deletedIds: string[]
) {
	// mergeRemoteStories copies the local array and only swaps in new objects
	// where the Notion copy won, so anything not in `previous` by reference is
	// exactly what came from Notion.
	const fromNotion = merged.filter(story => !previous.includes(story));

	if (fromNotion.length === 0 && deletedIds.length === 0) {
		return;
	}

	stories.doUpdateTransaction(transaction => {
		for (const story of fromNotion) {
			// 원격 사본은 twee를 파싱해 만들어지므로 패시지 ID가 새로 발급된다. 예전
			// 패시지를 먼저 지워야 localStorage에 고아 키가 쌓이지 않는다.
			const replaced = previous.find(s => s.id === story.id);

			for (const passage of replaced?.passages ?? []) {
				stories.deletePassage(transaction, passage);
			}

			stories.saveStory(transaction, story);

			for (const passage of story.passages) {
				stories.savePassage(transaction, passage);
			}
		}

		// Notion에서 지운 스토리는 로컬에서도 지운다. 병합 결과에서 빼는 것만으론
		// 안 되는데, 'init' 액션은 localStorage에 아무것도 쓰지 않아서 다음 로드에
		// 그대로 되살아난다 — 키를 직접 제거해야 한다.
		for (const id of deletedIds) {
			const story = previous.find(s => s.id === id);

			if (!story) {
				continue;
			}

			// deleteStory는 자식 패시지를 건드리지 않는다 — 남기면 고아 키가 쌓인다.
			for (const passage of story.passages) {
				stories.deletePassage(transaction, passage);
			}

			stories.deleteStory(transaction, story);
		}
	});
}

export function useLocalStoragePersistence() {
	return React.useMemo(
		() => ({
			prefs: {
				load: prefs.load,
				saveMiddleware: prefs.saveMiddleware
			},
			stories: {
				async load() {
					// Merge in stories synced to Notion: this restores everything when
					// local storage is empty, and pulls in stories whose Notion copy
					// was edited directly (e.g. by Claude) since the last local edit.

					const local = await stories.load();
					const {stories: merged, deletedIds} =
						await mergeStoriesFromNotion(local);

					persistMerge(local, merged, deletedIds);

					return merged;
				},
				// Same merge, but for repeated calls while the app runs -- see
				// useNotionSyncPull. Returns changed: false when there was nothing to
				// do, which is the usual outcome.
				async pullRemote(current: StoriesState) {
					const result = await pullRemoteChanges(current);

					if (result.changed) {
						persistMerge(current, result.stories, result.deletedIds);
					}

					return result;
				},
				saveMiddleware(state: StoriesState, action: StoriesAction) {
					stories.saveMiddleware(state, action);
					notionSaveMiddleware(state, action);
				}
			},
			storyFormats: {
				load: storyFormats.load,
				saveMiddleware: storyFormats.saveMiddleware
			}
		}),
		[]
	);
}
