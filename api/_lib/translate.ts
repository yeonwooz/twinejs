// 초안 → twee 번역 (서버측). scripts/retro.mjs의 translate/validate/withCosmicUI를 옮긴 것.
// 프롬프트·스타일시트는 scripts/의 파일을 단일 소스로 읽는다(vercel.json includeFiles로 번들).
import Anthropic from '@anthropic-ai/sdk';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const MODEL = 'claude-opus-4-8';

function readScript(name: string): string {
	return readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8');
}

const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['questions', 'twee', 'draftUpdate'],
	properties: {
		questions: {type: 'array', items: {type: 'string'}},
		twee: {type: 'string'},
		draftUpdate: {type: 'string'}
	}
};

export function validateTwee(twee: string): string[] {
	const titles = new Set(
		[...twee.matchAll(/^:: (.+)$/gm)].map(m =>
			m[1].trim().replace(/\s*\[stylesheet\]$/, '')
		)
	);
	const links = [...twee.matchAll(/\[\[[^\]]*?->([^\]]+)\]\]/g)].map(m =>
		m[1].trim()
	);
	const missing = links.filter(l => !titles.has(l));
	const sd = twee.match(/:: StoryData\n(\{[\s\S]*?\})/);
	let start: string | undefined;
	try {
		start = sd ? JSON.parse(sd[1]).start : undefined;
	} catch {
		/* ignore */
	}
	const problems: string[] = [];
	if (missing.length) problems.push(`끊긴 링크: ${[...new Set(missing)].join(', ')}`);
	if (!start || !titles.has(start)) problems.push(`StoryData.start "${start}" 구절 없음`);
	return problems;
}

export function withCosmicUI(twee: string): string {
	const css = readScript('cosmic-stylesheet.txt').trimEnd();
	const stripped = twee.replace(
		/\n:: [^\n]*\[stylesheet\][\s\S]*?(?=\n:: |\s*$)/g,
		''
	);
	return stripped.trimEnd() + '\n\n' + css + '\n';
}

export interface TranslateInput {
	apiKey: string;
	draftText: string;
	weekLabel: string;
	qa?: [string, string][];
	existingTwee?: string;
	feedback?: string;
}

export interface TranslateResult {
	questions: string[];
	twee: string;
	draftUpdate: string;
}

export async function translate(input: TranslateInput): Promise<TranslateResult> {
	const anthropic = new Anthropic({apiKey: input.apiKey});
	const system = readScript('retro-prompt.md');

	let user = `주차: ${input.weekLabel}\n\n회고 초안:\n"""\n${input.draftText}\n"""\n`;
	if (input.existingTwee) {
		user += `\n기존 twee(구절 제목과 StoryData 유지):\n"""\n${input.existingTwee}\n"""\n`;
	}
	if (input.feedback) user += `\n보완 요청: ${input.feedback}\n`;
	if (input.qa?.length) {
		user +=
			'\n앞선 질문에 대한 사용자 답변:\n' +
			input.qa.map(([q, a]) => `- Q: ${q}\n  A: ${a}`).join('\n') +
			'\n더 물을 게 없으면 questions는 빈 배열로 둔다.\n';
	}

	const response = await anthropic.messages.create({
		model: MODEL,
		max_tokens: 16000,
		thinking: {type: 'adaptive'},
		system,
		output_config: {format: {type: 'json_schema', schema: OUTPUT_SCHEMA}},
		messages: [{role: 'user', content: user}]
	} as any);

	const text = (response.content as any[])
		.filter(b => b.type === 'text')
		.map(b => b.text)
		.join('');
	return JSON.parse(text) as TranslateResult;
}
