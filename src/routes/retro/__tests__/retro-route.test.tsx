import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {useStoriesContext} from '../../../store/stories';
import {useStoriesRepair} from '../../../store/use-stories-repair';
import {RetroRoute} from '../retro-route';

jest.mock('../../../store/stories', () => ({
	...jest.requireActual('../../../store/stories'),
	useStoriesContext: jest.fn()
}));
jest.mock('../../../store/use-stories-repair');

// 화면이 부르는 엔드포인트별로 응답을 골라주는 최소 목. 각 테스트가 필요한 것만 덮어쓴다.
function mockApi(routes: Record<string, unknown>) {
	const fetchMock = jest.fn(async (url: string, opts?: RequestInit) => {
		const key = `${opts?.method ?? 'GET'} ${String(url).split('?')[0]}`;
		const body = routes[key];

		if (body === undefined) {
			return {ok: false, status: 404, json: async () => ({error: `no mock: ${key}`})};
		}
		return {ok: true, status: 200, json: async () => body};
	});

	(global as any).fetch = fetchMock;
	return fetchMock;
}

const CONNECTED = {connected: true, configured: true, workspaceName: 'ws'};
const LLM_READY = {
	provider: 'anthropic',
	models: [{id: 'claude-opus-4-8', label: 'Opus 4.8', hint: '고품질 · $5/$25'}],
	defaultModel: 'claude-opus-4-8'
};

function renderRoute() {
	return render(
		<MemoryRouter>
			<RetroRoute />
		</MemoryRouter>
	);
}

describe('<RetroRoute>', () => {
	beforeEach(() => {
		(useStoriesContext as jest.Mock).mockReturnValue({
			dispatch: jest.fn(),
			stories: []
		});
		(useStoriesRepair as jest.Mock).mockReturnValue(jest.fn());
		window.localStorage.clear();
	});

	describe('맡긴 자격증명 회수', () => {
		it('AI 키 삭제가 DELETE /api/llm을 부르고 키 입력 화면으로 되돌린다', async () => {
			const fetchMock = mockApi({
				'GET /api/session': CONNECTED,
				'GET /api/llm': LLM_READY,
				'GET /api/notion/retros': {retros: []},
				'DELETE /api/llm': {provider: null, models: [], defaultModel: null}
			});
			jest.spyOn(window, 'confirm').mockReturnValue(true);

			renderRoute();
			const deleteKey = await screen.findByRole('button', {name: 'AI 키 삭제'});
			await userEvent.click(deleteKey);

			await waitFor(() =>
				expect(fetchMock).toHaveBeenCalledWith(
					'/api/llm',
					expect.objectContaining({method: 'DELETE'})
				)
			);
			// 키가 사라졌으니 다시 입력받는 화면으로.
			expect(
				await screen.findByPlaceholderText('sk-ant-... / sk-...')
			).toBeInTheDocument();
		});

		it('취소하면 아무 요청도 보내지 않는다', async () => {
			const fetchMock = mockApi({
				'GET /api/session': CONNECTED,
				'GET /api/llm': LLM_READY,
				'GET /api/notion/retros': {retros: []}
			});
			jest.spyOn(window, 'confirm').mockReturnValue(false);

			renderRoute();
			await userEvent.click(
				await screen.findByRole('button', {name: 'AI 키 삭제'})
			);

			expect(
				fetchMock.mock.calls.filter(([, o]) => (o as RequestInit)?.method === 'DELETE')
			).toHaveLength(0);
		});

		it('연결 해제가 DELETE /api/session을 부르고 연결 화면으로 되돌린다', async () => {
			const fetchMock = mockApi({
				'GET /api/session': CONNECTED,
				'GET /api/llm': LLM_READY,
				'GET /api/notion/retros': {retros: []},
				'DELETE /api/session': {connected: false, configured: false}
			});
			jest.spyOn(window, 'confirm').mockReturnValue(true);

			renderRoute();
			await userEvent.click(
				await screen.findByRole('button', {name: 'Notion 연결 해제'})
			);

			await waitFor(() =>
				expect(fetchMock).toHaveBeenCalledWith(
					'/api/session',
					expect.objectContaining({method: 'DELETE'})
				)
			);
			expect(
				await screen.findByRole('link', {name: 'Notion으로 연결'})
			).toBeInTheDocument();
			// 연결이 끊겼으면 지울 자격증명도 없으므로 회수 링크는 감춘다.
			expect(
				screen.queryByRole('button', {name: 'AI 키 삭제'})
			).not.toBeInTheDocument();
		});

		it('연결 전에는 회수 링크를 노출하지 않는다', async () => {
			mockApi({
				'GET /api/session': {connected: false, configured: false}
			});

			renderRoute();
			await screen.findByRole('link', {name: 'Notion으로 연결'});
			expect(
				screen.queryByRole('button', {name: 'Notion 연결 해제'})
			).not.toBeInTheDocument();
		});
	});

	describe('사용량·비용 표시', () => {
		// runTranslate만 따로 부를 수 없어, 화면이 이미 붙여둔 fetch 목을 통해
		// /api/translate 응답을 흘려보내는 대신 표시 로직을 직접 확인한다.
		function translateResponse(overrides: Record<string, unknown> = {}) {
			return {
				questions: [],
				twee: ':: StoryTitle\nT\n\n:: StoryData\n{"start":"출발"}\n\n:: 출발\n끝',
				draftUpdate: '초안',
				model: 'claude-opus-4-8',
				usage: {
					inputTokens: 9500,
					outputTokens: 12000,
					cacheReadTokens: 0,
					cacheWriteTokens: 0
				},
				// 반올림 경계(…5)를 피한 값 — 경계값은 부동소수점 표현 때문에 기대값이 흔들린다.
				costUsd: 0.35,
				...overrides
			};
		}

		it('번역 후 누적 사용량과 금액을 보여준다', async () => {
			mockApi({
				'GET /api/session': CONNECTED,
				'GET /api/llm': LLM_READY,
				'GET /api/notion/retros': {retros: [{id: 'p1', title: '7주차 회고'}]},
				'GET /api/notion/draft': {draft: '지난주에 배포를 미뤘다.'},
				'POST /api/translate': translateResponse()
			});

			renderRoute();
			await userEvent.click(await screen.findByRole('button', {name: /7주차 회고/}));

			await waitFor(() =>
				expect(screen.getByText(/번역 1회/)).toBeInTheDocument()
			);
			const line = screen.getByText(/번역 1회/).textContent ?? '';
			expect(line).toContain('입력 9.5K');
			expect(line).toContain('출력 12.0K');
			expect(line).toContain('약 $0.350');
			// 캐싱을 켜지 않았으므로 캐시 항목은 감춘다.
			expect(line).not.toContain('캐시');
		});

		it('단가를 모르는 모델이면 금액 대신 안내를 보여준다', async () => {
			mockApi({
				'GET /api/session': CONNECTED,
				'GET /api/llm': LLM_READY,
				'GET /api/notion/retros': {retros: [{id: 'p1', title: '7주차 회고'}]},
				'GET /api/notion/draft': {draft: '지난주에 배포를 미뤘다.'},
				'POST /api/translate': translateResponse({model: 'gpt-5', costUsd: null})
			});

			renderRoute();
			await userEvent.click(await screen.findByRole('button', {name: /7주차 회고/}));

			await waitFor(() =>
				expect(screen.getByText(/단가가 등록돼 있지 않아/)).toBeInTheDocument()
			);
			expect(screen.getByText(/번역 1회/).textContent).not.toContain('$');
		});
	});
});
