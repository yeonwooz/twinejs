// Mirrors story changes to a Notion database through the dev server's
// /__notion-sync/ middleware (see vite-plugin-notion-sync.ts at the repo
// root). This is a companion to local storage persistence, not a replacement:
// local storage stays the fast working copy, and Notion receives debounced
// snapshots in twee format. On load, stories edited directly in Notion since
// the last local edit are pulled back in (see mergeStoriesFromNotion).
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

export interface RemoteStory {
	lastEdited: string | null;
	lastSynced: string | null;
	storyId: string;
	twee: string;
}

/**
 * The most recent timestamp we have for the Notion copy of a story.
 * `lastEdited` is Notion's own edit time but is rounded to the minute;
 * `lastSynced` is set with full precision on every push. Taking the max means
 * edits made directly in Notion count even if the editor didn't bump Last
 * Synced.
 */
function remoteTimestamp(remote: RemoteStory): Date | undefined {
	const times = [remote.lastEdited, remote.lastSynced]
		.map(value => (value ? Date.parse(value) : NaN))
		.filter(time => !isNaN(time));

	return times.length > 0 ? new Date(Math.max(...times)) : undefined;
}

function remoteToStory(remote: RemoteStory): Story {
	const story = storyFromTwee(remote.twee);
	const timestamp = remoteTimestamp(remote);

	// Keep the original story ID so future syncs update the same Notion page.

	return {
		...story,
		id: remote.storyId,
		lastUpdate: timestamp ?? story.lastUpdate,
		passages: story.passages.map(passage => ({
			...passage,
			story: remote.storyId
		}))
	};
}

/**
 * Merges stories synced to Notion into locally-loaded ones. Stories that only
 * exist in Notion are added; a story that exists on both sides is replaced by
 * the Notion copy only when its content actually differs and the Notion copy
 * is newer than the local one. Content is compared after normalizing both
 * sides to twee, so the snapshot created by our own last push--whose
 * timestamp always trails the local edit slightly--never wins spuriously.
 */
export function mergeRemoteStories(
	localStories: StoriesState,
	remoteStories: RemoteStory[]
): Story[] {
	const result = [...localStories];

	for (const remote of remoteStories) {
		let incoming: Story;

		try {
			incoming = remoteToStory(remote);
		} catch (error) {
			console.warn(
				`Couldn't parse twee for Notion story ${remote.storyId}, skipping`,
				error
			);
			continue;
		}

		const index = result.findIndex(story => story.id === remote.storyId);

		if (index === -1) {
			result.push(incoming);
			continue;
		}

		if (storyToTwee(incoming) === storyToTwee(result[index])) {
			continue;
		}

		const timestamp = remoteTimestamp(remote);

		if (timestamp && timestamp > result[index].lastUpdate) {
			result[index] = incoming;
		}
	}

	return result;
}

/**
 * Loads stories from Notion and merges them with locally-loaded ones (see
 * mergeRemoteStories). If sync is disabled or the request fails, local
 * stories are returned untouched.
 */
export async function mergeStoriesFromNotion(
	localStories: StoriesState
): Promise<Story[]> {
	if (!(await isEnabled())) {
		return localStories;
	}

	try {
		const response = await fetch('/__notion-sync/stories');

		if (!response.ok) {
			return localStories;
		}

		return mergeRemoteStories(localStories, await response.json());
	} catch (error) {
		console.warn('Merging stories from Notion failed', error);
		return localStories;
	}
}
