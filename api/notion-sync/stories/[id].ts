import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {archiveStory, upsertStory} from '../../_lib/notion';
import {allDbs, homeDb} from '../../_lib/stories-db';

// PUT   /__notion-sync/stories/:id  {ifid,name,twee} → upsert (Story ID로 매칭)
// DELETE /__notion-sync/stories/:id                  → archive
//
// 저장은 지금 고른 루트의 DB에. 삭제는 어느 루트에서 만든 스토리인지 알 수 없으므로
// (이미 로컬에서 사라진 뒤다) 이 세션이 아는 DB를 모두 뒤진다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token || !(s.dbId || s.rootId)) {
		res.status(503).json({error: 'Notion sync가 설정되지 않았습니다.'});
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
			await upsertStory(s.token, await homeDb(s, storyId, res), storyId, {
				ifid: body.ifid,
				name: body.name,
				twee: body.twee
			});
			res.status(200).json({ok: true});
		} else if (req.method === 'DELETE') {
			for (const dbId of await allDbs(s, res)) {
				await archiveStory(s.token, dbId, storyId);
			}
			res.status(200).json({ok: true});
		} else {
			res.status(405).json({error: 'method not allowed'});
		}
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
