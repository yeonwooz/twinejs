import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from './_lib/session';

// 클라가 로그인/설정 상태를 확인하는 용도. 토큰 값은 절대 반환하지 않는다.
export default function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	res.status(200).json({
		connected: !!s?.token,
		configured: !!(s?.token && s?.dbId),
		workspaceName: s?.workspaceName ?? null
	});
}
