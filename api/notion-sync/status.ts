import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';

// 클라 notion-sync가 sync 활성 여부를 판단하는 엔드포인트.
// 로그인(토큰)했고 stories DB가 정해졌을(위저드에서 회고 루트 선택) 때만 활성.
export default function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	res.status(200).json({enabled: !!(s?.token && s?.dbId)});
}
