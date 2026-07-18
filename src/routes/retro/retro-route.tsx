import * as React from 'react';
import {useHistory, useLocation} from 'react-router-dom';
import {importStories, useStoriesContext} from '../../store/stories';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {storyFromTwee} from '../../util/twee';
import './retro-route.css';

type Step =
	| 'loading'
	| 'connect'
	| 'root'
	| 'week'
	| 'questions'
	| 'translating'
	| 'done'
	| 'error';

interface NamedPage {
	id: string;
	title: string;
}
interface WeekPage extends NamedPage {
	week: number;
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

const postJson = (path: string, data: unknown) =>
	api(path, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(data)
	});

export const RetroRoute: React.FC = () => {
	const history = useHistory();
	const location = useLocation();
	const {dispatch, stories} = useStoriesContext();
	const repairStories = useStoriesRepair();

	const [step, setStep] = React.useState<Step>('loading');
	const [error, setError] = React.useState<string>();
	const [pages, setPages] = React.useState<NamedPage[]>([]);
	const [weeks, setWeeks] = React.useState<WeekPage[]>([]);
	const [week, setWeek] = React.useState<WeekPage>();
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

	const fail = React.useCallback((e: unknown) => {
		setError(e instanceof Error ? e.message : String(e));
		setStep('error');
	}, []);

	const loadRoots = React.useCallback(async () => {
		setStep('loading');
		try {
			const {pages} = await api('/api/notion/roots');
			setPages(pages);
			setStep('root');
		} catch (e) {
			fail(e);
		}
	}, [fail]);

	const loadWeeks = React.useCallback(async () => {
		setStep('loading');
		try {
			const {weeks} = await api('/api/notion/weeks');
			setWeeks(weeks);
			setStep('week');
		} catch (e) {
			fail(e);
		}
	}, [fail]);

	// 최초: 세션 상태로 진입 단계 결정.
	React.useEffect(() => {
		api('/api/session')
			.then(s => {
				if (!s.connected) setStep('connect');
				else if (!s.configured) loadRoots();
				else loadWeeks();
			})
			.catch(fail);
	}, [fail, loadRoots, loadWeeks]);

	async function chooseRoot(pageId: string) {
		setStep('loading');
		try {
			await postJson('/api/notion/select-root', {pageId});
			await loadWeeks();
		} catch (e) {
			fail(e);
		}
	}

	async function runTranslate(
		w: WeekPage,
		draftText: string,
		qaList: [string, string][],
		existingTwee?: string,
		fb?: string
	) {
		setStep('translating');
		try {
			const r = await postJson('/api/translate', {
				weekLabel: w.title,
				draft: draftText,
				qa: qaList,
				existingTwee,
				feedback: fb
			});
			if (r.questions?.length) {
				setQuestions(r.questions);
				setAnswers({});
				setStep('questions');
				return;
			}
			finishTwee(r.twee);
		} catch (e) {
			fail(e);
		}
	}

	async function chooseWeek(w: WeekPage) {
		setWeek(w);
		setQa([]);
		setStep('loading');
		try {
			const {draft} = await api(
				`/api/notion/draft?pageId=${encodeURIComponent(w.id)}`
			);
			if (!draft) {
				throw new Error(`"${w.title}" 페이지 본문에 회고 내용이 없어요.`);
			}
			setDraft(draft);
			await runTranslate(w, draft, []);
		} catch (e) {
			fail(e);
		}
	}

	function submitAnswers() {
		if (!week) return;
		const merged: [string, string][] = [
			...qa,
			...questions.map((q, i): [string, string] => [q, answers[i] ?? ''])
		];
		setQa(merged);
		runTranslate(week, draft, merged);
	}

	function finishTwee(finalTwee: string) {
		const story = storyFromTwee(finalTwee);
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

	function refine() {
		if (!week || !twee) return;
		const fb = feedback.trim();
		setFeedback('');
		runTranslate(week, draft, qa, twee, fb || undefined);
	}

	async function saveMessage() {
		if (!week || !message.trim()) return;
		setMsgError(undefined);
		try {
			await postJson('/api/notion/message', {
				pageId: week.id,
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
				<h1>인터랙티브 회고</h1>

				{step === 'loading' && <p className="retro-muted">불러오는 중…</p>}

				{step === 'connect' && (
					<>
						{denied && (
							<p className="retro-muted">연결이 취소됐어요. 다시 시도해 주세요.</p>
						)}
						<p>Notion을 연결하면 그 주 회고를 인터랙티브 스토리로 만들 수 있어요.</p>
						<a className="retro-btn primary" href="/api/notion/login">
							Notion으로 연결
						</a>
					</>
				)}

				{step === 'root' && (
					<>
						<p>회고가 들어 있는 루트 페이지를 골라주세요.</p>
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

				{step === 'week' && (
					<>
						<p>몇 주차 회고를 만들까요?</p>
						<ul className="retro-list">
							{weeks.map(w => (
								<li key={w.id}>
									<button onClick={() => chooseWeek(w)}>{w.title}</button>
								</li>
							))}
							{weeks.length === 0 && (
								<li className="retro-muted">
									「N주차 회고」 페이지가 없어요. Notion에 먼저 만들어 주세요.
								</li>
							)}
						</ul>
						<button className="retro-back" onClick={loadRoots}>
							← 다른 Notion 페이지(루트) 다시 선택
						</button>
					</>
				)}

				{step === 'translating' && (
					<p className="retro-muted">
						{week?.title} 을(를) 평행우주 회고로 번역하는 중…
					</p>
				)}

				{step === 'questions' && (
					<>
						<p>회고에 비어 있는 부분이 있어요. 채워 주세요:</p>
						{questions.map((q, i) => (
							<div key={i} className="retro-q">
								<label>{q}</label>
								<textarea
									rows={2}
									value={answers[i] ?? ''}
									onChange={e =>
										setAnswers(a => ({...a, [i]: e.target.value}))
									}
								/>
							</div>
						))}
						<button className="retro-btn primary" onClick={submitAnswers}>
							이어서 번역
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

						<div className="retro-message">
							<label>그때의 나에게 한마디 (저장하면 Notion 그 주차 페이지에 남아요)</label>
							<textarea
								rows={3}
								value={message}
								onChange={e => setMessage(e.target.value)}
								disabled={msgSaved}
								placeholder="다음 배포 직전의 나에게…"
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
						<div className="retro-refine">
							<label>보완하고 싶은 점이 있으면 적어주세요</label>
							<textarea
								rows={2}
								value={feedback}
								onChange={e => setFeedback(e.target.value)}
								placeholder="예: 우주 β의 결과를 더 극적으로"
							/>
							<button className="retro-btn" onClick={refine}>
								보완해서 다시 만들기
							</button>
						</div>
						<div className="retro-back-row">
							<button className="retro-back" onClick={loadWeeks}>
								← 다른 주차
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
			</div>
		</div>
	);
};
