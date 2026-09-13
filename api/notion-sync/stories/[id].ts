import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {archiveStory, upsertStory} from '../../_lib/notion';
import {currentDb, hasRoot, NO_ROOT_MESSAGE} from '../../_lib/stories-db';

// PUT   /__notion-sync/stories/:id  {ifid,name,twee} → upsert (Story ID로 매칭)
// DELETE /__notion-sync/stories/:id                  → archive
//
// 저장도 삭제도 고른 루트 페이지 아래 DB 하나만 본다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(503).json({error: 'Notion sync가 설정되지 않았습니다.'});
		return;
	}
	if (!hasRoot(s)) {
		res.status(503).json({error: NO_ROOT_MESSAGE});
		return;
	}
	const storyId = String(
		Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
	);

	try {
		if (req.method === 'PUT') {
			const body = (req.body ?? {}) as {
				ifid?: string;
				name?: string;
				twee?: string;
			};
			if (typeof body.twee !== 'string') {
				res.status(400).json({error: 'twee 누락'});
				return;
			}
			await upsertStory(s.token, await currentDb(s, res), storyId, {
				ifid: body.ifid,
				name: body.name,
				twee: body.twee
			});
			res.status(200).json({ok: true});
		} else if (req.method === 'DELETE') {
			await archiveStory(s.token, await currentDb(s, res), storyId);
			res.status(200).json({ok: true});
		} else {
			res.status(405).json({error: 'method not allowed'});
		}
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
