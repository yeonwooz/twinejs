import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';

// 클라 notion-sync가 sync 활성 여부를 판단하는 엔드포인트.
// 로그인(토큰)했고 루트를 골랐을 때 활성 — stories DB(회고/창작)는 종류별로
// 필요한 시점에 찾거나 만든다(api/_lib/stories-db.ts).
export default function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	res.status(200).json({enabled: !!(s?.token && (s?.dbId || s?.rootId))});
}
