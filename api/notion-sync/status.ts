import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {currentDb, hasRoot, NO_ROOT_MESSAGE} from '../_lib/stories-db';

// 클라 notion-sync가 sync 활성 여부를 판단하는 엔드포인트.
//
// enabled = 저장 위치(루트 페이지)를 골랐고 그 아래 DB를 찾았다. 안 골랐으면 꺼진
// 채로 이유를 붙여 알린다 — 켜졌다고 믿고 쓰는 것이 이 앱의 가장 큰 사고였다.
//
// 기본값은 정하지 않는다. 한때 여기서 워크스페이스를 뒤져 "가장 최근 Twine Stories
// DB"를 세션에 박았는데, 팀 워크스페이스에서는 그게 남의 DB였다(api/_lib/stories-db.ts).
//
// chosen: 사용자가 저장 위치를 고른 적이 있나. false면 클라가 한 번 물어본다.
// dev 서버 미들웨어는 이 필드를 주지 않는다(.env가 정하므로 물을 게 없다).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(200).json({connected: false, enabled: false, chosen: false});
		return;
	}

	if (!hasRoot(s)) {
		res.status(200).json({
			connected: true,
			enabled: false,
			chosen: false,
			error: NO_ROOT_MESSAGE
		});
		return;
	}

	try {
		await currentDb(s, res);
		res.status(200).json({connected: true, enabled: true, chosen: true});
	} catch (error) {
		res.status(200).json({
			connected: true,
			enabled: false,
			chosen: true,
			error: (error as Error).message
		});
	}
}
