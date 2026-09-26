// 워크스페이스에 있는 stories DB 목록과, 그중 기본 저장 위치.
//
// 줄마다 "이 스토리를 어디에 둘까"를 고르려면 고를 것들을 알아야 한다. 설정 화면이 쓰는
// 엔드포인트를 그대로 쓴다 — 읽기 경로라 DB를 만들지도 정하지도 않는다(화면을 여는
// 것만으로 노션에 빈 DB가 생기던 적이 있다).
//
// 목록은 홈 한 번당 한 번만 받아 온다. 줄마다 부르면 스토리 수만큼 노션을 뒤진다.
import * as React from 'react';
import {fetchJson} from '../../util/json-fetch';

export interface StoriesDb {
	id: string;
	title: string;
}

interface DbsResult {
	/** 노션에 연결돼 있나. "미연결"과 "DB가 하나도 없음"은 다른 말이다. */
	connected: boolean;
	dbs: StoriesDb[];
	defaultDbId?: string;
	/**
	 * 목록을 못 받아왔나. **"미연결"과 구별해야 한다** — 네트워크가 한 번 끊긴 것을
	 * "노션 연결 안 됨"이라고 말하면, 헤더는 "노션에 저장됨"인데 줄마다는 연결이
	 * 끊겼다고 하는 꼴이 된다. 실제로 그렇게 보였다.
	 */
	failed?: boolean;
}

let cache: DbsResult | undefined;
let inFlight: Promise<DbsResult> | undefined;

/** 다음 조회에서 다시 받아 오게 한다. 저장 위치를 바꾼 뒤 부른다. */
export function forgetStoriesDbs() {
	cache = undefined;
	inFlight = undefined;
}

async function load(): Promise<DbsResult> {
	try {
		const info = await fetchJson('/api/notion-sync/dbs');

		return {
			connected: !!info.connected,
			dbs: info.options ?? [],
			defaultDbId: info.selected?.dbId ?? undefined
		};
	} catch {
		// 목록을 못 받아와도 버튼은 뜬다 — 그 줄에서 설정으로 갈 수 있어야 한다.
		return {connected: false, dbs: [], failed: true};
	}
}

export interface UseStoriesDbsResult extends DbsResult {
	/** 실패한 목록을 다시 받아온다. */
	retry: () => void;
}

export function useStoriesDbs(): UseStoriesDbsResult {
	const [result, setResult] = React.useState<DbsResult>(
		cache ?? {connected: false, dbs: []}
	);
	const [nonce, setNonce] = React.useState(0);

	React.useEffect(() => {
		if (cache) {
			return;
		}

		let cancelled = false;

		inFlight = inFlight ?? load();
		inFlight.then(loaded => {
			// **실패는 캐시하지 않는다.** 한때 캐시했더니 로드 때 네트워크가 한 번
			// 끊긴 것만으로 새로고침 전까지 모든 줄이 "노션 연결 안 됨"에 갇혔다.
			cache = loaded.failed ? undefined : loaded;
			inFlight = undefined;

			if (!cancelled) {
				setResult(loaded);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [nonce]);

	return {
		...result,
		retry: React.useCallback(() => {
			forgetStoriesDbs();
			setNonce(n => n + 1);
		}, [])
	};
}
