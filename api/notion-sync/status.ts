import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';

// 클라 notion-sync가 sync 활성 여부를 판단하는 엔드포인트.
// 로그인(토큰)했고 루트를 골랐을 때 활성 — stories DB는 필요한 시점에 찾거나
// 만든다(api/_lib/stories-db.ts).
//
// chosen: 저장 위치를 이미 고른 적이 있나. false면 클라가 첫 진입에 고르라고
// 띄운다. dev 서버 미들웨어는 이 필드를 주지 않는다(.env가 정하므로 물을 게 없다).
export default function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	res.status(200).json({
		connected: !!s?.token,
		enabled: !!(s?.token && (s?.dbId || s?.rootId)),
		chosen: !!s?.dbId
	});
}
