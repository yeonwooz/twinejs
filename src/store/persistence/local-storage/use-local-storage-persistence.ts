import * as React from 'react';
import * as prefs from './prefs';
import * as stories from './stories';
import * as storyFormats from './story-formats';
import {notionSaveMiddleware, mergeStoriesFromNotion} from '../notion-sync';
import {StoriesAction, StoriesState} from '../../stories';

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

					return await mergeStoriesFromNotion(await stories.load());
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
