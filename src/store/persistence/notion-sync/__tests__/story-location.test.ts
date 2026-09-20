import {forgetSyncStatus, moveStoryHere, storyLocation} from '..';

const PUSHED_DB_KEY = 'twine-notion-pushed-db';
const SYNCED_IDS_KEY = 'twine-notion-synced-stories';

// /__notion-sync/status로 저장 위치를 먼저 잡아 둔다 — storyLocation은 "지금 DB"를
// 알기 전에는 아무 말도 하지 않는다.
function mockStatus(dbId: string | null, enabled = true) {
	(global as any).fetch = jest.fn(async (url: string) => {
		if (String(url).includes('/status')) {
			return {ok: true, json: async () => ({connected: true, dbId, enabled})};
		}

		return {ok: true, json: async () => ({})};
	});
}

// 상태 캐시를 깨워 status를 다시 읽게 한다.
async function primeWith(dbId: string | null, enabled = true) {
	forgetSyncStatus();
	mockStatus(dbId, enabled);
	// isEnabled는 비공개라 공개 경로로 한 번 태운다.
	await moveStoryHere('warm-up');
}

describe('storyLocation', () => {
	beforeEach(() => {
		window.localStorage.clear();
		forgetSyncStatus();
	});

	it('저장 위치를 아직 모르면 판단하지 않는다', () => {
		expect(storyLocation('story-1')).toBe('unknown');
	});

	it('푸시 기록의 DB가 지금 DB와 같으면 제자리다', async () => {
		await primeWith('db-a');
		window.localStorage.setItem(
			PUSHED_DB_KEY,
			JSON.stringify({'story-1': 'db-a'})
		);

		expect(storyLocation('story-1')).toBe('here');
	});

	// 저장 위치를 바꾼 뒤의 모습 — 예전 DB에 있다고 적혀 있다.
	it('푸시 기록의 DB가 지금과 다르면 다른 곳이다', async () => {
		await primeWith('db-b');
		window.localStorage.setItem(
			PUSHED_DB_KEY,
			JSON.stringify({'story-1': 'db-a'})
		);

		expect(storyLocation('story-1')).toBe('elsewhere');
	});

	// pull 장부에도 어디서 봤는지가 적힌다. 푸시 기록이 없어도 그걸 쓴다.
	it('푸시 기록이 없으면 pull 장부를 본다', async () => {
		await primeWith('db-a');
		window.localStorage.setItem(SYNCED_IDS_KEY, 'story-1:db-a,story-2:db-z');

		expect(storyLocation('story-1')).toBe('here');
		expect(storyLocation('story-2')).toBe('elsewhere');
	});

	it('어디에도 기록이 없으면 노션에 올라간 적이 없는 것이다', async () => {
		await primeWith('db-a');
		expect(storyLocation('story-1')).toBe('none');
	});
});

describe('moveStoryHere', () => {
	beforeEach(() => {
		window.localStorage.clear();
		forgetSyncStatus();
	});

	// 꺼져 있는데 "옮겼다"고 말하면 안 된다. 버튼이 성공했다고 해 놓고 아무 데도
	// 안 가는 것이 이 앱이 반복해 온 사고다.
	it('동기화가 꺼져 있으면 성공이라고 하지 않는다', async () => {
		mockStatus(null, false);

		const result = await moveStoryHere('story-1');

		expect(result.ok).toBe(false);
		expect(result).toHaveProperty('reason');
	});
});
