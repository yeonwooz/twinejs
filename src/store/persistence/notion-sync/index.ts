// Mirrors story changes to a Notion database through the dev server's
// /__notion-sync/ middleware (see vite-plugin-notion-sync.ts at the repo
// root). This is a companion to local storage persistence, not a replacement:
// local storage stays the fast working copy, and Notion receives debounced
// snapshots in twee format.
//
// When the middleware isn't present (production builds, Electron, or a dev
// server without a token configured), the first status check disables sync
// silently.

import {storyFromTwee, storyToTwee} from '../../../util/twee';
import {
	StoriesAction,
	StoriesState,
	Story,
	storyWithId,
	storyWithName
} from '../../stories';
import {isPersistablePassageChange} from '../persistable-changes';

const SYNC_DEBOUNCE_MS = 3000;

let enabled: boolean | undefined;
let lastState: StoriesState = [];
const pendingSyncs = new Map<string, number>();

async function isEnabled() {
	if (enabled === undefined) {
		try {
			const response = await fetch('/__notion-sync/status');

			enabled = response.ok && (await response.json()).enabled === true;
		} catch {
			enabled = false;
		}

		console.info(`Notion sync is ${enabled ? 'enabled' : 'disabled'}`);
	}

	return enabled;
}

async function syncStory(storyId: string) {
	if (!(await isEnabled())) {
		return;
	}

	let story: Story;

	try {
		story = storyWithId(lastState, storyId);
	} catch {
		// The story was deleted before the debounced sync fired.
		return;
	}

	try {
		await fetch(`/__notion-sync/stories/${encodeURIComponent(storyId)}`, {
			method: 'PUT',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				ifid: story.ifid,
				name: story.name,
				twee: storyToTwee(story)
			})
		});
	} catch (error) {
		console.warn(`Notion sync of story ${storyId} failed`, error);
	}
}

function scheduleSync(storyId: string) {
	cancelPendingSync(storyId);
	pendingSyncs.set(
		storyId,
		window.setTimeout(() => {
			pendingSyncs.delete(storyId);
			syncStory(storyId);
		}, SYNC_DEBOUNCE_MS)
	);
}

function cancelPendingSync(storyId: string) {
	const pending = pendingSyncs.get(storyId);

	if (pending !== undefined) {
		window.clearTimeout(pending);
		pendingSyncs.delete(storyId);
	}
}

async function archiveStory(storyId: string) {
	if (!(await isEnabled())) {
		return;
	}

	try {
		await fetch(`/__notion-sync/stories/${encodeURIComponent(storyId)}`, {
			method: 'DELETE'
		});
	} catch (error) {
		console.warn(`Notion archive of story ${storyId} failed`, error);
	}
}

/**
 * A middleware function to mirror story changes to Notion. This should be
 * called alongside the local storage save middleware.
 */
export function notionSaveMiddleware(
	state: StoriesState,
	action: StoriesAction
) {
	lastState = state;

	switch (action.type) {
		case 'init':
		case 'repair':
			break;

		case 'createStory':
			if (action.props.name) {
				scheduleSync(storyWithName(state, action.props.name).id);
			}
			break;

		case 'deleteStory':
			cancelPendingSync(action.storyId);
			archiveStory(action.storyId);
			break;

		case 'updatePassage':
			if (isPersistablePassageChange(action.props)) {
				scheduleSync(action.storyId);
			}
			break;

		case 'updatePassages':
			if (
				Object.values(action.passageUpdates).some(isPersistablePassageChange)
			) {
				scheduleSync(action.storyId);
			}
			break;

		case 'createPassage':
		case 'createPassages':
		case 'deletePassage':
		case 'deletePassages':
		case 'updateStory':
			scheduleSync(action.storyId);
			break;
	}
}

/**
 * Loads stories from Notion, for use when local storage is empty--for
 * example, after clearing browser data or opening the editor in a different
 * browser.
 */
export async function restoreStoriesFromNotion(): Promise<Story[]> {
	if (!(await isEnabled())) {
		return [];
	}

	try {
		const response = await fetch('/__notion-sync/stories');

		if (!response.ok) {
			return [];
		}

		const remoteStories: {
			lastSynced: string | null;
			storyId: string;
			twee: string;
		}[] = await response.json();

		return remoteStories.map(({lastSynced, storyId, twee}) => {
			const story = storyFromTwee(twee);

			// Keep the original story ID so future syncs update the same Notion
			// page.

			return {
				...story,
				id: storyId,
				lastUpdate: lastSynced ? new Date(lastSynced) : story.lastUpdate,
				passages: story.passages.map(passage => ({
					...passage,
					story: storyId
				}))
			};
		});
	} catch (error) {
		console.warn('Restoring stories from Notion failed', error);
		return [];
	}
}
