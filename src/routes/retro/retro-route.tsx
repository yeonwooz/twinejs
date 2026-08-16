import * as React from 'react';
import {useHistory, useLocation} from 'react-router-dom';
import {importStories, useStoriesContext} from '../../store/stories';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {storyFromTwee} from '../../util/twee';
import {SCENARIO_TAG} from '../../store/persistence/notion-sync';
import {setRetroLinkForStory} from '../../util/retro-link';
import './retro-route.css';

type Step =
	| 'loading'
	| 'connect'
	| 'root'
	| 'apikey'
	| 'select'
	| 'compose'
	| 'questions'
	| 'translating'
	| 'done'
	| 'error';

// 위저드 종류. 연결/루트/AI 키 단계와 파이프라인은 같고, 문구·프롬프트(서버가 mode로
// 고름)·노션 보관 위치(kind)·회고 전용 메시지 저장만 갈린다.
export type WizardMode = 'retro' | 'scenario';

const COPY = {
	retro: {
		heading: '인터랙티브 회고',
		spendLabel: '이번 회고',
		spendVerb: '번역',
		connectIntro: 'Notion을 연결하면 회고를 인터랙티브 스토리로 만들 수 있어요.',
		rootIntro: '회고를 담아 둘 루트 페이지를 골라주세요.',
		selectIntro: '회고 제목을 입력해 새로 시작하세요. (필수 · 이름은 겹칠 수 없어요)',
		titlePlaceholder: '예: 3주차 회고 / 첫 배포 회고 / 2026 상반기',
		emptyTitleError: '회고 제목을 입력해 주세요.',
		dupTitleError: (title: string) =>
			`"${title}" 이름의 회고가 이미 있어요. 다른 제목을 써 주세요.`,
		newButton: '새 회고 시작',
		existingLabel: '이어서 작업할 기존 회고',
		composeIntro: '회고를 자연어로 자유롭게 써 주세요.',
		composePlaceholder:
			'이번 기간 동안 어떤 결정을 했고, 무엇이 후회되고, 무엇이 좋았는지 편하게 적어 주세요. 저장하면 Notion 그 회고 페이지에도 남아요.',
		composeButton: '인터랙티브 회고로 만들기',
		backToList: '← 회고 목록',
		translating: '평행우주 회고로 번역하는 중…',
		questionsIntro: '회고에 비어 있는 부분이 있어요. 채워 주세요:',
		questionsButton: '이어서 번역',
		refinePlaceholder: '예: 우주 β의 결과를 더 극적으로',
		backToOthers: '← 다른 회고'
	},
	scenario: {
		heading: '창작 시나리오',
		spendLabel: '이번 시나리오',
		spendVerb: '생성',
		connectIntro:
			'Notion을 연결하면 이야기 구상을 선택 분기가 있는 인터랙티브 시나리오로 만들 수 있어요.',
		rootIntro: '시나리오를 담아 둘 루트 페이지를 골라주세요.',
		selectIntro:
			'시나리오 제목을 입력해 새로 시작하세요. (필수 · 이름은 겹칠 수 없어요)',
		titlePlaceholder: '예: 경성 미스터리 / 우주 정거장의 하루 / 마지막 출근',
		emptyTitleError: '시나리오 제목을 입력해 주세요.',
		dupTitleError: (title: string) =>
			`"${title}" 이름의 시나리오가 이미 있어요. 다른 제목을 써 주세요.`,
		newButton: '새 시나리오 시작',
		existingLabel: '이어서 작업할 기존 시나리오',
		composeIntro: '만들고 싶은 이야기를 자유롭게 설명해 주세요.',
		composePlaceholder:
			'장르, 주인공, 배경, 갈등, 원하는 결말의 분위기… 떠오르는 대로 적어 주세요. 얇으면 AI가 먼저 물어보고, 저장하면 Notion 그 시나리오 페이지에도 남아요.',
		composeButton: '인터랙티브 시나리오로 만들기',
		backToList: '← 시나리오 목록',
		translating: '갈림길 있는 이야기로 빚는 중…',
		questionsIntro: '이야기의 뼈대를 세우는 데 더 필요한 게 있어요. 채워 주세요:',
		questionsButton: '이어서 만들기',
		refinePlaceholder: '예: 결말을 하나 더 / 중반 선택을 더 어렵게',
		backToOthers: '← 다른 시나리오'
	}
} as const;

interface NamedPage {
	id: string;
	title: string;
}

interface ModelOption {
	id: string;
	label: string;
	hint: string;
}

// /api/translate가 응답에 실어 보내는 실측 사용량(api/_lib/models.ts의 TokenUsage).
// 서버 코드를 클라에서 import할 수 없어 경계에서 모양만 다시 적는다.
interface Usage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

// 회고 한 건은 번역을 여러 번 호출하므로(질문 라운드·검증 보정·보완 재번역)
// 호출별이 아니라 누적을 보여준다 — 사용자가 실제로 내는 금액이 그것이다.
interface Spend {
	calls: number;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	usd: number | null; // 단가를 모르는 모델(OpenAI 등)은 null
}

async function api(path: string, opts?: RequestInit) {
	const res = await fetch(path, {credentials: 'same-origin', ...opts});
	if (!res.ok) {
		let message = `요청 실패 (${res.status})`;
		try {
			const body = await res.json();
			if (body?.error) message = body.error;
		} catch {
			/* ignore */
		}
		throw new Error(message);
	}
	return res.json();
}

const sendJson = (method: string) => (path: string, data: unknown) =>
	api(path, {
		method,
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(data)
	});
const postJson = sendJson('POST');
const putJson = sendJson('PUT');
const del = (path: string) => api(path, {method: 'DELETE'});

// 토큰 수는 자릿수만 보이면 되므로 1000 단위로 줄여 쓴다(28,540 → 28.5K).
function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export interface RetroRouteProps {
	mode?: WizardMode;
}

export const RetroRoute: React.FC<RetroRouteProps> = ({mode = 'retro'}) => {
	const copy = COPY[mode];
	const history = useHistory();
	const location = useLocation();
	const {dispatch, stories} = useStoriesContext();
	const repairStories = useStoriesRepair();

	const [step, setStep] = React.useState<Step>('loading');
	const [error, setError] = React.useState<string>();
	const [pages, setPages] = React.useState<NamedPage[]>([]); // 루트 후보
	const [retros, setRetros] = React.useState<NamedPage[]>([]); // 기존 회고
	const [retro, setRetro] = React.useState<NamedPage>(); // 현재 회고
	const [newTitle, setNewTitle] = React.useState('');
	const [titleError, setTitleError] = React.useState<string>();
	const [models, setModels] = React.useState<ModelOption[]>([]);
	const [provider, setProvider] = React.useState<string | null>(null);
	const [model, setModel] = React.useState<string>('');
	const [apiKeyInput, setApiKeyInput] = React.useState('');
	const [keyError, setKeyError] = React.useState<string>();
	// 키 보관 시간은 서버 상수(LLM_KEY_MAX_AGE)에서 받아온다 — 화면에 적어두면 어긋난다.
	const [keyTtlHours, setKeyTtlHours] = React.useState<number>();
	const [draft, setDraft] = React.useState('');
	const [questions, setQuestions] = React.useState<string[]>([]);
	const [answers, setAnswers] = React.useState<Record<number, string>>({});
	const [qa, setQa] = React.useState<[string, string][]>([]);
	const [twee, setTwee] = React.useState<string>();
	const [storyName, setStoryName] = React.useState<string>();
	const [feedback, setFeedback] = React.useState('');
	const [message, setMessage] = React.useState('');
	const [msgSaved, setMsgSaved] = React.useState(false);
	const [msgError, setMsgError] = React.useState<string>();
	const [spend, setSpend] = React.useState<Spend>();

	// 번역 응답의 usage를 누적한다. 단가를 모르는 모델이 한 번이라도 섞이면
	// 합계 금액은 신뢰할 수 없으므로 null로 떨어뜨린다(토큰 수는 계속 보여준다).
	const addSpend = React.useCallback(
		(model: string, usage: Usage, usd: number | null) =>
			setSpend(prev => ({
				calls: (prev?.calls ?? 0) + 1,
				model,
				inputTokens: (prev?.inputTokens ?? 0) + usage.inputTokens,
				outputTokens: (prev?.outputTokens ?? 0) + usage.outputTokens,
				cacheReadTokens: (prev?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
				usd:
					usd === null || (prev && prev.usd === null) ? null : (prev?.usd ?? 0) + usd
			})),
		[]
	);

	const fail = React.useCallback((e: unknown) => {
		setError(e instanceof Error ? e.message : String(e));
		setStep('error');
	}, []);

	const loadRoots = React.useCallback(async () => {
		setStep('loading');
		try {
			const {pages} = await api('/api/notion/root');
			setPages(pages);
			setStep('root');
		} catch (e) {
			fail(e);
		}
	}, [fail]);

	// 설정된 LLM 키로 판별된 프로바이더의 모델 목록을 받아 드롭다운을 채운다.
	// 반환값으로 키 유무를 상위에서 판단한다.
	const applyLlmInfo = React.useCallback(
		(info: {
			provider: string | null;
			models?: ModelOption[];
			defaultModel?: string | null;
			keyExpiresInHours?: number;
		}) => {
			setProvider(info.provider);
			setModels(info.models ?? []);
			if (typeof info.keyExpiresInHours === 'number') {
				setKeyTtlHours(info.keyExpiresInHours);
			}
			setModel(prev =>
				prev && (info.models ?? []).some(m => m.id === prev)
					? prev
					: info.defaultModel ?? ''
			);
		},
		[]
	);

	const loadRetros = React.useCallback(async () => {
		setStep('loading');
		try {
			const {retros} = await api(
				mode === 'scenario' ? '/api/notion/retros?kind=scenario' : '/api/notion/retros'
			);
			setRetros(retros);
			setNewTitle('');
			setTitleError(undefined);
			setStep('select');
		} catch (e) {
			fail(e);
		}
	}, [mode, fail]);

	// 루트까지 정해진 뒤: AI 키가 있으면 회고 목록으로, 없으면 키 입력 단계로.
	const afterConfig = React.useCallback(async () => {
		setStep('loading');
		try {
			const info = await api('/api/llm');
			applyLlmInfo(info);
			if (!info.provider) {
				setStep('apikey');
				return;
			}
			await loadRetros();
		} catch (e) {
			fail(e);
		}
	}, [applyLlmInfo, loadRetros, fail]);

	// 최초: 세션 상태로 진입 단계 결정.
	React.useEffect(() => {
		api('/api/session')
			.then(s => {
				if (!s.connected) setStep('connect');
				else if (!s.configured) loadRoots();
				else afterConfig();
			})
			.catch(fail);
	}, [fail, loadRoots, afterConfig]);

	async function chooseRoot(pageId: string) {
		setStep('loading');
		try {
			await postJson('/api/notion/root', {pageId});
			await afterConfig();
		} catch (e) {
			fail(e);
		}
	}

	// 사용자가 입력한 AI 키를 봉인 세션 쿠키에 저장(서버). 성공 시 모델 목록 갱신 후 진행.
	async function submitKey() {
		const key = apiKeyInput.trim();
		setKeyError(undefined);
		if (!key) {
			setKeyError('API 키를 입력해 주세요.');
			return;
		}
		setStep('loading');
		try {
			const info = await postJson('/api/llm', {key});
			applyLlmInfo(info);
			setApiKeyInput('');
			await loadRetros();
		} catch (e) {
			setKeyError(e instanceof Error ? e.message : String(e));
			setStep('apikey');
		}
	}

	// 사용자가 맡긴 AI 키를 지운다(Notion 연결은 유지). 키를 잘못 넣었거나 쓰고 나서
	// 회수하고 싶을 때 필요한 최소 수단 — 서버에 DELETE /api/llm이 이미 있는데
	// 화면에 부르는 곳이 없었다.
	async function deleteKey() {
		if (
			!window.confirm(
				'저장된 AI API 키를 지울까요? Notion 연결은 그대로 유지돼요.'
			)
		) {
			return;
		}
		try {
			applyLlmInfo(await del('/api/llm'));
			setApiKeyInput('');
			setKeyError(undefined);
			setStep('apikey');
		} catch (e) {
			fail(e);
		}
	}

	// 봉인 쿠키를 통째로 지운다 — Notion 토큰과 AI 키가 한 쿠키에 있으므로 둘 다 사라진다.
	async function disconnect() {
		if (
			!window.confirm(
				'Notion 연결을 해제할까요? 함께 저장된 AI API 키도 지워져요.'
			)
		) {
			return;
		}
		try {
			await del('/api/session');
			applyLlmInfo({provider: null, models: [], defaultModel: null});
			setApiKeyInput('');
			setPages([]);
			setRetros([]);
			setRetro(undefined);
			setSpend(undefined);
			setStep('connect');
		} catch (e) {
			fail(e);
		}
	}

	async function runTranslate(
		r: NamedPage,
		draftText: string,
		qaList: [string, string][],
		existingTwee?: string,
		fb?: string
	) {
		setStep('translating');
		try {
			const res = await postJson('/api/translate', {
				weekLabel: r.title,
				draft: draftText,
				qa: qaList,
				existingTwee,
				feedback: fb,
				model: model || undefined,
				mode
			});
			if (res.usage) {
				addSpend(res.model, res.usage, res.costUsd ?? null);
			}
			if (res.questions?.length) {
				setQuestions(res.questions);
				setAnswers({});
				setStep('questions');
				return;
			}
			// 답변까지 반영돼 풍부해진 초안을 노션 회고 페이지에 되써 저장(best-effort —
			// 실패해도 재생 흐름은 막지 않는다). 노션 원문도 twee만큼 풍성해지도록.
			if (res.draftUpdate?.trim()) {
				putJson('/api/notion/draft', {
					pageId: r.id,
					draft: res.draftUpdate.trim()
				}).catch(() => {});
			}
			finishTwee(res.twee);
		} catch (e) {
			fail(e);
		}
	}

	// 새 회고/시나리오 제목 입력 → 중복 검사 → 노션 페이지 생성 → compose.
	async function startNewRetro() {
		const title = newTitle.trim();
		setTitleError(undefined);
		if (!title) {
			setTitleError(copy.emptyTitleError);
			return;
		}
		if (
			retros.some(r => r.title.trim().toLowerCase() === title.toLowerCase())
		) {
			setTitleError(copy.dupTitleError(title));
			return;
		}
		setStep('loading');
		try {
			const created: NamedPage = await postJson('/api/notion/retros', {
				title,
				kind: mode
			});
			setRetro(created);
			setRetros(rs => [created, ...rs]);
			setQa([]);
			setNewTitle('');
			setDraft('');
			setStep('compose');
		} catch (e) {
			// 중복(409) 등은 목록 화면에 인라인으로 안내(에러 페이지로 안 넘어감).
			setTitleError(e instanceof Error ? e.message : String(e));
			setStep('select');
		}
	}

	// 기존 회고 선택 → 본문 읽기. 비었으면 compose, 있으면 바로 번역.
	async function chooseRetro(r: NamedPage) {
		setRetro(r);
		setQa([]);
		setStep('loading');
		try {
			const {draft} = await api(
				`/api/notion/draft?pageId=${encodeURIComponent(r.id)}`
			);
			if (!draft) {
				setDraft('');
				setStep('compose');
				return;
			}
			setDraft(draft);
			await runTranslate(r, draft, []);
		} catch (e) {
			fail(e);
		}
	}

	// compose 본문을 노션 회고 페이지에 저장(write-back)한 뒤 번역.
	async function submitCompose() {
		if (!retro) return;
		const text = draft.trim();
		if (!text) return;
		setStep('loading');
		try {
			await putJson('/api/notion/draft', {pageId: retro.id, draft: text});
			await runTranslate(retro, text, []);
		} catch (e) {
			fail(e);
		}
	}

	function submitAnswers() {
		if (!retro) return;
		const merged: [string, string][] = [
			...qa,
			...questions.map((q, i): [string, string] => [q, answers[i] ?? ''])
		];
		setQa(merged);
		runTranslate(retro, draft, merged);
	}

	function finishTwee(finalTwee: string) {
		const parsed = storyFromTwee(finalTwee);
		// 시나리오는 편집기 목록에서 구분되게 태그만 달아둔다 — 어느 노션 DB에
		// 저장될지는 위저드에서 고른 루트가 정한다(store/persistence/notion-sync).
		const story =
			mode === 'scenario' && !parsed.tags.includes(SCENARIO_TAG)
				? {...parsed, tags: [...parsed.tags, SCENARIO_TAG]}
				: parsed;

		dispatch(importStories([story], stories));
		repairStories();
		setTwee(finalTwee);
		setStoryName(story.name);
		setStep('done');
	}

	// import 후 store가 갱신되면 이름으로 매칭해 storyId 확보.
	const created = storyName
		? stories.find(s => s.name === storyName)
		: undefined;

	// 만들어진 스토리를 원본 회고 페이지에 묶어둔다 — 재생 중 "그때의 나에게" 구절에
	// 쓴 메시지를 이 페이지에 저장하기 위해(story-play-route).
	const createdId = created?.id;
	const retroId = retro?.id;
	const retroTitle = retro?.title;

	React.useEffect(() => {
		// "그때의 나에게" 메시지 저장 통로는 회고 전용 — 시나리오는 매핑을 만들지 않는다.
		if (mode === 'retro' && createdId && retroId) {
			setRetroLinkForStory(createdId, {pageId: retroId, title: retroTitle ?? ''});
		}
	}, [mode, createdId, retroId, retroTitle]);

	function refine() {
		if (!retro || !twee) return;
		const fb = feedback.trim();
		setFeedback('');
		runTranslate(retro, draft, qa, twee, fb || undefined);
	}

	async function saveMessage() {
		if (!retro || !message.trim()) return;
		setMsgError(undefined);
		try {
			await postJson('/api/notion/draft', {
				pageId: retro.id,
				message: message.trim()
			});
			setMsgSaved(true);
		} catch (e) {
			setMsgError(e instanceof Error ? e.message : String(e));
		}
	}

	const denied = new URLSearchParams(location.search).get('notion') === 'denied';

	return (
		<div className="retro-route">
			<div className="retro-card">
				<div className="retro-header">
					<h1>{copy.heading}</h1>
					<button
						className="retro-home"
						onClick={() => history.push('/')}
						title="스토리 목록으로"
					>
						🏠 홈으로
					</button>
				</div>

				{spend && (
					<p className="retro-spend">
						{copy.spendLabel} — {copy.spendVerb} {spend.calls}회 · 입력{' '}
						{fmtTokens(spend.inputTokens)} / 출력 {fmtTokens(spend.outputTokens)} 토큰
						{spend.cacheReadTokens > 0 &&
							` · 캐시 재사용 ${fmtTokens(spend.cacheReadTokens)}`}
						{spend.usd === null
							? ' · 이 모델은 단가가 등록돼 있지 않아 금액을 계산하지 못했어요'
							: ` · 약 $${spend.usd.toFixed(3)}`}
					</p>
				)}

				{step === 'loading' && <p className="retro-muted">불러오는 중…</p>}

				{step === 'connect' && (
					<>
						{denied && (
							<p className="retro-muted">연결이 취소됐어요. 다시 시도해 주세요.</p>
						)}
						<p>{copy.connectIntro}</p>
						<a className="retro-btn primary" href="/api/notion/login">
							Notion으로 연결
						</a>
					</>
				)}

				{step === 'root' && (
					<>
						<p>{copy.rootIntro}</p>
						<ul className="retro-list">
							{pages.map(p => (
								<li key={p.id}>
									<button onClick={() => chooseRoot(p.id)}>{p.title}</button>
								</li>
							))}
							{pages.length === 0 && (
								<li className="retro-muted">
									공유된 페이지가 없어요. Notion 연결 때 회고 페이지를 공유했는지 확인해 주세요.
								</li>
							)}
						</ul>
						<a className="retro-back" href="/api/notion/login">
							원하는 페이지가 없나요? → Notion 다시 연결(페이지 다시 공유)
						</a>
					</>
				)}

				{step === 'apikey' && (
					<>
						<p>AI 모델 API 키를 입력해 주세요.</p>
						<p className="retro-muted">
							Anthropic(<code>sk-ant-...</code>) 또는 OpenAI(<code>sk-...</code>) 키.
							키는 암호화돼 이 브라우저 세션 쿠키에만 저장돼요 — Notion·화면·서버 DB
							어디에도 평문으로 남지 않아요.
						</p>
						<p className="retro-warn">
							🔒 안전을 위해 <strong>유효기간이 짧고 사용 한도(비용 상한)를 낮게 건
							키</strong>를 발급해 쓰시길 권해요. 만에 하나 키가 노출돼도 피해가 작게 끝나요.
							다 쓰면 프로바이더 콘솔에서 키를 폐기(revoke)하세요.
						</p>
						{keyTtlHours !== undefined && (
							<p className="retro-muted">
								입력한 키는 <strong>{keyTtlHours}시간</strong> 뒤 자동으로 잊혀요. 그
								뒤엔 다시 입력하면 되고, 언제든 아래 &lsquo;AI 키 삭제&rsquo;로 먼저
								지울 수도 있어요.
							</p>
						)}
						<div className="retro-new">
							<input
								type="password"
								value={apiKeyInput}
								placeholder="sk-ant-... / sk-..."
								onChange={e => {
									setApiKeyInput(e.target.value);
									setKeyError(undefined);
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') submitKey();
								}}
							/>
							<button
								className="retro-btn primary"
								onClick={submitKey}
								disabled={!apiKeyInput.trim()}
							>
								저장하고 계속
							</button>
						</div>
						{keyError && <p className="retro-error">{keyError}</p>}
					</>
				)}

				{step === 'select' && (
					<>
						<p>{copy.selectIntro}</p>
						<div className="retro-new">
							<input
								type="text"
								value={newTitle}
								placeholder={copy.titlePlaceholder}
								onChange={e => {
									setNewTitle(e.target.value);
									setTitleError(undefined);
								}}
								onKeyDown={e => {
									if (e.key === 'Enter') startNewRetro();
								}}
							/>
							<button
								className="retro-btn primary"
								onClick={startNewRetro}
								disabled={!newTitle.trim()}
							>
								{copy.newButton}
							</button>
						</div>
						{titleError && <p className="retro-error">{titleError}</p>}

						{retros.length > 0 && (
							<>
								<p className="retro-muted">{copy.existingLabel}</p>
								<ul className="retro-list">
									{retros.map(r => (
										<li key={r.id}>
											<button onClick={() => chooseRetro(r)}>{r.title}</button>
										</li>
									))}
								</ul>
							</>
						)}
						<div className="retro-back-row">
							<button className="retro-back" onClick={loadRoots}>
								← 다른 Notion 페이지(루트) 다시 선택
							</button>
							<button
								className="retro-back"
								onClick={() => {
									setKeyError(undefined);
									setStep('apikey');
								}}
							>
								AI 키 변경
							</button>
						</div>
					</>
				)}

				{step === 'compose' && (
					<>
						<p>
							<strong>{retro?.title}</strong> — {copy.composeIntro}
						</p>
						<textarea
							className="retro-compose"
							rows={12}
							value={draft}
							onChange={e => setDraft(e.target.value)}
							placeholder={copy.composePlaceholder}
						/>
						{models.length > 0 && (
							<div className="retro-model">
								<label>
									모델 선택{provider ? ` (${provider})` : ''} — 비용/품질을 골라요
								</label>
								<select value={model} onChange={e => setModel(e.target.value)}>
									{models.map(m => (
										<option key={m.id} value={m.id}>
											{m.label} — {m.hint}
										</option>
									))}
								</select>
							</div>
						)}
						<div className="retro-actions">
							<button
								className="retro-btn primary"
								onClick={submitCompose}
								disabled={!draft.trim()}
							>
								{copy.composeButton}
							</button>
						</div>
						<button className="retro-back" onClick={loadRetros}>
							{copy.backToList}
						</button>
					</>
				)}

				{step === 'translating' && (
					<p className="retro-muted">
						{retro?.title} 을(를) {copy.translating}
					</p>
				)}

				{step === 'questions' && (
					<>
						<p>{copy.questionsIntro}</p>
						{questions.map((q, i) => (
							<div key={i} className="retro-q">
								<label>{q}</label>
								<textarea
									rows={2}
									value={answers[i] ?? ''}
									onChange={e => {
										// React 16은 SyntheticEvent를 풀링해 핸들러 종료 후 필드를 비운다.
										// 함수형 업데이터는 나중에 실행되므로 값을 먼저 동기적으로 뽑아둔다
										// (안 그러면 e.target이 null → 크래시).
										const value = e.target.value;
										setAnswers(a => ({...a, [i]: value}));
									}}
								/>
							</div>
						))}
						<button className="retro-btn primary" onClick={submitAnswers}>
							{copy.questionsButton}
						</button>
					</>
				)}

				{step === 'done' && (
					<>
						<p>
							<strong>{storyName}</strong> 준비 완료!
						</p>
						<div className="retro-actions">
							<button
								className="retro-btn primary"
								disabled={!created}
								onClick={() => created && history.push(`/stories/${created.id}/play`)}
							>
								▶ Play
							</button>
							<button
								className="retro-btn"
								onClick={() => created && history.push(`/stories/${created.id}`)}
								disabled={!created}
							>
								편집기에서 열기
							</button>
							<button className="retro-btn" onClick={() => history.push('/')}>
								목록으로
							</button>
						</div>

						{mode === 'retro' && (
							<div className="retro-message">
								<label>
									그때의 나에게 한마디 — 여기서 바로 남기기 (재생 중 마지막 구절에 쓴
									메시지도 같은 회고 페이지에 저장돼요)
								</label>
								<textarea
									rows={3}
									value={message}
									onChange={e => setMessage(e.target.value)}
									disabled={msgSaved}
									placeholder="예: 과거의 너에게 — 그 선택, 후회하지 않아도 돼…"
								/>
								{msgSaved ? (
									<p className="retro-muted">✓ Notion에 저장됐어요.</p>
								) : (
									<button
										className="retro-btn"
										onClick={saveMessage}
										disabled={!message.trim()}
									>
										Notion에 저장
									</button>
								)}
								{msgError && <p className="retro-error">{msgError}</p>}
							</div>
						)}
						<div className="retro-refine">
							<label>보완하고 싶은 점이 있으면 적어주세요</label>
							<textarea
								rows={2}
								value={feedback}
								onChange={e => setFeedback(e.target.value)}
								placeholder={copy.refinePlaceholder}
							/>
							{models.length > 0 && (
								<div className="retro-model">
									<label>모델 선택 — 비용/품질을 골라요</label>
									<select
										value={model}
										onChange={e => setModel(e.target.value)}
									>
										{models.map(m => (
											<option key={m.id} value={m.id}>
												{m.label} — {m.hint}
											</option>
										))}
									</select>
								</div>
							)}
							<button className="retro-btn" onClick={refine}>
								보완해서 다시 만들기
							</button>
						</div>
						<div className="retro-back-row">
							<button className="retro-back" onClick={loadRetros}>
								{copy.backToOthers}
							</button>
							<button className="retro-back" onClick={loadRoots}>
								← 다른 Notion 페이지
							</button>
						</div>
					</>
				)}

				{step === 'error' && (
					<>
						<p className="retro-error">{error}</p>
						<button className="retro-btn" onClick={() => window.location.reload()}>
							다시 시도
						</button>
					</>
				)}

				{/* 맡긴 자격증명을 사용자가 직접 회수할 수단. 연결 전(connect)에는 지울 게 없다. */}
				{step !== 'connect' && step !== 'loading' && (
					<div className="retro-account">
						{provider && (
							<button className="retro-link" onClick={deleteKey}>
								AI 키 삭제
							</button>
						)}
						<button className="retro-link" onClick={disconnect}>
							Notion 연결 해제
						</button>
					</div>
				)}
			</div>
		</div>
	);
};
