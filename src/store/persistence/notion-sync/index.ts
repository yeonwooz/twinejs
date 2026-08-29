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

/**
 * 동기화가 지금 어떤 상태인지. 콘솔에만 남기면 아무도 안 본다 -- 저장 위치가 안
 * 정해져 꺼져 있던 것, 통합 권한이 없어 쓰기가 404로 실패한 것, 스토리가 엉뚱한 DB로
 * 들어간 것이 모두 조용히 지나갔다. 화면에 띄우려면 상태를 들고 있어야 한다.
 */
export interface SyncStatus {
	/** 노션에 로그인돼 있나. */
	connected: boolean;
	/** 동기화가 돌 수 있는 상태인가. */
	enabled: boolean;
	/** 마지막 저장이 실패했고 그 뒤로 성공이 없나. */
	failing: boolean;
	/** 꺼졌거나 실패한 이유. 사용자에게 그대로 보여준다. */
	reason?: string;
}

const UNKNOWN: SyncStatus = {connected: false, enabled: false, failing: false};

let status: SyncStatus = UNKNOWN;
const statusListeners = new Set<(status: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>) {
	status = {...status, ...patch};
	statusListeners.forEach(listener => listener(status));
}

export function syncStatus() {
	return status;
}

export function onSyncStatusChange(listener: (status: SyncStatus) => void) {
	statusListeners.add(listener);
	return () => statusListeners.delete(listener);
}

/**
 * Forgets the cached status answer. Call after the user changes where stories
 * are stored -- sync may have just been switched on, and the cached "disabled"
 * would otherwise stand until a reload.
 */
export function forgetSyncStatus() {
	enabled = undefined;
	setStatus(UNKNOWN);
}

async function isEnabled() {
	if (enabled === undefined) {
		// 꺼진 이유가 있으면 함께 남긴다. 저장 위치는 서버가 기본값으로 정해주므로
		// 여기까지 와서 꺼졌다면 이유가 따로 있다(공유된 페이지가 없는 등).
		let reason: string | undefined;
		let connected = false;

		try {
			const response = await fetch('/__notion-sync/status');
			const body = response.ok ? await response.json() : undefined;

			enabled = body?.enabled === true;
			reason = body?.error;
			// dev 서버 미들웨어는 connected를 주지 않는다 -- .env가 정하므로 로그인
			// 개념이 없다. 그때는 enabled 자체를 연결로 본다.
			connected = body?.connected ?? enabled;
		} catch {
			enabled = false;
		}

		setStatus({connected, enabled, reason, failing: false});
		console.info(
			`Notion sync is ${enabled ? 'enabled' : 'disabled'}${
				reason ? ` -- ${reason}` : ''
			}`
		);
	}

	return enabled;
}

/** 서버가 돌려준 이유를 꺼낸다. 없으면 상태 코드라도 보여준다. */
async function errorOf(response: Response) {
	try {
		const body = await response.json();

		if (body?.error) {
			return String(body.error);
		}
	} catch {
		// JSON이 아니면 상태 코드만 쓴다.
	}

	return `노션 저장 실패 (${response.status})`;
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
		const response = await fetch(
			`/__notion-sync/stories/${encodeURIComponent(storyId)}`,
			{
				method: 'PUT',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					ifid: story.ifid,
					name: story.name,
					twee: storyToTwee(story)
				})
			}
		);

		// fetch는 404나 502에도 정상 resolve한다. 상태를 안 보면 실패가 성공과
		// 구별되지 않고, 예전에는 console.warn조차 찍히지 않았다.
		if (!response.ok) {
			const reason = await errorOf(response);

			setStatus({failing: true, reason});
			console.warn(`Notion sync of story ${storyId} failed: ${reason}`);
			return;
		}

		setStatus({failing: false, reason: undefined});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		setStatus({failing: true, reason});
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
		const response = await fetch(
			`/__notion-sync/stories/${encodeURIComponent(storyId)}`,
			{method: 'DELETE'}
		);

		// 저장과 같은 이유로 상태를 본다 — 노션에서 못 지웠는데 로컬에서는 사라져
		// 있으면, 다음 pull에서 그 스토리가 되살아난다.
		if (!response.ok) {
			const reason = await errorOf(response);

			setStatus({failing: true, reason});
			console.warn(`Notion archive of story ${storyId} failed: ${reason}`);
			return;
		}

		setStatus({failing: false, reason: undefined});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		setStatus({failing: true, reason});
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
	/**
	 * The Notion database this row came from. Absent from older servers, and
	 * that absence is meaningful -- see remotelyDeletedStoryIds.
	 */
	dbId?: string;
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

/** A story seen in a previous listing, and the database it was seen in. */
export interface SyncedEntry {
	dbId?: string;
	storyId: string;
}

// 장부 한 줄은 "storyId:dbId"다. 둘 다 uuid라 콜론이 섞일 일이 없다. dbId가 없는
// 줄은 이 형식 이전에(또는 dbId를 안 내려주는 서버에서) 적힌 것이다.
function readSyncedEntries(): SyncedEntry[] {
	try {
		const raw = window.localStorage.getItem(SYNCED_IDS_KEY);

		return (raw ? raw.split(',') : [])
			.filter(Boolean)
			.map(part => part.split(':'))
			.map(([storyId, dbId]) => (dbId ? {storyId, dbId} : {storyId}));
	} catch {
		return [];
	}
}

function writeSyncedEntries(entries: SyncedEntry[]) {
	try {
		window.localStorage.setItem(
			SYNCED_IDS_KEY,
			entries
				.map(({storyId, dbId}) => (dbId ? `${storyId}:${dbId}` : storyId))
				.join(',')
		);
	} catch {
		// 저장 못 해도 진행은 막지 않는다 — 다음 로드에서 삭제 판단만 보류된다.
	}
}

/**
 * Local stories that were present in Notion last time we looked but are gone
 * now — i.e. deleted (or archived) on the Notion side.
 *
 * Only stories from a database this listing actually covered can count as
 * missing. The set of databases we read can shrink without anything being
 * deleted -- a session expires, someone picks a different root page -- and
 * without this scoping every story from the databases that dropped out would
 * look deleted and be removed locally.
 *
 * Pure so the irreversible half of this feature is testable: caller supplies
 * what it recorded previously.
 */
export function remotelyDeletedStoryIds(
	localStories: StoriesState,
	remoteStories: RemoteStory[],
	previouslySynced: SyncedEntry[]
): string[] {
	const remoteIds = new Set(remoteStories.map(r => r.storyId));
	const localIds = new Set(localStories.map(s => s.id));
	const scope = new Set(
		remoteStories.map(r => r.dbId).filter((id): id is string => !!id)
	);

	return previouslySynced
		.filter(
			entry =>
				// 서버가 dbId를 하나도 안 주면 범위를 알 수 없다. 이 폴백은 dbId를 안 보내던
				// 구버전 서버를 위한 것이므로, 장부에 dbId가 있는 항목에는 적용하지 않는다.
				// 원격 목록이 빈 것(DB를 못 찾음, 방금 만든 빈 DB)과 "정말 지워졌다"를
				// 구분할 수 없는데, 틀렸을 때 되돌릴 수 없는 쪽은 삭제다.
				(scope.size === 0 ? !entry.dbId : scope.has(entry.dbId!)) &&
				!remoteIds.has(entry.storyId) &&
				localIds.has(entry.storyId)
		)
		.map(entry => entry.storyId);
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
	const synced = readSyncedEntries();

	if (remote.length === 0) {
		if (synced.length > 0) {
			console.warn(
				'Notion returned no stories; skipping remote-deletion sync this time'
			);
		}
		return {stories: merged, deletedIds: []};
	}

	const deletedIds = remotelyDeletedStoryIds(localStories, remote, synced);

	writeSyncedEntries(remote.map(({storyId, dbId}) => ({storyId, dbId})));

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
