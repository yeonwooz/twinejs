// 초안 하나를 인터랙티브 스토리로 빚는 화면. 회고와 창작 시나리오가 같은 라우트를 쓴다.
//
// 예전에는 /retro와 /scenario 두 라우트가 같은 컴포넌트를 문구만 바꿔 렌더했고, 단계가
// 여덟이었다 — connect, root, apikey, select, compose, questions, translating, done.
// 앞의 넷은 이 화면이 할 일이 아니다: 연결·저장 위치·AI 키는 설정(⚙)이 맡고, 무엇을
// 만들지 고르는 일은 홈의 기록 목록이 맡는다. 여기 남는 건 네 단계뿐이다.
import * as React from 'react';
import {useHistory, useLocation, useParams} from 'react-router-dom';
import {IconSettings} from '@tabler/icons';
import {IconButton} from '../../components/control/icon-button';
import {
	DialogsContextProvider,
	SettingsDialog,
	useDialogsContext
} from '../../dialogs';
import {DraftKind, fetchDrafts} from '../../store/records';
import {SCENARIO_TAG} from '../../store/persistence/notion-sync';
import {importStories, useStoriesContext} from '../../store/stories';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {fetchJson} from '../../util/json-fetch';
import {storyFromTwee} from '../../util/twee';
import './make-route.css';

type Step =
	'loading' | 'compose' | 'questions' | 'translating' | 'done' | 'error';

export type WizardMode = 'retro' | 'scenario';

const COPY = {
	retro: {
		heading: '인터랙티브 회고',
		spendLabel: '이번 회고',
		spendVerb: '번역',
		composeIntro: '회고를 자연어로 자유롭게 써 주세요.',
		composePlaceholder:
			'이번 기간 동안 어떤 결정을 했고, 무엇이 후회되고, 무엇이 좋았는지 편하게 적어 주세요. 저장하면 Notion 그 회고 페이지에도 남아요.',
		composeButton: '인터랙티브 회고로 만들기',
		translating: '평행우주 회고로 번역하는 중…',
		questionsIntro: '회고에 비어 있는 부분이 있어요. 채워 주세요:',
		questionsButton: '이어서 번역',
		refinePlaceholder: '예: 우주 β의 결과를 더 극적으로'
	},
	scenario: {
		heading: '창작 시나리오',
		spendLabel: '이번 시나리오',
		spendVerb: '생성',
		composeIntro: '만들고 싶은 이야기를 자유롭게 설명해 주세요.',
		composePlaceholder:
			'장르, 주인공, 배경, 갈등, 원하는 결말의 분위기… 떠오르는 대로 적어 주세요. 얇으면 AI가 먼저 물어보고, 저장하면 Notion 그 시나리오 페이지에도 남아요.',
		composeButton: '인터랙티브 시나리오로 만들기',
		translating: '갈림길 있는 이야기로 빚는 중…',
		questionsIntro:
			'이야기의 뼈대를 세우는 데 더 필요한 게 있어요. 채워 주세요:',
		questionsButton: '이어서 만들기',
		refinePlaceholder: '예: 결말을 하나 더 / 중반 선택을 더 어렵게'
	}
} as const;

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

// 한 건을 만드는 동안 번역을 여러 번 호출하므로(질문 라운드·보완 재번역) 호출별이 아니라
// 누적을 보여준다 — 사용자가 실제로 내는 금액이 그것이다.
interface Spend {
	calls: number;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	usd: number | null; // 단가를 모르는 모델(OpenAI 등)은 null
}

// 초안 종류를 프롬프트 모드로 옮긴다. 'story'(예전 일반 스토리 구상 폴더)는 회고 서사가
// 아니므로 창작 쪽으로 보낸다.
function modeOf(kind: DraftKind): WizardMode {
	return kind === 'retro' ? 'retro' : 'scenario';
}

// 토큰 수는 자릿수만 보이면 되므로 1000 단위로 줄여 쓴다(28,540 → 28.5K).
function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

interface MakeLocationState {
	draft?: string;
	kind?: DraftKind;
	title?: string;
}

const InnerMakeRoute: React.FC = () => {
	const history = useHistory();
	const location = useLocation<MakeLocationState | undefined>();
	const {pageId} = useParams<{pageId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const repairStories = useStoriesRepair();

	const [step, setStep] = React.useState<Step>('loading');
	const [error, setError] = React.useState<string>();
	// 설정을 고쳐야 넘어갈 수 있는 실패인지(미연결·초안 페이지 미선택·AI 키 없음).
	const [fixInSettings, setFixInSettings] = React.useState(false);
	const [mode, setMode] = React.useState<WizardMode>('retro');
	const [title, setTitle] = React.useState(location.state?.title ?? '');
	const [models, setModels] = React.useState<ModelOption[]>([]);
	const [provider, setProvider] = React.useState<string | null>(null);
	const [model, setModel] = React.useState('');
	const [draft, setDraft] = React.useState(location.state?.draft ?? '');
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

	const copy = COPY[mode];

	const openSettings = React.useCallback(
		() => dialogsDispatch({type: 'addDialog', component: SettingsDialog}),
		[dialogsDispatch]
	);

	const fail = React.useCallback((e: unknown, needsSettings = false) => {
		setError(e instanceof Error ? e.message : String(e));
		setFixInSettings(needsSettings);
		setStep('error');
	}, []);

	const addSpend = React.useCallback(
		(model: string, usage: Usage, usd: number | null) =>
			setSpend(prev => ({
				calls: (prev?.calls ?? 0) + 1,
				model,
				inputTokens: (prev?.inputTokens ?? 0) + usage.inputTokens,
				outputTokens: (prev?.outputTokens ?? 0) + usage.outputTokens,
				cacheReadTokens: (prev?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
				usd:
					usd === null || (prev && prev.usd === null)
						? null
						: (prev?.usd ?? 0) + usd
			})),
		[]
	);

	// 종류는 인자로 받는다. `mode` state를 읽으면 안 된다 — 최초 진입에서 종류를 알아낸
	// 직후(setMode) 바로 번역을 거는데, 그 시점의 클로저는 아직 초기값 'retro'를 들고
	// 있어서 작문대로 만든 시나리오에 `scenario` 태그가 안 붙었다.
	const finishTwee = React.useCallback(
		(finalTwee: string, forMode: WizardMode) => {
			const parsed = storyFromTwee(finalTwee);
			// 시나리오는 편집기 목록에서 구분되게 태그만 달아둔다 — 어느 노션 DB에
			// 저장될지는 설정이 정한다(store/persistence/notion-sync).
			const story =
				forMode === 'scenario' && !parsed.tags.includes(SCENARIO_TAG)
					? {...parsed, tags: [...parsed.tags, SCENARIO_TAG]}
					: parsed;

			dispatch(importStories([story], stories));
			repairStories();
			setTwee(finalTwee);
			setStoryName(story.name);
			setStep('done');
		},
		[dispatch, repairStories, stories]
	);

	const runTranslate = React.useCallback(
		async (args: {
			weekLabel: string;
			mode: WizardMode;
			draft: string;
			qa: [string, string][];
			existingTwee?: string;
			feedback?: string;
			model?: string;
		}) => {
			setStep('translating');

			try {
				const res = await fetchJson('/api/translate', {
					body: {
						weekLabel: args.weekLabel,
						draft: args.draft,
						qa: args.qa,
						existingTwee: args.existingTwee,
						feedback: args.feedback,
						model: args.model || undefined,
						mode: args.mode
					}
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

				// 답변까지 반영돼 풍부해진 초안을 노션 페이지에 되써 저장(best-effort —
				// 실패해도 재생 흐름은 막지 않는다). 노션 원문도 twee만큼 풍성해지도록.
				if (res.draftUpdate?.trim()) {
					fetchJson('/api/notion/draft', {
						method: 'PUT',
						body: {pageId, draft: res.draftUpdate.trim()}
					}).catch(() => {});
				}

				finishTwee(res.twee, args.mode);
			} catch (e) {
				// AI 키가 없거나 만료됐을 때도 여기로 온다 — 설정에서 고칠 수 있게 안내한다.
				fail(e, true);
			}
		},
		[addSpend, fail, finishTwee, pageId]
	);

	// 최초 진입. 홈 작문대에서 왔으면 본문이 라우터 state에 실려 있어 바로 번역하고,
	// "이어서 쓰기"로 왔으면 노션에서 본문을 읽어 온다.
	const bootedRef = React.useRef(false);

	React.useEffect(() => {
		if (bootedRef.current) {
			return;
		}

		bootedRef.current = true;

		(async () => {
			try {
				// 종류를 알아야 프롬프트가 갈린다. 홈에서 왔으면 state에 있고, 주소로
				// 바로 들어왔거나 새로고침했으면 초안 목록에서 찾는다.
				let kind = location.state?.kind;
				let pageTitle = location.state?.title;

				if (!kind || !pageTitle) {
					const found = (await fetchDrafts()).find(d => d.id === pageId);

					kind = kind ?? found?.kind ?? 'retro';
					pageTitle = pageTitle ?? found?.title ?? '';
				}

				const resolvedMode = modeOf(kind);

				setMode(resolvedMode);
				setTitle(pageTitle);

				// 모델 목록(선택용). 키가 없으면 빈 목록 — 번역 시도에서 걸린다.
				try {
					const info = await fetchJson('/api/llm');

					setProvider(info.provider);
					setModels(info.models ?? []);
					setModel(info.defaultModel ?? '');
				} catch {
					/* 키가 없어도 화면은 떠야 한다 */
				}

				const seeded = location.state?.draft?.trim();

				if (seeded) {
					await runTranslate({
						weekLabel: pageTitle,
						mode: resolvedMode,
						draft: seeded,
						qa: []
					});
					return;
				}

				const {draft: existing} = await fetchJson(
					`/api/notion/draft?pageId=${encodeURIComponent(pageId)}`
				);

				if (!existing?.trim()) {
					setDraft('');
					setStep('compose');
					return;
				}

				setDraft(existing);
				await runTranslate({
					weekLabel: pageTitle,
					mode: resolvedMode,
					draft: existing,
					qa: []
				});
			} catch (e) {
				fail(e, true);
			}
		})();
	}, [fail, location.state, pageId, runTranslate]);

	// compose 본문을 노션 페이지에 저장(write-back)한 뒤 번역.
	async function submitCompose() {
		const text = draft.trim();

		if (!text) {
			return;
		}

		setStep('loading');

		try {
			await fetchJson('/api/notion/draft', {
				method: 'PUT',
				body: {pageId, draft: text}
			});
			await runTranslate({weekLabel: title, mode, draft: text, qa: [], model});
		} catch (e) {
			fail(e, true);
		}
	}

	function submitAnswers() {
		const merged: [string, string][] = [
			...qa,
			...questions.map((q, i): [string, string] => [q, answers[i] ?? ''])
		];

		setQa(merged);
		runTranslate({weekLabel: title, mode, draft, qa: merged, model});
	}

	function refine() {
		if (!twee) {
			return;
		}

		const fb = feedback.trim();

		setFeedback('');
		runTranslate({
			weekLabel: title,
			mode,
			draft,
			qa,
			existingTwee: twee,
			feedback: fb || undefined,
			model
		});
	}

	// import 후 store가 갱신되면 이름으로 매칭해 storyId 확보.
	const created = storyName
		? stories.find(s => s.name === storyName)
		: undefined;

	async function saveMessage() {
		if (!message.trim()) {
			return;
		}

		setMsgError(undefined);

		try {
			await fetchJson('/api/notion/draft', {
				body: {pageId, message: message.trim()}
			});
			setMsgSaved(true);
		} catch (e) {
			setMsgError(e instanceof Error ? e.message : String(e));
		}
	}

	const modelPicker = models.length > 0 && (
		<div className="make-model">
			<label>
				모델 선택{provider ? ` (${provider})` : ''} — 비용/품질을 골라요
			</label>
			<select onChange={e => setModel(e.target.value)} value={model}>
				{models.map(m => (
					<option key={m.id} value={m.id}>
						{m.label} — {m.hint}
					</option>
				))}
			</select>
		</div>
	);

	return (
		<div className="make-route">
			<div className="make-card">
				<div className="make-header">
					<h1>
						{copy.heading}
						{title && <span className="make-title"> — {title}</span>}
					</h1>
					<button
						className="make-home"
						onClick={() => history.push('/')}
						title="기록으로"
					>
						← 기록
					</button>
				</div>

				{spend && (
					<p className="make-spend">
						{copy.spendLabel} — {copy.spendVerb} {spend.calls}회 · 입력{' '}
						{fmtTokens(spend.inputTokens)} / 출력{' '}
						{fmtTokens(spend.outputTokens)} 토큰
						{spend.cacheReadTokens > 0 &&
							` · 캐시 재사용 ${fmtTokens(spend.cacheReadTokens)}`}
						{spend.usd === null
							? ' · 이 모델은 단가가 등록돼 있지 않아 금액을 계산하지 못했어요'
							: ` · 약 $${spend.usd.toFixed(3)}`}
					</p>
				)}

				{step === 'loading' && <p className="make-muted">불러오는 중…</p>}

				{step === 'compose' && (
					<>
						<p>{copy.composeIntro}</p>
						<textarea
							className="make-compose"
							onChange={e => setDraft(e.target.value)}
							placeholder={copy.composePlaceholder}
							rows={12}
							value={draft}
						/>
						{modelPicker}
						<div className="make-actions">
							<button
								className="make-btn primary"
								disabled={!draft.trim()}
								onClick={submitCompose}
							>
								{copy.composeButton}
							</button>
						</div>
					</>
				)}

				{step === 'translating' && (
					<p className="make-muted">
						{title} 을(를) {copy.translating}
					</p>
				)}

				{step === 'questions' && (
					<>
						<p>{copy.questionsIntro}</p>
						{questions.map((q, i) => (
							<div className="make-q" key={i}>
								<label>{q}</label>
								<textarea
									onChange={e => {
										// React 16은 SyntheticEvent를 풀링해 핸들러 종료 후 필드를
										// 비운다. 함수형 업데이터는 나중에 실행되므로 값을 먼저
										// 동기적으로 뽑아둔다(안 그러면 e.target이 null → 크래시).
										const value = e.target.value;

										setAnswers(a => ({...a, [i]: value}));
									}}
									rows={2}
									value={answers[i] ?? ''}
								/>
							</div>
						))}
						<button className="make-btn primary" onClick={submitAnswers}>
							{copy.questionsButton}
						</button>
					</>
				)}

				{step === 'done' && (
					<>
						<p>
							<strong>{storyName}</strong> 준비 완료!
						</p>
						<div className="make-actions">
							<button
								className="make-btn primary"
								disabled={!created}
								onClick={() =>
									created && history.push(`/stories/${created.id}/play`)
								}
							>
								▶ Play
							</button>
							<button
								className="make-btn"
								disabled={!created}
								onClick={() =>
									created && history.push(`/stories/${created.id}`)
								}
							>
								편집기에서 열기
							</button>
							<button className="make-btn" onClick={() => history.push('/')}>
								기록으로
							</button>
						</div>

						{mode === 'retro' && (
							<div className="make-message">
								<label>
									그때의 나에게 한마디 — 여기서 바로 남기기 (재생 중 마지막
									구절에 쓴 메시지도 같은 회고 페이지에 저장돼요)
								</label>
								<textarea
									disabled={msgSaved}
									onChange={e => setMessage(e.target.value)}
									placeholder="예: 과거의 너에게 — 그 선택, 후회하지 않아도 돼…"
									rows={3}
									value={message}
								/>
								{msgSaved ? (
									<p className="make-muted">✓ Notion에 저장됐어요.</p>
								) : (
									<button
										className="make-btn"
										disabled={!message.trim()}
										onClick={saveMessage}
									>
										Notion에 저장
									</button>
								)}
								{msgError && <p className="make-error">{msgError}</p>}
							</div>
						)}

						<div className="make-refine">
							<label>보완하고 싶은 점이 있으면 적어주세요</label>
							<textarea
								onChange={e => setFeedback(e.target.value)}
								placeholder={copy.refinePlaceholder}
								rows={2}
								value={feedback}
							/>
							{modelPicker}
							<button className="make-btn" onClick={refine}>
								보완해서 다시 만들기
							</button>
						</div>
					</>
				)}

				{step === 'error' && (
					<>
						<p className="make-error">{error}</p>
						<div className="make-actions">
							{fixInSettings && (
								<IconButton
									icon={<IconSettings />}
									label="설정 열기"
									onClick={openSettings}
									variant="primary"
								/>
							)}
							<button
								className="make-btn"
								onClick={() => window.location.reload()}
							>
								다시 시도
							</button>
							<button className="make-btn" onClick={() => history.push('/')}>
								기록으로
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
};

export const MakeRoute: React.FC = () => (
	<DialogsContextProvider>
		<InnerMakeRoute />
	</DialogsContextProvider>
);
