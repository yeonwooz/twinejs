import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {MoveStoryButton} from '../move-story-button';
import {StoryLocation} from '../../../store/persistence/notion-sync';

const moveStoryHere = jest.fn();
const onMoved = jest.fn();

jest.mock('../../../store/persistence/notion-sync', () => ({
	moveStoryHere: (id: string) => moveStoryHere(id)
}));

function renderAt(location: StoryLocation) {
	return render(
		<MoveStoryButton location={location} onMoved={onMoved} storyId="story-1" />
	);
}

describe('<MoveStoryButton>', () => {
	beforeEach(() => {
		moveStoryHere.mockReset();
		onMoved.mockReset();
		moveStoryHere.mockResolvedValue({ok: true});
	});

	// 이미 제자리인 줄에까지 버튼을 달면 목록이 버튼밭이 된다.
	it.each<StoryLocation>(['here', 'unknown'])(
		'%s 상태면 아무것도 안 보여준다',
		location => {
			const {container} = renderAt(location);

			expect(container).toBeEmptyDOMElement();
		}
	);

	it('다른 곳에 있으면 여기로 옮기자고 한다', () => {
		renderAt('elsewhere');
		expect(screen.getByText('여기로 옮기기')).toBeInTheDocument();
	});

	// 한 번도 안 올라간 스토리는 "옮기기"가 아니라 "저장"이다.
	it('노션에 없으면 저장하자고 한다', () => {
		renderAt('none');
		expect(screen.getByText('노션에 저장')).toBeInTheDocument();
	});

	it('누르면 옮기고 결과를 보여준다', async () => {
		renderAt('elsewhere');
		await userEvent.click(screen.getByText('여기로 옮기기'));

		expect(moveStoryHere).toHaveBeenCalledWith('story-1');
		expect(await screen.findByText('옮김')).toBeInTheDocument();
		// 줄의 "다른 곳에 저장됨"도 같이 내려가야 한다 -- 안 그러면 서로 어긋난 말을 한다.
		expect(onMoved).toHaveBeenCalled();
	});

	// 실패가 조용히 지나가는 것이 이 앱이 반복해 온 사고다 — 이유를 줄 안에 남긴다.
	it('실패하면 이유를 그 자리에 남기고 다시 누를 수 있게 둔다', async () => {
		moveStoryHere.mockResolvedValue({
			ok: false,
			reason: '노션 저장 실패 (404)'
		});
		renderAt('elsewhere');
		await userEvent.click(screen.getByText('여기로 옮기기'));

		expect(await screen.findByText('노션 저장 실패 (404)')).toBeInTheDocument();
		expect(screen.getByText('여기로 옮기기')).toBeInTheDocument();
		expect(onMoved).not.toHaveBeenCalled();
	});
});
