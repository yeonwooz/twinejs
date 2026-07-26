import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {appendMessage, readBlockText, writeDraftText} from '../_lib/notion';

// 회고 페이지 본문 다루기. GET(?pageId=): 초안 읽기. PUT {pageId,draft}: 앱에서 쓴
// 회고를 본문에 저장(텍스트 블록 교체). POST {pageId,message}: "그때의 나에게" 메시지 append.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	if (req.method === 'POST') {
		const {pageId, message} = (req.body ?? {}) as {
			pageId?: string;
			message?: string;
		};
		if (!pageId || !message?.trim()) {
			res.status(400).json({error: 'pageId·message가 필요합니다.'});
			return;
		}
		try {
			await appendMessage(s.token, pageId, message.trim());
			res.status(200).json({ok: true});
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
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
