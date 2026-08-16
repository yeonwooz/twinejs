import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {databaseTitle, ensureStoriesDb, searchPages} from '../_lib/notion';
import {allDbs} from '../_lib/stories-db';

// 저장 위치 고르기 화면(src/dialogs/notion-storage)이 쓰는 엔드포인트.
//
// GET  → 지금 저장/읽는 DB, 고를 수 있는 DB 목록, 새로 붙일 수 있는 루트 페이지 목록.
// POST → {write, read[]} 로 선택 저장, 또는 {addRootId} 로 그 루트의 DB를 새로 붙인다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	try {
		if (req.method === 'POST') {
			const {addRootId, write, read} = (req.body ?? {}) as {
				addRootId?: string;
				write?: string;
				read?: string[];
			};

			if (addRootId) {
				const dbId = await ensureStoriesDb(s.token, addRootId);

				writeSession(res, {
					...s,
					rootId: addRootId,
					dbId,
					dbIds: [...new Set([dbId, ...(s.dbIds ?? [])])]
				});
				res.status(200).json({ok: true, dbId});
				return;
			}

			if (!write) {
				res.status(400).json({error: '저장할 DB를 골라 주세요.'});
				return;
			}

			// 저장할 DB는 읽는 목록에도 반드시 들어간다 — 방금 올린 스토리가 다음
			// 로드에서 안 보이면 "원격에서 지워졌다"로 오해될 수 있다.
			writeSession(res, {
				...s,
				dbId: write,
				dbIds: [...new Set([write, ...(read ?? [])])]
			});
			res.status(200).json({ok: true});
			return;
		}

		const known = await allDbs(s, res);
		const options = await Promise.all(
			known.map(async id => ({id, title: await databaseTitle(s.token, id)}))
		);

		res.status(200).json({
			options,
			pages: await searchPages(s.token),
			selected: {write: s.dbId ?? null, read: known}
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
