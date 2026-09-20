import {waitFor} from '@testing-library/react';
import {renderHook} from '@testing-library/react-hooks';
import {fakeStory} from '../../../test-util';
import {Story} from '../../stories';
import {shapeOfStory, useRecords} from '../use-records';

const stories: Story[] = [];

jest.mock('../../stories', () => ({
	...jest.requireActual('../../stories'),
	useStoriesContext: () => ({dispatch: jest.fn(), stories})
}));

function taggedStory(name: string, tags: string[][]) {
	const story = fakeStory(tags.length);

	story.name = name;
	story.passages.forEach((passage, index) => {
		passage.tags = tags[index];
	});

	return story;
}

// kind별로 다른 초안 목록을 돌려주는 /api/notion/retros 흉내.
function mockRetros(byKind: Record<string, unknown[]>, ok = true) {
	const fetchMock = jest.fn(async (url: string) => {
		const kind = new URL(url, 'http://x').searchParams.get('kind') ?? 'retro';

		return {
			ok,
			status: ok ? 200 : 401,
			headers: {get: () => 'application/json'},
			json: async () => ({retros: byKind[kind] ?? []})
		};
	});

	(global as any).fetch = fetchMock;
	return fetchMock;
}

describe('shapeOfStory', () => {
	// 모양은 구절 태그에서 나온다. 태그는 프롬프트(scripts/*-prompt.md)가 심는다.
	it('우주 태그를 세어 평행우주 모양을 만든다', () => {
		expect(
			shapeOfStory(
				taggedStory('회고', [['허브'], ['우주'], ['우주'], ['우주'], []])
			)
		).toEqual({type: 'universes', count: 3});
	});

	it('막·결말 태그를 세어 시나리오 모양을 만든다', () => {
		expect(
			shapeOfStory(
				taggedStory('시나리오', [['막'], ['막'], ['결말'], ['결말']])
			)
		).toEqual({type: 'acts', acts: 2, endings: 2});
	});

	// 태그가 생기기 전에 만든 스토리도 목록에 떠야 한다 — 구조를 모를 뿐이다.
	it('태그가 없으면 구절 수로 떨어진다', () => {
		expect(shapeOfStory(taggedStory('옛것', [[], [], []]))).toEqual({
			type: 'passages',
			count: 3
		});
	});
});

describe('useRecords', () => {
	beforeEach(() => {
		stories.length = 0;
	});

	it('스토리가 아직 없는 초안을 목록에 넣는다', async () => {
		mockRetros({
			retro: [{id: 'page-1', title: '3주차 회고', editedAt: '2026-09-01'}]
		});

		const {result} = renderHook(() => useRecords());

		await waitFor(() => expect(result.current.records).toHaveLength(1));
		expect(result.current.records[0]).toMatchObject({
			kind: 'draft',
			pageId: 'page-1',
			title: '3주차 회고',
			draftKind: 'retro'
		});
	});

	// 제목이 곧 열쇠다 — 초안이 스토리가 되면 줄 하나로 합쳐져야지, 둘로 늘면 안 된다.
	it('제목이 같은 초안과 스토리를 한 줄로 합친다', async () => {
		stories.push(taggedStory('3주차 회고', [['우주'], ['우주']]));
		mockRetros({retro: [{id: 'page-1', title: ' 3주차 회고 '}]});

		const {result} = renderHook(() => useRecords());

		await waitFor(() => expect(result.current.hasDrafts).toBe(true));
		expect(result.current.records).toHaveLength(1);
		expect(result.current.records[0]).toMatchObject({
			kind: 'story',
			pageId: 'page-1',
			shape: {type: 'universes', count: 2}
		});
	});

	// 미연결(401)이나 dev 서버(404)에서도 홈은 떠야 한다. 로컬 저장은 살아 있다.
	it('초안을 못 받아와도 로컬 스토리는 보여준다', async () => {
		stories.push(taggedStory('로컬만 있는 것', [[]]));
		mockRetros({}, false);

		const {result} = renderHook(() => useRecords());

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.records).toHaveLength(1);
		expect(result.current.records[0].kind).toBe('story');
	});
});
