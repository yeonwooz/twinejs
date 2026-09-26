// `/api/*`를 부르는 한 가지 방법.
//
// 두 가지를 챙긴다. 첫째, `fetch`는 404·502에도 정상 resolve하므로 상태 코드를 보고
// 서버가 준 `error` 문장을 꺼낸다. 예전에 이걸 안 봐서 실패가 성공과 구별되지 않았다.
//
// 둘째, **응답이 JSON인지 확인한다.** `/api/*`는 Vercel functions라 `npm run dev`(vite만)
// 에서는 존재하지 않는데, vite는 404 대신 index.html을 200으로 돌려준다. `response.ok`만
// 보면 통과하고 `json()`에서 `Unexpected token '<'` 같은 소리가 화면에 뜬다 — 실제로
// 설정 화면에 그게 그대로 찍혔다. 무엇이 문제인지 말해 주는 편이 낫다.
/**
 * 노션·네트워크 오류를 사람이 읽을 문장으로 바꾼다.
 *
 * 원문을 그대로 내보내면 화면에 `fetch failed`(node undici)나 노션 API의 JSON 덩어리가
 * 찍힌다. 둘 다 실제로 사용자 화면에 나왔고, 뒤엣것은 목록 한 줄을 통째로 무너뜨렸다.
 * 상태는 보이라고 들고 있는 것이지 읽을 수 없는 걸 보여주라고 있는 게 아니다.
 */
export function humanizeError(message: string) {
	// 서버(노션으로 나가는 fetch)와 브라우저(우리 서버로 나가는 fetch) 양쪽의 표현.
	if (
		/^fetch failed$|Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(
			message
		)
	) {
		return '노션에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';
	}

	if (/object_not_found|Could not find database/i.test(message)) {
		return '그 DB를 찾을 수 없어요. 노션에서 통합에 공유돼 있는지 확인해 주세요.';
	}

	if (/unauthorized|restricted_resource/i.test(message)) {
		return '그 DB에 쓸 권한이 없어요. 노션에서 통합에 공유해 주세요.';
	}

	// 알 수 없는 오류는 그대로 보여주되 한 줄 길이로 자른다 -- 통째로 숨기면 무슨 일이
	// 일어났는지 알 길이 없어진다.
	return message.length > 160 ? `${message.slice(0, 160)}…` : message;
}

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
				message = humanizeError(String(parsed.error));
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
