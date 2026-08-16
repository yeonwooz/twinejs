// 노션에 연결은 해뒀는데 저장 위치를 아직 안 고른 사용자에게, 홈에 처음 들어올 때
// 한 번 물어본다. 물어본 사실을 기록해 두므로 두 번 다시 뜨지 않는다 — 나중에
// 바꾸려면 툴바의 "저장 위치" 버튼을 쓴다.
//
// dev 서버는 .env.local이 저장 위치를 정하므로 status에 connected/chosen이 없고,
// 그래서 이 프롬프트도 뜨지 않는다.
import * as React from 'react';
import {NotionStorageDialog, useDialogsContext} from '../../dialogs';

const PROMPTED_KEY = 'twine-notion-storage-prompted';

export function useNotionStoragePrompt() {
	const {dispatch} = useDialogsContext();

	React.useEffect(() => {
		let cancelled = false;

		async function prompt() {
			try {
				if (window.localStorage.getItem(PROMPTED_KEY)) {
					return;
				}

				const response = await fetch('/__notion-sync/status', {
					credentials: 'same-origin'
				});

				if (!response.ok) {
					return;
				}

				const status = await response.json();

				if (cancelled || !status.connected || status.chosen) {
					return;
				}

				window.localStorage.setItem(PROMPTED_KEY, '1');
				dispatch({type: 'addDialog', component: NotionStorageDialog});
			} catch {
				// 상태를 못 물어봐도 앱은 그대로 쓸 수 있어야 한다(로컬 저장은 살아 있다).
			}
		}

		prompt();

		return () => {
			cancelled = true;
		};
	}, [dispatch]);
}
