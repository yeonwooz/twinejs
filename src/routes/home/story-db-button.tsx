// 이 스토리를 노션 어느 DB에 둘지 고른다.
//
// 저장 위치는 기본값이 하나 있고(설정에서 고른다), 스토리는 따로 정하지 않는 한 거기
// 들어간다. 다만 줄마다 다른 곳을 고를 수 있다 — 회고는 회고 DB에, 창작은 창작 DB에
// 두고 싶다는 요구가 실제로 있었다.
//
// 예전에 여러 DB를 걷어낸 적이 있는데, 그때 문제는 여러 DB 자체가 아니라 설정 한 곳에
// "저장할 DB / 읽어올 DB 여럿 / 새로 만들기"가 세 덩어리로 쌓인 화면이었다. 줄마다
// 고르면 "이 스토리가 어디 있나"가 그 줄에 적혀 있으므로 같은 함정이 아니다.
//
// 옮겨도 옛 DB의 행은 지우지 않는다. 되돌릴 수 없는 쪽이 삭제다.
import {IconAlertTriangle, IconDatabase} from '@tabler/icons';
import * as React from 'react';
import {MenuButton} from '../../components/control/menu-button';
import {setStoryDb} from '../../store/persistence/notion-sync';
import {useStoriesDbs} from './use-stories-dbs';
import './story-db-button.css';

export interface StoryDbButtonProps {
	/** 지금 이 스토리가 향하는 DB. 없으면 아직 저장 위치를 모르는 상태다. */
	dbId?: string;
	storyId: string;
}

export const StoryDbButton: React.FC<StoryDbButtonProps> = ({
	dbId,
	storyId
}) => {
	const {dbs, defaultDbId} = useStoriesDbs();
	const [chosen, setChosen] = React.useState(dbId);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();

	// 고를 것이 없으면(미연결, DB 하나뿐) 줄에 버튼을 달지 않는다 — 목록이 버튼밭이 된다.
	if (dbs.length < 2) {
		return null;
	}

	const current = chosen ?? dbId ?? defaultDbId;
	const currentDb = dbs.find(db => db.id === current);

	async function move(next: string) {
		if (next === current) {
			return;
		}

		setBusy(true);
		setError(undefined);

		const result = await setStoryDb(storyId, next);

		setBusy(false);

		if (result.ok) {
			setChosen(next);
			return;
		}

		setError(result.reason ?? '옮기지 못했어요.');
	}

	return (
		<span className="story-db">
			<MenuButton
				disabled={busy}
				icon={error ? <IconAlertTriangle /> : <IconDatabase />}
				items={dbs.map(db => ({
					checkable: true as const,
					checked: db.id === current,
					label: db.id === defaultDbId ? `${db.title} (기본)` : db.title,
					onClick: () => move(db.id)
				}))}
				label={busy ? '옮기는 중…' : (currentDb?.title ?? '저장 위치')}
				variant={error ? 'danger' : undefined}
			/>
			{error && (
				<span className="story-db-error" title={error}>
					{error}
				</span>
			)}
		</span>
	);
};
