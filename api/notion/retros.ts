import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {
	createRetroPage,
	DRAFT_FOLDERS,
	ensureDraftFolder,
	findDraftFolder,
	listChildPages,
	SCENARIO_FOLDER,
	STORY_FOLDER
} from '../_lib/notion';

// 초안 페이지 목록/생성. kind(기본 retro)로 갈린다:
// - retro: 루트 바로 아래 child page들(초안 폴더들은 제외; stories DB도 자연히 제외).
// - scenario: 루트 아래 "시나리오" 폴더 안. 폴더는 첫 생성 때 만든다.
// - story: 루트 아래 "스토리" 폴더 안. 일반 스토리의 구상도 노션에 남긴다.
// GET ?kind=: 목록. POST {title, kind}: 새 페이지 생성 — 제목은 필수이고 같은 kind 안에서
// 중복될 수 없다(제목으로 구분하므로). 본문은 비운 채로 만들고 앱에서 자연어로 채운다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	if (!s.rootId) {
		// 저장 위치 화면에서 "초안을 담아 둘 페이지"를 고르면 잡힌다. 예전에는 위저드의
		// 루트 선택 단계에서만 잡혀서, 새 환경에서 저장 위치부터 고른 사람은 여기서
		// 막혔다.
		res.status(400).json({
			error:
				'초안을 담아 둘 노션 페이지가 아직 정해지지 않았습니다. "저장 위치"에서 골라 주세요.'
		});
		return;
	}

	const rawKind =
		req.method === 'POST'
			? (req.body?.kind as string | undefined)
			: Array.isArray(req.query.kind)
				? req.query.kind[0]
				: req.query.kind;
	const kind =
		rawKind === 'scenario' || rawKind === 'story' ? rawKind : 'retro';
	const folder = kind === 'scenario' ? SCENARIO_FOLDER : STORY_FOLDER;
	const label = kind === 'retro' ? '회고' : folder;

	if (req.method === 'POST') {
		const title = String((req.body?.title ?? '') as string).trim();
		if (!title) {
			res.status(400).json({error: `${label} 제목을 입력해 주세요.`});
			return;
		}
		try {
			const parentId =
				kind === 'retro'
					? s.rootId
					: await ensureDraftFolder(s.token, s.rootId, folder);
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
		if (kind !== 'retro') {
			// 폴더가 아직 없으면 빈 목록 — 폴더는 첫 POST 때 만든다.
			const folderId = await findDraftFolder(s.token, s.rootId, folder);
			res.status(200).json({
				retros: folderId ? await listChildPages(s.token, folderId) : []
			});
			return;
		}
		const pages = await listChildPages(s.token, s.rootId);
		res.status(200).json({
			retros: pages.filter(
				(p: {title: string}) => !DRAFT_FOLDERS.includes(p.title.trim())
			)
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
