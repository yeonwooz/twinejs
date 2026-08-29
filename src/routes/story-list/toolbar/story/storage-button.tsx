import {IconAlertTriangle, IconDatabase, IconDatabaseOff} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../../../components/control/icon-button';
import {NotionStorageDialog, useDialogsContext} from '../../../../dialogs';
import {useSyncStatus} from '../../../../store/persistence/notion-sync/use-sync-status';

// 스토리를 노션 어디에 저장할지 다시 고르는 버튼 겸, 동기화가 지금 도는지 보여주는
// 표시. 예전에는 상태가 콘솔에만 있어서 저장이 안 되고 있어도 아무도 몰랐다 --
// 저장 위치가 안 정해져 꺼진 것, 권한이 없어 404로 실패한 것, 스토리가 엉뚱한 DB로
// 들어간 것이 다 조용히 지나갔다. 고치러 가는 화면이 곧 이 버튼이라 상태를 여기 붙이고,
// 자세한 이유는 그 화면에서 보여준다(툴바에 긴 문장을 넣을 자리가 없다).
export const StorageButton: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const status = useSyncStatus();

	const {icon, label, variant} = React.useMemo<{
		icon: React.ReactNode;
		label: string;
		variant?: 'danger';
	}>(() => {
		if (status.failing) {
			return {
				icon: <IconAlertTriangle />,
				label: '저장 실패',
				variant: 'danger'
			};
		}

		if (!status.connected) {
			return {icon: <IconDatabaseOff />, label: '노션 연결 안 됨'};
		}

		if (!status.enabled) {
			return {icon: <IconDatabaseOff />, label: '저장 안 됨'};
		}

		return {icon: <IconDatabase />, label: '노션에 저장됨'};
	}, [status.connected, status.enabled, status.failing]);

	return (
		<IconButton
			icon={icon}
			label={label}
			onClick={() =>
				dispatch({type: 'addDialog', component: NotionStorageDialog})
			}
			variant={variant}
		/>
	);
};
