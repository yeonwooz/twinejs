import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from './_lib/session';
import {resolveLlmKey} from './_lib/llm';
import {
	DEFAULT_MODEL,
	latestOpusId,
	MODELS,
	ModelOption,
	providerFromKey
} from './_lib/models';

// LLM 키 설정(POST {key}) + 현재 키 기준 프로바이더·모델 목록 조회(GET).
// 키는 봉인 세션 쿠키에만 저장하고, 값은 응답에 절대 포함하지 않는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	// POST: 입력한 키를 검증 후 세션 쿠키에 봉인 저장.
	if (req.method === 'POST') {
		const key = String((req.body?.key ?? '') as string).trim();
		if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) {
			res.status(400).json({
				error: 'API 키 형식이 올바르지 않아요. "sk-..." 로 시작해야 해요.'
			});
			return;
		}
		const provider = providerFromKey(key);
		writeSession(res, {...s, llmKey: key, llmProvider: provider});
		res.status(200).json({
			provider,
			models: MODELS[provider],
			defaultModel: DEFAULT_MODEL[provider]
		});
		return;
	}

	// GET: 설정된 키(쿠키 우선, Notion 페이지 폴백)로 프로바이더·모델 목록 반환.
	// Anthropic 기본값은 계정의 최신 Opus를 런타임 발견해 추종.
	try {
		const key = await resolveLlmKey(s);
		if (!key) {
			res.status(200).json({provider: null, models: [], defaultModel: null});
			return;
		}
		let models: ModelOption[] = MODELS[key.provider];
		let defaultModel: string = DEFAULT_MODEL[key.provider];
		if (key.provider === 'anthropic') {
			const latest = await latestOpusId(key.apiKey);
			if (latest) {
				defaultModel = latest;
				if (!models.some(m => m.id === latest)) {
					models = [{id: latest, label: latest, hint: '최신 Opus'}, ...models];
				}
			}
		}
		res.status(200).json({provider: key.provider, models, defaultModel});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
