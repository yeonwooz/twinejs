import {
	mergeRemoteStories,
	remoteFingerprint,
	remotelyDeletedStoryIds,
	RemoteStory,
	RemoteStoryMeta
} from '..';
import {Story} from '../../../stories';
import {storyFromTwee} from '../../../../util/twee';

const TWEE = [
	':: StoryTitle',
	'Merge Test',
	'',
	':: StoryData',
	'{"ifid":"MERGE-IFID","format":"Harlowe","format-version":"3.3.9","start":"Start"}',
	'',
	':: Start {"position":"25,25","size":"100,100"}',
	'Original text.',
	''
].join('\n');
const EDITED_TWEE = TWEE.replace('Original text.', 'Edited in Notion.');

function localStory(twee: string, id: string, lastUpdate: Date): Story {
	const story = storyFromTwee(twee);

	return {
		...story,
		id,
		lastUpdate,
		passages: story.passages.map(passage => ({...passage, story: id}))
	};
}

function fakeRemote(props: Partial<RemoteStory> = {}): RemoteStory {
	return {
		lastEdited: null,
		lastSynced: null,
		storyId: 'story-1',
		twee: TWEE,
		...props
	};
}

describe('mergeRemoteStories', () => {
	it('adds stories that only exist in Notion', () => {
		const result = mergeRemoteStories(
			[],
			[fakeRemote({lastSynced: '2026-07-08T00:00:00Z'})]
		);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('story-1');
		expect(result[0].name).toBe('Merge Test');
		expect(result[0].passages[0].text).toBe('Original text.');
		expect(result[0].lastUpdate).toEqual(new Date('2026-07-08T00:00:00Z'));
	});

	it('leaves a story alone when the Notion copy has identical content, even if its timestamp is newer', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({lastSynced: '2026-07-08T00:00:00Z'})]
		);

		expect(result).toEqual([local]);
	});

	it('pulls the Notion copy when its content differs and it is newer', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})]
		);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('story-1');
		expect(result[0].passages[0].text).toBe('Edited in Notion.');
		expect(result[0].lastUpdate).toEqual(new Date('2026-07-08T09:00:00Z'));
	});

	it('keeps the local copy when it is newer than a differing Notion copy', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-08T09:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-01T00:00:00Z'})]
		);

		expect(result).toEqual([local]);
	});

	it('uses the later of lastEdited and lastSynced as the Notion timestamp', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[
				fakeRemote({
					twee: EDITED_TWEE,
					lastEdited: '2026-07-08T09:00:00Z',
					lastSynced: '2026-06-01T00:00:00Z'
				})
			]
		);

		expect(result[0].passages[0].text).toBe('Edited in Notion.');
	});

	it('leaves stories in skipStoryIds alone even when the Notion copy is newer', () => {
		// 로컬 편집이 아직 푸시되지 않은(디바운스 대기 중) 스토리가 이 경우다.
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})],
			['story-1']
		);

		expect(result).toEqual([local]);
	});

	it('skips Notion stories whose twee cannot be parsed', () => {
		const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

		try {
			const local = localStory(
				TWEE,
				'story-1',
				new Date('2026-07-01T00:00:00Z')
			);
			const result = mergeRemoteStories(
				[local],
				[fakeRemote({storyId: 'story-2', twee: ':: \nbroken'})]
			);

			expect(result).toEqual([local]);
		} finally {
			warnSpy.mockRestore();
		}
	});
});

// Notion 쪽 삭제를 로컬에 반영하는 판단. 되돌릴 수 없는 동작이라 경계를 못박아 둔다.
describe('remotelyDeletedStoryIds', () => {
	const local = [
		localStory(TWEE, 'story-1', new Date(1000)),
		localStory(TWEE, 'story-2', new Date(1000))
	];

	// dbId를 안 주는 서버(구버전 dev 미들웨어 등)에서는 목록 전체가 기준이다.
	const seen = (...ids: string[]) => ids.map(storyId => ({storyId}));

	it('원격에서 사라진, 전에 본 스토리를 삭제 대상으로 고른다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1'})],
				seen('story-1', 'story-2')
			)
		).toEqual(['story-2']);
	});

	it('전에 본 적 없는 스토리는 원격에 없어도 건드리지 않는다', () => {
		// 방금 로컬에서 만들어 아직 푸시되지 않은 스토리(3초 디바운스)가 이 경우다.
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1'})],
				seen('story-1')
			)
		).toEqual([]);
	});

	it('원격에 그대로 있으면 삭제하지 않는다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1'}), fakeRemote({storyId: 'story-2'})],
				seen('story-1', 'story-2')
			)
		).toEqual([]);
	});

	it('로컬에 이미 없는 id는 결과에 넣지 않는다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1'})],
				seen('story-1', 'story-2', 'story-gone-everywhere')
			)
		).toEqual(['story-2']);
	});

	it('장부가 비어 있으면(첫 로드) 아무것도 삭제하지 않는다', () => {
		expect(remotelyDeletedStoryIds(local, [], [])).toEqual([]);
	});

	// 세션이 만료돼 읽는 DB가 줄면, 빠진 DB의 스토리는 "사라진" 게 아니라 이번에
	// 안 본 것이다. 여기서 구분하지 못하면 멀쩡한 스토리가 로컬에서 지워진다.
	// 기본 저장 위치를 새로 정하면 빈 DB를 읽을 수 있다. 그때 원격 목록은 비지만
	// 장부에는 예전 DB가 적혀 있다 — 못 본 것이지 지워진 게 아니다.
	it('원격 목록이 비어도 장부에 DB가 적혀 있으면 지우지 않는다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[],
				[
					{storyId: 'story-1', dbId: 'db-a'},
					{storyId: 'story-2', dbId: 'db-a'}
				]
			)
		).toEqual([]);
	});

	it('이번에 읽지 않은 DB의 스토리는 삭제 대상이 아니다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1', dbId: 'db-a'})],
				[
					{storyId: 'story-1', dbId: 'db-a'},
					{storyId: 'story-2', dbId: 'db-b'}
				]
			)
		).toEqual([]);
	});

	it('읽은 DB 안에서 사라진 스토리는 그대로 삭제 대상이다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1', dbId: 'db-a'})],
				[
					{storyId: 'story-1', dbId: 'db-a'},
					{storyId: 'story-2', dbId: 'db-a'}
				]
			)
		).toEqual(['story-2']);
	});

	it('DB를 모른 채 적힌 옛 장부는 한 번 건너뛴다 — 그 사이 장부가 다시 쓰인다', () => {
		expect(
			remotelyDeletedStoryIds(
				local,
				[fakeRemote({storyId: 'story-1', dbId: 'db-a'})],
				seen('story-1', 'story-2')
			)
		).toEqual([]);
	});
});

// 조율 함수. 여기 안전장치가 들어 있다 — 빈 원격 응답을 "전부 삭제"로 오해하지 않기.
// isEnabled()가 모듈 스코프에 결과를 캐시하므로 테스트마다 모듈을 새로 불러온다.
describe('mergeStoriesFromNotion', () => {
	const local = [localStory(TWEE, 'story-1', new Date(1000))];

	async function load(routes: {
		status?: unknown;
		stories?: unknown;
		ok?: boolean;
	}) {
		jest.resetModules();
		(global as any).fetch = jest.fn(async (url: string) => {
			if (String(url).endsWith('/status')) {
				return {ok: true, json: async () => routes.status ?? {enabled: true}};
			}
			return {
				ok: routes.ok ?? true,
				json: async () => routes.stories ?? []
			};
		});
		return (await import('..')).mergeStoriesFromNotion(local);
	}

	beforeEach(() => window.localStorage.clear());

	it('원격 목록이 비어 있으면 장부가 있어도 삭제하지 않는다', async () => {
		window.localStorage.setItem('twine-notion-synced-stories', 'story-1');

		const result = await load({stories: []});

		expect(result.deletedIds).toEqual([]);
		expect(result.stories.map(s => s.id)).toEqual(['story-1']);
		// 장부를 지우지 않아야 다음 정상 응답에서 다시 비교할 수 있다.
		expect(window.localStorage.getItem('twine-notion-synced-stories')).toBe(
			'story-1'
		);
	});

	it('원격에 다른 스토리만 있으면 사라진 것을 삭제 대상으로 돌려준다', async () => {
		window.localStorage.setItem('twine-notion-synced-stories', 'story-1');

		const result = await load({stories: [fakeRemote({storyId: 'story-2'})]});

		expect(result.deletedIds).toEqual(['story-1']);
		// 반환 목록에서도 빠져야 한다.
		expect(result.stories.map(s => s.id)).not.toContain('story-1');
		// 장부는 이번 원격 목록으로 갱신된다.
		expect(window.localStorage.getItem('twine-notion-synced-stories')).toBe(
			'story-2'
		);
	});

	it('장부에 어느 DB에서 봤는지까지 적는다', async () => {
		await load({stories: [fakeRemote({storyId: 'story-1', dbId: 'db-a'})]});

		expect(window.localStorage.getItem('twine-notion-synced-stories')).toBe(
			'story-1:db-a'
		);
	});

	it('이번에 읽지 않은 DB의 스토리는 지우지 않는다', async () => {
		window.localStorage.setItem(
			'twine-notion-synced-stories',
			'story-1:db-b,story-2:db-b'
		);

		const result = await load({
			stories: [fakeRemote({storyId: 'story-2', dbId: 'db-a'})]
		});

		expect(result.deletedIds).toEqual([]);
		expect(result.stories.map(s => s.id)).toContain('story-1');
	});

	it('요청이 실패하면 아무것도 건드리지 않는다', async () => {
		window.localStorage.setItem('twine-notion-synced-stories', 'story-1');

		const result = await load({ok: false});

		expect(result.deletedIds).toEqual([]);
		expect(result.stories).toEqual(local);
	});

	it('sync가 꺼져 있으면 아무것도 건드리지 않는다', async () => {
		const result = await load({status: {enabled: false}});

		expect(result.deletedIds).toEqual([]);
		expect(result.stories).toEqual(local);
	});
});

// 어느 노션 DB에 저장할지는 서버가 정한다(위저드에서 고른 루트 페이지 아래의 DB).
// 클라는 스토리 내용만 올린다.
describe('푸시 본문', () => {
	it('twee와 식별자만 싣는다', async () => {
		jest.resetModules();
		jest.useFakeTimers();

		const fetchMock = jest.fn(async (url: string, init?: RequestInit) => ({
			ok: true,
			json: async () =>
				String(url).endsWith('/status') ? {enabled: true} : [],
			init
		}));

		(global as any).fetch = fetchMock;

		const mod = await import('..');
		// scenario 태그는 편집기에서 구분하려고 다는 라벨일 뿐 — 저장 위치를 바꾸지
		// 않으므로 본문에 실리지 않는다.
		const story = {
			...localStory(TWEE, 'story-1', new Date(1000)),
			tags: ['scenario']
		};

		mod.notionSaveMiddleware([story], {
			props: {},
			storyId: story.id,
			type: 'updateStory'
		} as any);

		await jest.advanceTimersByTimeAsync(5000);
		jest.useRealTimers();

		const call = fetchMock.mock.calls.find(([url]) =>
			String(url).includes('/stories/')
		);

		expect(
			call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined
		).toEqual({
			ifid: 'MERGE-IFID',
			name: 'Merge Test',
			twee: expect.stringContaining(':: StoryTitle')
		});
	});
});

// 폴링이 값싸게 유지되는 근거. 지문이 같으면 본문(twee)을 다시 받지 않는다.
describe('remoteFingerprint', () => {
	it('같은 목록이면 순서가 달라도 같은 값', () => {
		expect(
			remoteFingerprint([
				fakeRemote({storyId: 'a', lastSynced: '2026-07-08T00:00:00Z'}),
				fakeRemote({storyId: 'b', lastSynced: '2026-07-09T00:00:00Z'})
			])
		).toBe(
			remoteFingerprint([
				fakeRemote({storyId: 'b', lastSynced: '2026-07-09T00:00:00Z'}),
				fakeRemote({storyId: 'a', lastSynced: '2026-07-08T00:00:00Z'})
			])
		);
	});

	it('타임스탬프가 움직이면 값이 달라진다', () => {
		expect(
			remoteFingerprint([fakeRemote({lastSynced: '2026-07-08T00:00:00Z'})])
		).not.toBe(
			remoteFingerprint([fakeRemote({lastSynced: '2026-07-08T00:00:01Z'})])
		);
	});

	it('스토리가 늘거나 줄면 값이 달라진다', () => {
		expect(remoteFingerprint([fakeRemote()])).not.toBe(
			remoteFingerprint([fakeRemote(), fakeRemote({storyId: 'story-2'})])
		);
	});
});

// 앱이 켜져 있는 동안 반복 호출되는 쪽. 관심사는 두 개 — 바뀐 걸 실제로 가져오는가,
// 그리고 안 바뀌었을 때 본문 요청을 아끼는가.
describe('pullRemoteChanges', () => {
	const local = [localStory(TWEE, 'story-1', new Date(1000))];

	function metaOf(remote: RemoteStory): RemoteStoryMeta {
		return {
			storyId: remote.storyId,
			lastEdited: remote.lastEdited,
			lastSynced: remote.lastSynced
		};
	}

	// isEnabled()와 지문이 모듈 스코프에 남으므로 테스트마다 모듈을 새로 불러온다.
	async function harness(initialRemote: RemoteStory[]) {
		jest.resetModules();

		const state = {bodyFetches: 0, remote: initialRemote};

		(global as any).fetch = jest.fn(async (url: string) => {
			const href = String(url);

			if (href.endsWith('/status')) {
				return {ok: true, json: async () => ({enabled: true})};
			}

			if (href.includes('meta=1')) {
				return {ok: true, json: async () => state.remote.map(metaOf)};
			}

			state.bodyFetches++;
			return {ok: true, json: async () => state.remote};
		});

		return {module: await import('..'), state};
	}

	beforeEach(() => window.localStorage.clear());

	it('노션 쪽이 더 새로우면 본문을 받아 반영한다', async () => {
		const {module, state} = await harness([
			fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})
		]);
		const result = await module.pullRemoteChanges(local);

		expect(result.changed).toBe(true);
		expect(result.stories[0].passages[0].text).toBe('Edited in Notion.');
		expect(state.bodyFetches).toBe(1);
	});

	it('지문이 그대로면 본문을 다시 받지 않고 changed=false', async () => {
		const {module, state} = await harness([
			fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})
		]);

		await module.pullRemoteChanges(local);
		const second = await module.pullRemoteChanges(local);

		expect(second.changed).toBe(false);
		expect(second.stories).toBe(local);
		expect(state.bodyFetches).toBe(1);
	});

	it('지문이 바뀌면 다시 본문을 받는다', async () => {
		const {module, state} = await harness([
			fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})
		]);

		await module.pullRemoteChanges(local);
		state.remote = [
			fakeRemote({
				twee: TWEE.replace('Original text.', 'Edited again.'),
				lastSynced: '2026-07-08T10:00:00Z'
			})
		];

		const second = await module.pullRemoteChanges(local);

		expect(second.changed).toBe(true);
		expect(second.stories[0].passages[0].text).toBe('Edited again.');
		expect(state.bodyFetches).toBe(2);
	});

	it('내용이 같으면 지문이 달라도 changed=false', async () => {
		// 우리가 방금 푸시한 경우다 — Last Synced만 움직여서 본문은 한 번 더 받지만,
		// 스토어를 건드릴 이유는 없다.
		const {module} = await harness([
			fakeRemote({lastSynced: '2026-07-08T09:00:00Z'})
		]);
		const result = await module.pullRemoteChanges(local);

		expect(result.changed).toBe(false);
		// 스토리 객체가 교체되지 않아야 한다(배열 자체는 병합이 매번 새로 만든다).
		expect(result.stories[0]).toBe(local[0]);
	});

	it('푸시 대기 중인 스토리는 노션 쪽이 새로워도 덮어쓰지 않는다', async () => {
		jest.useFakeTimers();

		try {
			const {module} = await harness([
				fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})
			]);

			// 로컬 편집 → 3초 디바운스가 걸린 상태. 아직 노션에 안 올라간 최신 텍스트가
			// 이 브라우저에 있으므로 원격이 권위를 가질 수 없다.
			module.notionSaveMiddleware(local, {
				type: 'updateStory',
				storyId: 'story-1',
				props: {name: 'Edited locally'}
			});

			const result = await module.pullRemoteChanges(local);

			expect(result.changed).toBe(false);
			expect(result.stories[0]).toBe(local[0]);
		} finally {
			jest.useRealTimers();
		}
	});
});
