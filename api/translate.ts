import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from './_lib/session';
import {resolveLlmKey} from './_lib/llm';
import {addUsage, costUsd, resolveModel} from './_lib/models';
import {
	repairStartPassage,
	translate,
	validateTwee,
	withCosmicUI
} from './_lib/translate';

// 초안 → twee 번역. LLM 키는 봉인 세션 쿠키(사용자 입력) 우선, 없으면 Notion 루트
// 페이지 본문에서 서버측으로만 읽는다. 모델은 클라가 골라 보낸다(비밀 아님).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(400).json({error: 'Notion 연결이 필요합니다.'});
		return;
	}
	const body = (req.body ?? {}) as {
		weekLabel?: string;
		draft?: string;
		qa?: [string, string][];
		existingTwee?: string;
		feedback?: string;
		model?: string;
	};
	if (!body.draft) {
		res.status(400).json({error: 'draft required'});
		return;
	}

	try {
		const key = await resolveLlmKey(s);
		if (!key) {
			res.status(400).json({
				error: 'AI 모델 API 키가 없어요. 앱에서 키를 먼저 입력해 주세요.'
			});
			return;
		}

		const model = resolveModel(key.provider, body.model);
		const common = {
			apiKey: key.apiKey,
			provider: key.provider,
			model,
			draftText: body.draft,
			weekLabel: body.weekLabel ?? '',
			qa: body.qa
		};
		let result = await translate({
			...common,
			existingTwee: body.existingTwee,
			feedback: body.feedback
		});

		// 이 요청이 쓴 토큰. 아래 자동 보정으로 한 번 더 호출될 수 있어 합산해서 내보낸다.
		// model도 함께 내보내는데, resolveModel이 클라가 고른 값을 되돌릴 수 있고
		// Anthropic 기본값은 런타임에 발견한 최신 Opus일 수 있어서다.
		let usage = result.usage;
		const meta = () => ({model, usage, costUsd: costUsd(model, usage)});

		// 빈 조건 질문이 있으면 그대로 반환(클라가 물어보고 재요청).
		if (result.questions?.length) {
			res.status(200).json({
				questions: result.questions,
				twee: result.twee,
				draftUpdate: result.draftUpdate,
				...meta()
			});
			return;
		}

		// 검증 → 문제 있으면 자동 보정. 흔한 실패(StoryData.start)는 코드로 먼저 고쳐
		// LLM 재호출을 아끼고, 남은 문제(끊긴 링크 등)가 있을 때만 1회 LLM 재보정.
		let problems = validateTwee(result.twee);
		if (problems.length) {
			const repaired = repairStartPassage(result.twee);
			if (repaired !== result.twee) {
				result = {...result, twee: repaired};
				problems = validateTwee(result.twee);
			}
			if (problems.length) {
				result = await translate({
					...common,
					existingTwee: result.twee,
					feedback: `다음 문제를 고쳐라: ${problems.join('; ')}`
				});
				usage = addUsage(usage, result.usage);
				problems = validateTwee(result.twee);
			}
		}

		res.status(200).json({
			questions: [],
			twee: withCosmicUI(result.twee),
			draftUpdate: result.draftUpdate,
			warnings: problems,
			...meta()
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
