import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {listChildPages} from '../_lib/notion';

// 선택한 회고 루트 아래의 회고 페이지 목록(제목 무엇이든 — "주차"가 아니어도 됨).
// 이어서 작업할 기존 회고를 고를 때 쓴다. child_database(stories DB)는 제외된다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	if (!s.rootId) {
		res.status(400).json({error: 'root not selected'});
		return;
	}
	try {
		res.status(200).json({retros: await listChildPages(s.token, s.rootId)});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
