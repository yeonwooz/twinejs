import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {
	createRetroPage,
	ensureScenarioRoot,
	findScenarioRoot,
	listChildPages,
	SCENARIO_FOLDER
} from '../_lib/notion';

// 회고·시나리오 페이지 목록/생성. kind(기본 retro)로 갈린다:
// - retro: 루트 바로 아래 child page들("시나리오" 폴더는 제외; stories DB도 자연히 제외).
// - scenario: 루트 아래 "시나리오" 폴더 페이지의 child page들. 폴더는 첫 생성 때 만든다.
// GET ?kind=: 목록. POST {title, kind}: 새 페이지 생성 — 제목은 필수이고 같은 kind 안에서
// 중복될 수 없다(제목으로 구분하므로). 본문은 비운 채로 만들고 앱에서 자연어로 채운다.
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

	const rawKind =
		req.method === 'POST'
			? (req.body?.kind as string | undefined)
			: Array.isArray(req.query.kind)
			? req.query.kind[0]
			: req.query.kind;
	const kind = rawKind === 'scenario' ? 'scenario' : 'retro';
	const label = kind === 'scenario' ? '시나리오' : '회고';

	if (req.method === 'POST') {
		const title = String((req.body?.title ?? '') as string).trim();
		if (!title) {
			res.status(400).json({error: `${label} 제목을 입력해 주세요.`});
			return;
		}
		try {
			const parentId =
				kind === 'scenario'
					? await ensureScenarioRoot(s.token, s.rootId)
					: s.rootId;
			const existing = await listChildPages(s.token, parentId);
			if (
				existing.some(
					(p: {title: string}) =>
						p.title.trim().toLowerCase() === title.toLowerCase()
				)
			) {
				res.status(409).json({
					error: `"${title}" 이름의 ${label}가 이미 있어요. 다른 제목을 써 주세요.`
				});
				return;
			}
			const page = await createRetroPage(s.token, parentId, title);
			res.status(200).json(page);
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
		return;
	}

	try {
		if (kind === 'scenario') {
			// 폴더가 아직 없으면(시나리오를 만든 적이 없으면) 빈 목록 — 폴더는 첫 POST 때 만든다.
			const folderId = await findScenarioRoot(s.token, s.rootId);
			res.status(200).json({
				retros: folderId ? await listChildPages(s.token, folderId) : []
			});
			return;
		}
		const pages = await listChildPages(s.token, s.rootId);
		res.status(200).json({
			retros: pages.filter(
				(p: {title: string}) => p.title.trim() !== SCENARIO_FOLDER
			)
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
