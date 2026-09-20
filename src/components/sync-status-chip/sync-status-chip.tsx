// 동기화가 지금 도는지 보여주는 표시등 겸, 설정을 여는 버튼.
//
// 예전에는 이게 "스토리" 툴바 탭 안에 있어서 그 탭을 켠 사람만 볼 수 있었다. 저장이
// 안 되고 있어도(꺼진 동기화, 권한 없어 404, 엉뚱한 DB) 화면이 멀쩡해 보이던 사고가
// 하루에 셋 났고 전부 스크린샷으로 발견됐다. 그래서 홈 헤더에 상시로 올린다.
// 자세한 이유는 여는 화면에서 문장으로 보여준다 — 여긴 긴 문장을 넣을 자리가 없다.
import {IconAlertTriangle, IconDatabase, IconDatabaseOff} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../control/icon-button';
import {useSyncStatus} from '../../store/persistence/notion-sync/use-sync-status';

export interface SyncStatusChipProps {
	onClick: () => void;
}

export const SyncStatusChip: React.FC<SyncStatusChipProps> = ({onClick}) => {
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
		<IconButton icon={icon} label={label} onClick={onClick} variant={variant} />
	);
};
