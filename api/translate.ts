import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from './_lib/session';
import {readAnthropicKey} from './_lib/notion';
import {translate, validateTwee, withCosmicUI} from './_lib/translate';

// 초안 → twee 번역. Anthropic 키는 사용자 Notion 루트 페이지 본문에서 서버측으로만 읽는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token || !s.rootId) {
		res.status(400).json({error: 'Notion 연결/루트 선택이 필요합니다.'});
		return;
	}
	const body = (req.body ?? {}) as {
		weekLabel?: string;
		draft?: string;
		qa?: [string, string][];
		existingTwee?: string;
		feedback?: string;
	};
	if (!body.draft) {
		res.status(400).json({error: 'draft required'});
		return;
	}

	try {
		const apiKey = await readAnthropicKey(s.token, s.rootId);
		if (!apiKey) {
			res.status(400).json({
				error:
					'회고 루트 페이지 본문에 "ANTHROPIC_API_KEY: sk-ant-..." 한 줄을 추가해 주세요.'
			});
			return;
		}

		const common = {
			apiKey,
			draftText: body.draft,
			weekLabel: body.weekLabel ?? '',
			qa: body.qa
		};
		let result = await translate({
			...common,
			existingTwee: body.existingTwee,
			feedback: body.feedback
		});

		// 빈 조건 질문이 있으면 그대로 반환(클라가 물어보고 재요청).
		if (result.questions?.length) {
			res.status(200).json({
				questions: result.questions,
				twee: result.twee,
				draftUpdate: result.draftUpdate
			});
			return;
		}

		// 검증 → 문제 있으면 1회 자동 보정.
		let problems = validateTwee(result.twee);
		if (problems.length) {
			result = await translate({
				...common,
				existingTwee: result.twee,
				feedback: `다음 문제를 고쳐라: ${problems.join('; ')}`
			});
			problems = validateTwee(result.twee);
		}

		res.status(200).json({
			questions: [],
			twee: withCosmicUI(result.twee),
			draftUpdate: result.draftUpdate,
			warnings: problems
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
