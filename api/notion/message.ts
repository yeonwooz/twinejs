import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {appendMessage} from '../_lib/notion';

// "그때의 나에게" 메시지를 주차 Notion 페이지에 저장(append).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
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
}
