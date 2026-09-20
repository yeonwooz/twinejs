// 노션에 연결은 해뒀는데 아직 정할 게 남은 사용자에게, 홈 첫 진입에 한 번 설정을 띄운다.
// 물어본 사실을 기록해 두므로 두 번 다시 뜨지 않는다 — 나중에 바꾸려면 ⚙를 쓴다.
//
// 예전(use-notion-storage-prompt)은 저장 위치만 봤다. AI 키는 위저드 안에서만 물어서,
// 홈에서 바로 작문대에 글을 쓴 사람은 [만들기]를 누르고 나서야 키가 없다는 걸 알았다.
// 이제 둘 다 본다.
//
// dev 서버는 .env.local이 저장 위치를 정하고 /api/llm도 없으므로 아무것도 뜨지 않는다.
import * as React from 'react';

const PROMPTED_KEY = 'twine-notion-storage-prompted';

async function getJson(path: string) {
	const response = await fetch(path, {credentials: 'same-origin'});

	return response.ok ? response.json() : undefined;
}

export function useSetupPrompt(openSettings: () => void) {
	React.useEffect(() => {
		let cancelled = false;

		async function prompt() {
			try {
				if (window.localStorage.getItem(PROMPTED_KEY)) {
					return;
				}

				const status = await getJson('/__notion-sync/status');

				// 연결조차 안 했으면 조르지 않는다 — 로컬 저장만으로도 앱은 쓸 수 있고,
				// 헤더의 표시등이 "노션 연결 안 됨"으로 이미 말하고 있다.
				if (cancelled || !status?.connected) {
					return;
				}

				const llm = await getJson('/api/llm');

				if (cancelled) {
					return;
				}

				// 저장 위치를 안 골랐거나, AI 키가 없으면 둘 중 하나는 곧 막힌다.
				if (status.chosen && llm?.provider) {
					return;
				}

				window.localStorage.setItem(PROMPTED_KEY, '1');
				openSettings();
			} catch {
				// 상태를 못 물어봐도 앱은 그대로 쓸 수 있어야 한다.
			}
		}

		prompt();

		return () => {
			cancelled = true;
		};
	}, [openSettings]);
}
