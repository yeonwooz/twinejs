import type {VercelRequest, VercelResponse} from '@vercel/node';
import {clearSession, getSession} from './_lib/session';

const LOGGED_OUT = {connected: false, configured: false, workspaceName: null};

// GET: 클라가 로그인/설정 상태를 확인하는 용도. 토큰 값은 절대 반환하지 않는다.
// DELETE: 로그아웃 — 봉인 쿠키를 지운다. 쿠키에 Notion 토큰과 LLM API 키가 함께
//   들어 있으므로 이 한 번으로 둘 다 브라우저에서 사라진다.
//   (키만 지우고 Notion 연결은 유지하려면 DELETE /api/llm)
export default function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method === 'DELETE') {
		clearSession(res);
		res.status(200).json(LOGGED_OUT);
		return;
	}

	const s = getSession(req);
	res.status(200).json({
		connected: !!s?.token,
		// 저장 위치(루트 페이지)를 골랐나. 옛 세션의 dbId만으로는 설정된 것으로 보지
		// 않는다 — 위저드가 루트 단계로 보내 다시 고르게 한다.
		configured: !!(s?.token && s?.rootId),
		workspaceName: s?.workspaceName ?? null
	});
}
