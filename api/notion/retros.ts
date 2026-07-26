import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {createRetroPage, listChildPages} from '../_lib/notion';

// GET: 루트 아래 회고 페이지 목록(제목 무엇이든 — "주차" 아니어도 됨; stories DB 제외).
// POST {title}: 새 회고 페이지 생성. 제목은 필수이고 기존 회고와 중복될 수 없다
// (회고들을 제목으로 구분하므로). 본문은 비운 채로 만들고 앱에서 자연어로 채운다.
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

	if (req.method === 'POST') {
		const title = String((req.body?.title ?? '') as string).trim();
		if (!title) {
			res.status(400).json({error: '회고 제목을 입력해 주세요.'});
			return;
		}
		try {
			const existing = await listChildPages(s.token, s.rootId);
			if (
				existing.some(
					(p: {title: string}) =>
						p.title.trim().toLowerCase() === title.toLowerCase()
				)
			) {
				res.status(409).json({
					error: `"${title}" 이름의 회고가 이미 있어요. 다른 제목을 써 주세요.`
				});
				return;
			}
			const retro = await createRetroPage(s.token, s.rootId, title);
			res.status(200).json(retro);
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
		return;
	}

	try {
		res.status(200).json({retros: await listChildPages(s.token, s.rootId)});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
