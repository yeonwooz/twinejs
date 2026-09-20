import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {StoryDbButton} from '../story-db-button';

const setStoryDb = jest.fn();
const dbs = jest.fn();

jest.mock('../../../store/persistence/notion-sync', () => ({
	setStoryDb: (id: string, dbId: string) => setStoryDb(id, dbId)
}));
jest.mock('../use-stories-dbs', () => ({useStoriesDbs: () => dbs()}));

const TWO_DBS = {
	dbs: [
		{id: 'db-retro', title: '회고 스토리'},
		{id: 'db-fiction', title: '창작 스토리'}
	],
	defaultDbId: 'db-retro'
};

describe('<StoryDbButton>', () => {
	beforeEach(() => {
		setStoryDb.mockReset();
		setStoryDb.mockResolvedValue({ok: true});
		dbs.mockReturnValue(TWO_DBS);
	});

	// 고를 것이 없으면(미연결, DB 하나뿐) 줄에 버튼을 달지 않는다 — 목록이 버튼밭이 된다.
	it.each([
		['미연결', {dbs: []}],
		['DB 하나뿐', {dbs: [{id: 'db-a', title: 'A'}], defaultDbId: 'db-a'}]
	])('%s이면 아무것도 안 보여준다', (_label, value) => {
		dbs.mockReturnValue(value);

		const {container} = render(<StoryDbButton storyId="story-1" />);

		expect(container).toBeEmptyDOMElement();
	});

	it('지금 어느 DB에 있는지를 버튼에 적는다', () => {
		render(<StoryDbButton dbId="db-fiction" storyId="story-1" />);
		expect(screen.getByText('창작 스토리')).toBeInTheDocument();
	});

	it('따로 고른 적이 없으면 기본 저장 위치를 보여준다', () => {
		render(<StoryDbButton storyId="story-1" />);
		expect(screen.getByText('회고 스토리')).toBeInTheDocument();
	});

	it('다른 DB를 고르면 그리로 옮기고 표시를 바꾼다', async () => {
		render(<StoryDbButton dbId="db-retro" storyId="story-1" />);
		await userEvent.click(screen.getByText('회고 스토리'));
		await userEvent.click(screen.getByText('창작 스토리'));

		expect(setStoryDb).toHaveBeenCalledWith('story-1', 'db-fiction');
		expect(await screen.findByText('창작 스토리')).toBeInTheDocument();
	});

	// 실패가 조용히 지나가는 것이 이 앱이 반복해 온 사고다 — 이유를 줄 안에 남긴다.
	it('옮기지 못하면 이유를 그 자리에 남기고 표시를 바꾸지 않는다', async () => {
		setStoryDb.mockResolvedValue({ok: false, reason: '권한이 없어요 (404)'});
		render(<StoryDbButton dbId="db-retro" storyId="story-1" />);
		await userEvent.click(screen.getByText('회고 스토리'));
		await userEvent.click(screen.getByText('창작 스토리'));

		expect(await screen.findByText('권한이 없어요 (404)')).toBeInTheDocument();
		expect(screen.getByText('회고 스토리')).toBeInTheDocument();
	});
});
