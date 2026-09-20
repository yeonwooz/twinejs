import {ApiUnavailableError, fetchJson} from '../json-fetch';

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
