import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {StoryDbButton} from '../story-db-button';

const setStoryDb = jest.fn();
const dbs = jest.fn();

jest.mock('../../../store/persistence/notion-sync', () => ({
	setStoryDb: (id: string, dbId: string) => setStoryDb(id, dbId)
}));
const retry = jest.fn();

jest.mock('../use-stories-dbs', () => ({
	useStoriesDbs: () => ({...dbs(), retry})
}));

const addDialog = jest.fn();

jest.mock('../../../dialogs', () => ({
	SettingsDialog: () => null,
	useDialogsContext: () => ({dispatch: addDialog})
}));

const TWO_DBS = {
	connected: true,
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
		addDialog.mockReset();
		retry.mockReset();
		dbs.mockReturnValue(TWO_DBS);
	});

	// 버튼은 언제나 있다. 한때 "DB가 하나뿐이면 숨긴다"로 뒀다가 저장 위치가 어디에도
	// 안 보이게 됐고, 두 번째 DB를 만들 길도 사라져 기능 자체를 찾을 수 없었다.
	it('미연결이어도 버튼은 있고, 연결이 안 됐다고 말한다', () => {
		dbs.mockReturnValue({connected: false, dbs: []});

		render(<StoryDbButton storyId="story-1" />);
		expect(screen.getByText('노션 연결 안 됨')).toBeInTheDocument();
	});

	// 네트워크가 한 번 끊긴 것을 "연결 안 됨"이라고 하면, 헤더는 "노션에 저장됨"인데
	// 줄마다는 끊겼다고 하는 꼴이 된다. 실제로 그렇게 보였다.
	it('목록을 못 불러온 것은 미연결과 다르게 말한다', () => {
		dbs.mockReturnValue({connected: false, dbs: [], failed: true});

		render(<StoryDbButton storyId="story-1" />);
		expect(screen.getByText('저장 위치 확인 안 됨')).toBeInTheDocument();
	});

	it('못 불러왔으면 다시 불러올 길을 준다', async () => {
		dbs.mockReturnValue({connected: false, dbs: [], failed: true});

		render(<StoryDbButton storyId="story-1" />);
		await userEvent.click(screen.getByText('저장 위치 확인 안 됨'));
		await userEvent.click(screen.getByText('다시 불러오기'));

		expect(retry).toHaveBeenCalled();
	});

	it('연결은 됐는데 DB가 없으면 없다고 말한다', () => {
		dbs.mockReturnValue({connected: true, dbs: []});

		render(<StoryDbButton storyId="story-1" />);
		expect(screen.getByText('저장 위치 없음')).toBeInTheDocument();
	});

	it('DB가 하나뿐이어도 지금 어디 있는지는 보여준다', () => {
		dbs.mockReturnValue({
			connected: true,
			dbs: [{id: 'db-a', title: '회고 스토리'}],
			defaultDbId: 'db-a'
		});

		render(<StoryDbButton storyId="story-1" />);
		expect(screen.getByText('회고 스토리')).toBeInTheDocument();
	});

	it('고를 게 없어도 설정으로는 갈 수 있다', async () => {
		dbs.mockReturnValue({connected: false, dbs: []});

		render(<StoryDbButton storyId="story-1" />);
		await userEvent.click(screen.getByText('노션 연결 안 됨'));
		await userEvent.click(screen.getByText('저장 위치 추가·변경…'));

		expect(addDialog).toHaveBeenCalled();
	});

	// 둘 곳이 하나뿐일 때 두 번째를 만들 유일한 출구다.
	it('설정으로 나가는 길을 메뉴에 둔다', async () => {
		render(<StoryDbButton dbId="db-retro" storyId="story-1" />);
		await userEvent.click(screen.getByText('회고 스토리'));
		await userEvent.click(screen.getByText('저장 위치 추가·변경…'));

		expect(addDialog).toHaveBeenCalledWith(
			expect.objectContaining({type: 'addDialog'})
		);
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
