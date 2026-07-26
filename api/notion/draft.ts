import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {readBlockText, writeDraftText} from '../_lib/notion';

// 주차 페이지 본문(회고 초안) 읽기(GET)/쓰기(PUT). ?pageId=<주차 페이지 id>
// PUT은 앱에서 자연어로 쓴 회고를 그 주차 페이지 본문에 저장한다(텍스트 블록 교체).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	if (req.method === 'PUT') {
		const {pageId, draft} = (req.body ?? {}) as {
			pageId?: string;
			draft?: string;
		};
		if (!pageId || !draft?.trim()) {
			res.status(400).json({error: 'pageId·draft가 필요합니다.'});
			return;
		}
		try {
			await writeDraftText(s.token, pageId, draft.trim());
			res.status(200).json({ok: true});
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
		return;
	}

	const pageId = String(
		Array.isArray(req.query.pageId) ? req.query.pageId[0] : req.query.pageId ?? ''
	);
	if (!pageId) {
		res.status(400).json({error: 'pageId required'});
		return;
	}
	try {
		const draft = (await readBlockText(s.token, pageId)).trim();
		res.status(200).json({draft});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
