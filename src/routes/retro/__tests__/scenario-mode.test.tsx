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

// retro-route.test.tsx와 같은 최소 목 — 쿼리스트링은 키에서 떼고 호출 검증에서 본다.
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
const TRANSLATED = {
	questions: [],
	twee: ':: StoryTitle\nT\n\n:: StoryData\n{"start":"시작"}\n\n:: 시작\n끝',
	draftUpdate: '구상',
	model: 'claude-opus-4-8',
	usage: {inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0},
	costUsd: 0.1
};

function renderScenario() {
	return render(
		<MemoryRouter>
			<RetroRoute mode="scenario" />
		</MemoryRouter>
	);
}

describe('<RetroRoute mode="scenario">', () => {
	beforeEach(() => {
		(useStoriesContext as jest.Mock).mockReturnValue({
			dispatch: jest.fn(),
			stories: []
		});
		(useStoriesRepair as jest.Mock).mockReturnValue(jest.fn());
		window.localStorage.clear();
	});

	it('시나리오 문구로 뜨고 목록을 kind=scenario로 불러온다', async () => {
		const fetchMock = mockApi({
			'GET /api/session': CONNECTED,
			'GET /api/llm': LLM_READY,
			'GET /api/notion/retros': {retros: []}
		});

		renderScenario();
		expect(
			await screen.findByRole('heading', {name: '창작 시나리오'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: '새 시나리오 시작'})
		).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/notion/retros?kind=scenario',
			expect.anything()
		);
	});

	it('생성 요청에 mode=scenario를 싣고, 완료 화면에 회고 전용 메시지 칸이 없다', async () => {
		const fetchMock = mockApi({
			'GET /api/session': CONNECTED,
			'GET /api/llm': LLM_READY,
			'GET /api/notion/retros': {retros: [{id: 's1', title: '경성 미스터리'}]},
			'GET /api/notion/draft': {draft: '경성 배경의 미스터리를 만들고 싶다.'},
			'POST /api/translate': TRANSLATED
		});

		renderScenario();
		await userEvent.click(
			await screen.findByRole('button', {name: /경성 미스터리/})
		);

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/translate',
				expect.objectContaining({method: 'POST'})
			)
		);
		const [, translateOpts] = fetchMock.mock.calls.find(
			([url]) => url === '/api/translate'
		)!;
		expect(JSON.parse((translateOpts as RequestInit).body as string).mode).toBe(
			'scenario'
		);

		// 완료 화면: "그때의 나에게" 저장 칸은 회고 전용이라 시나리오에는 없다.
		await screen.findByRole('button', {name: '▶ Play'});
		expect(screen.queryByText(/그때의 나에게 한마디/)).not.toBeInTheDocument();
	});

	it('새 시나리오 생성 요청에 kind=scenario를 싣는다', async () => {
		const fetchMock = mockApi({
			'GET /api/session': CONNECTED,
			'GET /api/llm': LLM_READY,
			'GET /api/notion/retros': {retros: []},
			'POST /api/notion/retros': {id: 's2', title: '마지막 출근'}
		});

		renderScenario();
		await userEvent.type(
			await screen.findByPlaceholderText(/경성 미스터리/),
			'마지막 출근'
		);
		await userEvent.click(screen.getByRole('button', {name: '새 시나리오 시작'}));

		await waitFor(() => {
			const call = fetchMock.mock.calls.find(
				([url, o]) =>
					url === '/api/notion/retros' && (o as RequestInit)?.method === 'POST'
			);
			expect(call).toBeDefined();
			expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
				title: '마지막 출근',
				kind: 'scenario'
			});
		});
	});
});
