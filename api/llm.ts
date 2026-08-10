import type {VercelRequest, VercelResponse} from '@vercel/node';
import {
	getSession,
	LLM_KEY_MAX_AGE,
	Session,
	writeSession
} from './_lib/session';
import {resolveLlmKey} from './_lib/llm';
import {
	DEFAULT_MODEL,
	latestOpusId,
	MODELS,
	ModelOption,
	PRICES,
	providerFromKey
} from './_lib/models';

// 키 수명은 비밀이 아니라 사용자에게 알려줄 정보다 — UI가 상수와 어긋나지 않도록
// 모든 응답에 함께 실어 보낸다.
const KEY_TTL_HOURS = Math.round(LLM_KEY_MAX_AGE / 3600);

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
		// 키 수명은 입력 시점부터 고정 — 이후 세션이 갱신돼도 따라 늘어나지 않는다.
		writeSession(res, {
			...s,
			llmKey: key,
			llmProvider: provider,
			llmExp: Math.floor(Date.now() / 1000) + LLM_KEY_MAX_AGE
		});
		res.status(200).json({
			provider,
			models: MODELS[provider],
			defaultModel: DEFAULT_MODEL[provider],
			keyExpiresInHours: KEY_TTL_HOURS
		});
		return;
	}

	// DELETE: 저장된 LLM 키만 지운다(Notion 연결은 유지). 키를 잘못 넣었거나
	// 회수하고 싶을 때 사용 — 세션 전체를 끊으려면 DELETE /api/session.
	if (req.method === 'DELETE') {
		const next: Session = {...s};
		delete next.llmKey;
		delete next.llmProvider;
		delete next.llmExp;
		writeSession(res, next);
		res.status(200).json({
			provider: null,
			models: [],
			defaultModel: null,
			keyExpiresInHours: KEY_TTL_HOURS
		});
		return;
	}

	// GET: 봉인 쿠키에 저장된 키로 프로바이더·모델 목록 반환.
	// Anthropic 기본값은 계정의 최신 Opus를 런타임 발견해 추종.
	try {
		const key = await resolveLlmKey(s);
		if (!key) {
			res.status(200).json({
				provider: null,
				models: [],
				defaultModel: null,
				keyExpiresInHours: KEY_TTL_HOURS
			});
			return;
		}
		let models: ModelOption[] = MODELS[key.provider];
		let defaultModel: string = DEFAULT_MODEL[key.provider];
		if (key.provider === 'anthropic') {
			const latest = await latestOpusId(key.apiKey);
			if (latest) {
				defaultModel = latest;
				if (!models.some(m => m.id === latest)) {
					// 카탈로그보다 새 모델이라 단가표에 없을 수 있다 — 있으면 붙이고 없으면 생략.
					const p = PRICES[latest];
					models = [
						{
							id: latest,
							label: latest,
							hint: p ? `최신 Opus · $${p.input}/$${p.output}` : '최신 Opus'
						},
						...models
					];
				}
			}
		}
		res.status(200).json({
			provider: key.provider,
			models,
			defaultModel,
			keyExpiresInHours: KEY_TTL_HOURS
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
