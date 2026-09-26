import {ApiUnavailableError, fetchJson, humanizeError} from '../json-fetch';

function mockResponse(overrides: Record<string, unknown> = {}) {
	(global as any).fetch = jest.fn(async () => ({
		ok: true,
		status: 200,
		headers: {get: () => 'application/json'},
		json: async () => ({ok: true}),
		...overrides
	}));

	return (global as any).fetch as jest.Mock;
}

describe('fetchJson', () => {
	it('본문이 있으면 POST로 보내고 JSON을 돌려준다', async () => {
		const fetchMock = mockResponse();

		expect(await fetchJson('/api/thing', {body: {a: 1}})).toEqual({ok: true});
		expect(fetchMock.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			body: '{"a":1}'
		});
	});

	// fetch는 404·502에도 정상 resolve한다. 예전에 이걸 안 봐서 실패가 성공과 구별되지
	// 않았고 화면은 멀쩡해 보였다.
	it('실패하면 서버가 준 이유를 꺼내 던진다', async () => {
		mockResponse({
			ok: false,
			status: 400,
			json: async () => ({error: '초안 페이지가 정해지지 않았습니다.'})
		});

		await expect(fetchJson('/api/thing')).rejects.toThrow(
			'초안 페이지가 정해지지 않았습니다.'
		);
	});

	it('상태 코드를 에러에 붙여 호출부가 갈라 쓸 수 있게 한다', async () => {
		mockResponse({ok: false, status: 401, json: async () => ({})});

		await expect(fetchJson('/api/thing')).rejects.toMatchObject({status: 401});
	});

	// vite dev는 없는 /api/* 에 index.html을 200으로 돌려준다. ok만 보면 통과하고
	// json()에서 `Unexpected token '<'`가 화면에 그대로 찍힌다 — 실제로 겪었다.
	it('JSON이 아닌 200 응답은 배포 전용 기능이라고 말한다', async () => {
		mockResponse({headers: {get: () => 'text/html'}});

		await expect(fetchJson('/api/thing')).rejects.toBeInstanceOf(
			ApiUnavailableError
		);
	});
});

describe('humanizeError', () => {
	// node undici가 내는 말. 서버가 노션으로 나가는 fetch에 실패하면 이게 그대로
	// 화면에 찍혔다 -- "fetch failed" 네 글자가 설정 화면에 떠 있었다.
	it.each(['fetch failed', 'Failed to fetch', 'ENOTFOUND api.notion.com'])(
		'%s 는 네트워크 문제라고 말한다',
		message => {
			expect(humanizeError(message)).toMatch(/네트워크를 확인/);
		}
	);

	it('노션 API 덩어리는 한 문장으로 줄인다', () => {
		expect(
			humanizeError(
				'Notion API POST /databases/x/query failed: 404 {"object":"error","code":"object_not_found"}'
			)
		).toMatch(/DB를 찾을 수 없어요/);
	});

	// 통째로 숨기면 무슨 일이 일어났는지 알 길이 없어진다.
	it('모르는 오류는 남기되 한 줄 길이로 자른다', () => {
		expect(humanizeError('무언가 이상함')).toBe('무언가 이상함');
		expect(humanizeError('가'.repeat(300))).toHaveLength(161);
	});
});
