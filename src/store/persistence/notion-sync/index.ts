// Mirrors story changes to a Notion database through /__notion-sync/. In the
// dev server that path is served by vite-plugin-notion-sync.ts (token and
// database from .env.local); in deployment vercel.json rewrites it to the
// session-backed functions under api/notion-sync/, which resolve the database
// from the root page the signed-in user picked. One database per root page --
// retrospectives and creative scenarios written under the same root share it.
//
// This is a companion to local storage persistence, not a replacement:
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

/**
 * Marks stories made by the scenario wizard. Purely a label for the author's
 * benefit -- where a story is stored depends on the Notion root page picked in
 * the wizard, not on this tag. Story tags aren't serialized to twee, so tagging
 * never registers as a content change during merges.
 */
export const SCENARIO_TAG = 'scenario';

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

export interface RemoteStoryMeta {
	lastEdited: string | null;
	lastSynced: string | null;
	storyId: string;
}

export interface RemoteStory extends RemoteStoryMeta {
	twee: string;
}

/**
 * Story IDs with an unsent local edit (the 3 second debounce hasn't fired yet).
 * The Notion copy of these can't be authoritative -- the newest text is sitting
 * in this browser -- so a pull must leave them alone.
 */
function locallyPendingStoryIds() {
	return [...pendingSyncs.keys()];
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
 *
 * Stories in `skipStoryIds` are left untouched regardless of timestamps; see
 * locallyPendingStoryIds.
 */
export function mergeRemoteStories(
	localStories: StoriesState,
	remoteStories: RemoteStory[],
	skipStoryIds: string[] = []
): Story[] {
	const result = [...localStories];

	for (const remote of remoteStories) {
		if (skipStoryIds.includes(remote.storyId)) {
			continue;
		}

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
// Notion에서 지운 스토리를 로컬에서도 지우기 위한 장부.
//
// "원격 목록에 없으면 삭제"로 단순화할 수 없다 — 방금 로컬에서 만든 스토리는 아직
// 푸시되지 않았을 뿐(3초 디바운스)인데 그걸 삭제로 오해하면 만들자마자 사라진다.
// 그래서 "지난 로드에서 원격에 있는 걸 본" id를 적어두고, 그것이 사라진 경우만
// 삭제로 판단한다.
const SYNCED_IDS_KEY = 'twine-notion-synced-stories';

function readSyncedIds(): string[] {
	try {
		const raw = window.localStorage.getItem(SYNCED_IDS_KEY);

		return raw ? raw.split(',').filter(Boolean) : [];
	} catch {
		return [];
	}
}

function writeSyncedIds(ids: string[]) {
	try {
		window.localStorage.setItem(SYNCED_IDS_KEY, ids.join(','));
	} catch {
		// 저장 못 해도 진행은 막지 않는다 — 다음 로드에서 삭제 판단만 보류된다.
	}
}

/**
 * Local stories that were present in Notion last time we looked but are gone
 * now — i.e. deleted (or archived) on the Notion side.
 *
 * Pure so the irreversible half of this feature is testable: caller supplies
 * the ids it recorded previously.
 */
export function remotelyDeletedStoryIds(
	localStories: StoriesState,
	remoteStories: RemoteStory[],
	previouslySynced: string[]
): string[] {
	const remoteIds = new Set(remoteStories.map(r => r.storyId));
	const localIds = new Set(localStories.map(s => s.id));

	return previouslySynced.filter(id => !remoteIds.has(id) && localIds.has(id));
}

export interface MergeResult {
	stories: Story[];
	// 로컬에서도 지워야 하는 스토리 — 호출부가 localStorage에서 실제로 제거한다.
	deletedIds: string[];
}

export async function mergeStoriesFromNotion(
	localStories: StoriesState
): Promise<MergeResult> {
	if (!(await isEnabled())) {
		return {stories: localStories, deletedIds: []};
	}

	const remote = await fetchRemote<RemoteStory>('/__notion-sync/stories');

	return remote
		? applyRemoteStories(localStories, remote)
		: {stories: localStories, deletedIds: []};
}

async function fetchRemote<T>(url: string): Promise<T[] | undefined> {
	try {
		const response = await fetch(url);

		return response.ok ? await response.json() : undefined;
	} catch (error) {
		console.warn(`Fetching ${url} failed`, error);
		return undefined;
	}
}

/**
 * Merges a fetched remote listing into local stories and updates the
 * synced-IDs ledger. Shared by the load-time merge and the live pull.
 */
function applyRemoteStories(
	localStories: StoriesState,
	remote: RemoteStory[]
): MergeResult {
	const merged = mergeRemoteStories(
		localStories,
		remote,
		locallyPendingStoryIds()
	);

	// 원격 목록이 빈 채로 오는 건 "전부 지웠다"보다 설정 오류·API 이상일 가능성이
	// 훨씬 높다. 삭제는 되돌릴 수 없으므로 그 경우엔 판단을 보류한다(장부도 그대로
	// 둬서 다음 정상 응답에 다시 비교한다).
	const synced = readSyncedIds();

	if (remote.length === 0) {
		if (synced.length > 0) {
			console.warn(
				'Notion returned no stories; skipping remote-deletion sync this time'
			);
		}
		return {stories: merged, deletedIds: []};
	}

	const deletedIds = remotelyDeletedStoryIds(localStories, remote, synced);

	writeSyncedIds(remote.map(r => r.storyId));

	return {
		stories: deletedIds.length
			? merged.filter(s => !deletedIds.includes(s.id))
			: merged,
		deletedIds
	};
}

/**
 * A fingerprint of the remote listing. Two identical fingerprints mean no
 * Notion page has been touched since we last looked, so there's nothing to
 * fetch bodies for.
 */
export function remoteFingerprint(remote: RemoteStoryMeta[]) {
	return remote
		.map(({storyId, lastEdited, lastSynced}) =>
			[storyId, lastEdited ?? '', lastSynced ?? ''].join(':')
		)
		.sort()
		.join('|');
}

export interface PullResult extends MergeResult {
	/** Did anything actually change? Callers shouldn't touch the store if not. */
	changed: boolean;
}

let lastFingerprint: string | undefined;
let pulling = false;

/**
 * Did this list of stories change identity-wise? mergeRemoteStories copies the
 * local array and only swaps in new objects for stories it replaced, so
 * reference equality is an exact "nothing happened" test.
 */
function sameStories(before: StoriesState, after: Story[]) {
	return (
		before.length === after.length &&
		before.every((story, index) => story === after[index])
	);
}

/**
 * Checks Notion for changes made since the last look and merges them in. Meant
 * to be called repeatedly while the app runs, so the expensive part -- reading
 * every story's twee body -- only happens once a cheap timestamp-only listing
 * shows something moved.
 *
 * Returns `changed: false` when there's nothing to apply, which is the common
 * case: one HTTP request and no store update.
 */
export async function pullRemoteChanges(
	localStories: StoriesState
): Promise<PullResult> {
	const untouched = {stories: localStories, deletedIds: [], changed: false};

	if (pulling || !(await isEnabled())) {
		return untouched;
	}

	pulling = true;

	try {
		const meta = await fetchRemote<RemoteStoryMeta>(
			'/__notion-sync/stories?meta=1'
		);

		if (!meta) {
			return untouched;
		}

		const fingerprint = remoteFingerprint(meta);

		if (fingerprint === lastFingerprint) {
			return untouched;
		}

		const remote = await fetchRemote<RemoteStory>('/__notion-sync/stories');

		if (!remote) {
			return untouched;
		}

		// 게이트에 쓴 값을 그대로 저장한다. 본문 응답에서 다시 계산하면, twee가 빈
		// 페이지처럼 두 목록이 갈리는 경우에 지문이 영구히 어긋나 매번 본문을 받게 된다.
		lastFingerprint = fingerprint;

		const result = applyRemoteStories(localStories, remote);

		return {
			...result,
			changed:
				result.deletedIds.length > 0 ||
				!sameStories(localStories, result.stories)
		};
	} finally {
		pulling = false;
	}
}
