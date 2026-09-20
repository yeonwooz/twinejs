// "이 스토리를 지금 저장 위치로 옮기기".
//
// 저장 위치를 바꿔도 예전 것은 따라오지 않는다 — 이후 저장분만 새 위치로 간다. 그래서
// 예전에는 스토리를 하나씩 편집기에서 건드려(태그를 달았다 떼는 식으로) 다시 밀어 넣어야
// 했다. 15개면 15번이다. 옮겨야 하는 줄에만 버튼을 띄운다.
//
// 옛 DB의 행은 지우지 않는다. 저장 위치를 바꿔도 예전 것은 남긴다는 원칙과 같다.
import {IconAlertTriangle, IconCheck, IconDatabaseImport} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import {
	moveStoryHere,
	StoryLocation
} from '../../store/persistence/notion-sync';
import './move-story-button.css';

export interface MoveStoryButtonProps {
	location: StoryLocation;
	/** 옮기고 나면 줄의 "다른 곳에 저장됨" 표시도 같이 내려야 한다. */
	onMoved: () => void;
	storyId: string;
}

export const MoveStoryButton: React.FC<MoveStoryButtonProps> = ({
	location,
	onMoved,
	storyId
}) => {
	const [state, setState] = React.useState<'idle' | 'busy' | 'done'>('idle');
	const [error, setError] = React.useState<string>();

	// 이미 여기 있거나, 저장 위치를 아직 모르면 보여줄 게 없다.
	if (location === 'here' || location === 'unknown') {
		return null;
	}

	if (state === 'done') {
		return (
			<span className="move-story done">
				<IconCheck /> 옮김
			</span>
		);
	}

	async function move() {
		setState('busy');
		setError(undefined);

		const result = await moveStoryHere(storyId);

		if (result.ok) {
			setState('done');
			onMoved();
			return;
		}

		setState('idle');
		setError(result.reason ?? '옮기지 못했어요.');
	}

	return (
		<span className="move-story">
			<IconButton
				disabled={state === 'busy'}
				icon={error ? <IconAlertTriangle /> : <IconDatabaseImport />}
				label={
					state === 'busy'
						? '옮기는 중…'
						: location === 'none'
							? '노션에 저장'
							: '여기로 옮기기'
				}
				onClick={move}
				variant={error ? 'danger' : 'primary'}
			/>
			{error && <span className="move-story-error">{error}</span>}
		</span>
	);
};
