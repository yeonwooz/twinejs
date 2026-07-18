import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {ErrorMessage} from '../error';
import './sandboxed-story-player.css';

export interface SandboxedStoryPlayerProps {
	// Returns a self-contained published story HTML document (see publish.ts).
	publish: () => Promise<string>;
}

// Renders a published story inside a sandboxed iframe. `allow-scripts` lets the
// story's own JavaScript run, but the deliberate absence of `allow-same-origin`
// gives the iframe an opaque origin: story scripts cannot read the parent app's
// cookies, sessionStorage, or DOM. This matters on the hosted (Vercel) build,
// where a Notion session cookie lives on the app origin — a malicious `[script]`
// passage must not be able to reach it.
//
// Tradeoff: the story format's own web storage (e.g. Harlowe game saves) also
// can't persist under an opaque origin. That's an accepted cost of isolation.
export const SandboxedStoryPlayer: React.FC<SandboxedStoryPlayerProps> = ({
	publish
}) => {
	const history = useHistory();
	const [html, setHtml] = React.useState<string>();
	const [error, setError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);

	React.useEffect(() => {
		if (inited) {
			return;
		}

		setInited(true);
		publish()
			.then(setHtml)
			.catch(caught => setError(caught as Error));
	}, [inited, publish]);

	if (error) {
		return <ErrorMessage>{error.message}</ErrorMessage>;
	}

	if (html === undefined) {
		return null;
	}

	return (
		<>
			<button
				className="sandboxed-story-back"
				onClick={() => history.push('/')}
			>
				← 목록으로
			</button>
			<iframe
				className="sandboxed-story-player"
				title="Story"
				sandbox="allow-scripts"
				srcDoc={html}
			/>
		</>
	);
};
