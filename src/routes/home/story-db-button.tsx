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
import {SettingsDialog, useDialogsContext} from '../../dialogs';
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
	const {connected, dbs, defaultDbId} = useStoriesDbs();
	const {dispatch} = useDialogsContext();
	const [chosen, setChosen] = React.useState(dbId);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();

	const current = chosen ?? dbId ?? defaultDbId;
	const currentDb = dbs.find(db => db.id === current);
	// 버튼은 언제나 있다. 한때 "DB가 하나뿐이면 숨긴다"로 뒀다가 저장 위치가 어디에도
	// 안 보이게 됐다 -- 줄에 적혀 있다는 게 이 화면의 요지인데 그걸 스스로 없앴고,
	// 두 번째 DB를 만들 길도 사라져 기능 자체를 찾을 수 없었다. 고를 게 없으면
	// 없다고 말하고, 메뉴는 설정으로 가는 문 하나만 연다.
	const label = busy
		? '옮기는 중…'
		: (currentDb?.title ?? (connected ? '저장 위치 없음' : '노션 연결 안 됨'));

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
				items={[
					...dbs.map(db => ({
						checkable: true as const,
						checked: db.id === current,
						label: db.id === defaultDbId ? `${db.title} (기본)` : db.title,
						onClick: () => move(db.id)
					})),
					...(dbs.length ? [{separator: true as const}] : []),
					{
						// 둘 곳이 하나뿐이면 여기가 유일한 출구다. 설정에 DB를 새로 만드는
						// 자리가 이미 있으니 그리로 보낸다.
						label: '저장 위치 추가·변경…',
						onClick: () =>
							dispatch({type: 'addDialog', component: SettingsDialog})
					}
				]}
				label={label}
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
