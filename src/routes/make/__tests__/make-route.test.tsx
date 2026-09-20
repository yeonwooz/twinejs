import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {MakeRoute} from '../make-route';

const dispatch = jest.fn();

jest.mock('../../../store/stories', () => ({
	...jest.requireActual('../../../store/stories'),
	useStoriesContext: () => ({dispatch, stories: []})
}));
jest.mock('../../../store/use-stories-repair', () => ({
	useStoriesRepair: () => jest.fn()
}));

const drafts = jest.fn();

jest.mock('../../../store/records', () => ({
	fetchDrafts: () => drafts()
}));

const TWEE = [
	':: StoryTitle',
	'경성 미스터리',
	'',
	':: StoryData',
	'{"ifid":"AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE","format":"Harlowe","start":"시작"}',
	'',
	':: 시작 [막]',
	'문이 열렸다.'
].join('\n');

// /api/llm, /api/translate, /api/notion/draft를 한 번에 흉내낸다.
function mockApi(translate: unknown) {
	(global as any).fetch = jest.fn(async (url: string) => ({
		ok: true,
		status: 200,
		headers: {get: () => 'application/json'},
		json: async () => {
			if (String(url).includes('/api/llm')) {
				return {provider: 'anthropic', models: [], defaultModel: 'm'};
			}

			if (String(url).includes('/api/translate')) {
				return translate;
			}

			return {ok: true};
		}
	}));
}

function renderAt(state?: Record<string, unknown>) {
	return render(
		<MemoryRouter initialEntries={[{pathname: '/make/page-1', state}]}>
			<Route path="/make/:pageId">
				<MakeRoute />
			</Route>
		</MemoryRouter>
	);
}

describe('<MakeRoute>', () => {
	beforeEach(() => {
		dispatch.mockReset();
		drafts.mockResolvedValue([]);
	});

	// importStories는 thunk다 — 안쪽에서 createStory 액션을 흘린다. 스파이를 물려
	// 돌려보고 실제로 만들어진 스토리의 props를 본다.
	function importedStoryProps() {
		const thunk = dispatch.mock.calls.find(
			([action]) => typeof action === 'function'
		)?.[0];
		const inner = jest.fn();

		thunk(inner, () => []);

		return inner.mock.calls.find(
			([action]) => action?.type === 'createStory'
		)?.[0].props;
	}

	// 회귀: `mode` state를 읽던 클로저가 최초 진입 시점엔 아직 'retro'라서, 작문대로 만든
	// 시나리오에 scenario 태그가 안 붙었다. 종류는 인자로 흘러야 한다.
	it('작문대에서 넘어온 시나리오에 scenario 태그를 단다', async () => {
		mockApi({twee: TWEE, questions: [], model: 'm'});
		renderAt({draft: '경성의 밤', kind: 'scenario', title: '경성 미스터리'});

		await waitFor(() =>
			expect(screen.getByText(/준비 완료/)).toBeInTheDocument()
		);

		expect(importedStoryProps().tags).toContain('scenario');
	});

	it('회고에는 scenario 태그를 달지 않는다', async () => {
		mockApi({twee: TWEE, questions: [], model: 'm'});
		renderAt({draft: '이번 주', kind: 'retro', title: '3주차 회고'});

		await waitFor(() =>
			expect(screen.getByText(/준비 완료/)).toBeInTheDocument()
		);
		expect(importedStoryProps().tags).not.toContain('scenario');
	});

	// 주소로 바로 들어오거나 새로고침하면 라우터 state가 없다 — 초안 목록에서 종류를 찾는다.
	it('라우터 state가 없으면 초안 목록에서 종류를 알아낸다', async () => {
		drafts.mockResolvedValue([
			{id: 'page-1', title: '경성 미스터리', kind: 'scenario'}
		]);
		mockApi({twee: TWEE, questions: [], model: 'm'});
		renderAt();

		await waitFor(() =>
			expect(screen.getByText('창작 시나리오')).toBeInTheDocument()
		);
	});

	it('질문이 오면 답을 받는 단계로 간다', async () => {
		mockApi({questions: ['고르지 않은 길은?'], model: 'm'});
		renderAt({draft: '이번 주', kind: 'retro', title: '3주차 회고'});

		await waitFor(() =>
			expect(screen.getByText('고르지 않은 길은?')).toBeInTheDocument()
		);
	});
});
