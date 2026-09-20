// `/api/*`를 부르는 한 가지 방법.
//
// 두 가지를 챙긴다. 첫째, `fetch`는 404·502에도 정상 resolve하므로 상태 코드를 보고
// 서버가 준 `error` 문장을 꺼낸다. 예전에 이걸 안 봐서 실패가 성공과 구별되지 않았다.
//
// 둘째, **응답이 JSON인지 확인한다.** `/api/*`는 Vercel functions라 `npm run dev`(vite만)
// 에서는 존재하지 않는데, vite는 404 대신 index.html을 200으로 돌려준다. `response.ok`만
// 보면 통과하고 `json()`에서 `Unexpected token '<'` 같은 소리가 화면에 뜬다 — 실제로
// 설정 화면에 그게 그대로 찍혔다. 무엇이 문제인지 말해 주는 편이 낫다.
export class ApiUnavailableError extends Error {
	constructor() {
		super(
			'이 기능은 배포 환경에서만 동작해요. 로컬에서는 `vercel dev`로 띄워 주세요.'
		);
		this.name = 'ApiUnavailableError';
	}
}

export interface JsonFetchOptions {
	body?: unknown;
	method?: string;
	signal?: AbortSignal;
}

export async function fetchJson(path: string, options: JsonFetchOptions = {}) {
	const {body, method, signal} = options;
	const response = await fetch(path, {
		credentials: 'same-origin',
		signal,
		...(method || body !== undefined ? {method: method ?? 'POST'} : {}),
		...(body === undefined
			? {}
			: {
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify(body)
				})
	});

	if (!response.ok) {
		let message = `요청 실패 (${response.status})`;

		try {
			const parsed = await response.json();

			if (parsed?.error) {
				message = parsed.error;
			}
		} catch {
			// 본문이 JSON이 아니면 상태 코드만 보여준다.
		}

		throw Object.assign(new Error(message), {status: response.status});
	}

	if (!response.headers.get('content-type')?.includes('json')) {
		throw new ApiUnavailableError();
	}

	return response.json();
}
