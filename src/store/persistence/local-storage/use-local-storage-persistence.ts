import * as React from 'react';
import * as prefs from './prefs';
import * as stories from './stories';
import * as storyFormats from './story-formats';
import {
	notionSaveMiddleware,
	restoreStoriesFromNotion
} from '../notion-sync';
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
					const localStories = await stories.load();

					if (localStories.length > 0) {
						return localStories;
					}

					// Local storage is empty--fall back to stories synced to Notion,
					// if any.

					return await restoreStoriesFromNotion();
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
