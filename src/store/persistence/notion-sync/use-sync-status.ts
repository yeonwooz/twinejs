// 동기화 상태를 화면에서 쓰기 위한 훅. 상태는 모듈이 들고 있고(스토리를 저장할 때마다
// 갱신된다) 여기서는 구독만 한다.
import * as React from 'react';
import {SyncStatus, onSyncStatusChange, syncStatus} from '.';

export function useSyncStatus(): SyncStatus {
	const [status, setStatus] = React.useState<SyncStatus>(syncStatus);

	React.useEffect(() => {
		// 구독을 걸기 전에 바뀐 상태가 있을 수 있다(첫 status 조회가 먼저 끝난 경우).
		setStatus(syncStatus());

		const unsubscribe = onSyncStatusChange(setStatus);

		return () => {
			unsubscribe();
		};
	}, []);

	return status;
}
