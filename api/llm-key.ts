import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from './_lib/session';
import {DEFAULT_MODEL, MODELS, providerFromKey} from './_lib/models';

// 사용자가 앱에서 입력한 LLM API 키를 봉인 세션 쿠키에 저장한다(Notion 토큰과 동일 방식).
// 키 값은 응답으로 절대 돌려주지 않고, 프로바이더/모델 목록만 알려준다.
export default function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	if (req.method !== 'POST') {
		res.status(405).json({error: 'POST only'});
		return;
	}
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
}
