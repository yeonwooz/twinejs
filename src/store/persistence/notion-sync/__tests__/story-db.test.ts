import {
	forgetSyncStatus,
	notionSaveMiddleware,
	setStoryDb,
	storyDbId
} from '..';
import {Story} from '../../../stories';
import {storyFromTwee} from '../../../../util/twee';

const STORY_DB_KEY = 'twine-notion-story-db';

// 모듈이 들고 있는 lastState는 미들웨어가 채운다. 밀어 넣을 스토리가 거기 없으면
// syncStory가 조용히 돌아서고, 그건 실패다.
function seedStory(id: string) {
	const story: Story = {
		...storyFromTwee(
			[
				':: StoryTitle',
				'옮길 스토리',
				'',
				':: StoryData',
				'{"ifid":"AAAA","format":"Harlowe","start":"시작"}',
				'',
				':: 시작',
				'본문'
			].join('\n')
		),
		id
	};

	notionSaveMiddleware([story], {type: 'init', state: [story]});
}

// /__notion-sync/status로 기본 저장 위치를 잡고, 쓰기 요청을 잡아 둔다.
function mockSync(dbId: string | null, writeOk = true) {
	const calls: string[] = [];

	(global as any).fetch = jest.fn(async (url: string): Promise<any> => {
		if (String(url).includes('/status')) {
			return {
				ok: true,
				json: async () => ({connected: true, dbId, enabled: !!dbId})
			};
		}

		calls.push(String(url));

		return {
			ok: writeOk,
			status: writeOk ? 200 : 404,
			json: async () => (writeOk ? {ok: true} : {error: '권한이 없어요 (404)'})
		};
	});

	return calls;
}

describe('storyDbId', () => {
	beforeEach(() => {
		window.localStorage.clear();
		forgetSyncStatus();
	});

	it('따로 고른 적이 없으면 기본 저장 위치다', async () => {
		mockSync('db-default');
		seedStory('warm-up');
		await setStoryDb('warm-up', 'db-default');

		expect(storyDbId('story-1')).toBe('db-default');
	});

	it('고른 적이 있으면 그 DB다', async () => {
		window.localStorage.setItem(
			STORY_DB_KEY,
			JSON.stringify({'story-1': 'db-other'})
		);

		expect(storyDbId('story-1')).toBe('db-other');
	});
});

describe('setStoryDb', () => {
	beforeEach(() => {
		window.localStorage.clear();
		forgetSyncStatus();
	});

	it('고른 DB를 목적지로 붙여 바로 밀어 넣는다', async () => {
		const calls = mockSync('db-default');

		seedStory('story-1');

		const result = await setStoryDb('story-1', 'db-other');

		expect(result.ok).toBe(true);
		expect(calls.some(url => url.includes('db=db-other'))).toBe(true);
		expect(storyDbId('story-1')).toBe('db-other');
	});

	// 기본 저장 위치로 되돌리는 건 "지정 없음"이다 — 굳이 적어두면 기본값이 바뀔 때
	// 예전 값에 발이 묶인다.
	it('기본 저장 위치로 되돌리면 지정을 지운다', async () => {
		mockSync('db-default');
		seedStory('story-1');
		await setStoryDb('story-1', 'db-other');
		await setStoryDb('story-1', 'db-default');

		expect(
			JSON.parse(window.localStorage.getItem(STORY_DB_KEY) ?? '{}')
		).not.toHaveProperty('story-1');
	});

	// 못 옮겼는데 지정만 남으면 이후 저장이 계속 그쪽으로 향한다 — 조용히 엉뚱한 DB에
	// 쌓이는 건 이 앱이 이미 겪은 사고다.
	it('옮기기가 실패하면 지정도 되돌린다', async () => {
		mockSync('db-default', false);
		seedStory('story-1');

		const result = await setStoryDb('story-1', 'db-other');

		expect(result.ok).toBe(false);
		expect(storyDbId('story-1')).toBe('db-default');
	});

	it('동기화가 꺼져 있으면 성공이라고 하지 않는다', async () => {
		mockSync(null);

		const result = await setStoryDb('story-1', 'db-other');

		expect(result.ok).toBe(false);
		expect(result).toHaveProperty('reason');
	});
});

// 노션 오류를 그대로 내보내면 JSON 덩어리가 목록 한 줄을 통째로 무너뜨린다 — 겪었다.
describe('실패 문구', () => {
	beforeEach(() => {
		window.localStorage.clear();
		forgetSyncStatus();
	});

	it('DB를 못 찾는 오류는 사람 문장으로 바꾼다', async () => {
		(global as any).fetch = jest.fn(async (url: string): Promise<any> => {
			if (String(url).includes('/status')) {
				return {
					ok: true,
					json: async () => ({
						connected: true,
						dbId: 'db-default',
						enabled: true
					})
				};
			}

			return {
				ok: false,
				status: 502,
				json: async () => ({
					error:
						'Notion API POST /databases/db-x/query failed: 404 {"object":"error","code":"object_not_found","message":"Could not find database with ID: db-x"}'
				})
			};
		});
		seedStory('story-1');

		const result = await setStoryDb('story-1', 'db-other');

		expect(result).toMatchObject({
			ok: false,
			reason:
				'그 DB를 찾을 수 없어요. 노션에서 통합에 공유돼 있는지 확인해 주세요.'
		});
	});
});
