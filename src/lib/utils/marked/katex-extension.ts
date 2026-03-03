// "Loose" delimiters: $ and $$ are ambiguous (could be currency), so they
// require surrounding-character checks to avoid false positives.
const LOOSE_DELIMITERS = [
	{ left: '$$', right: '$$', display: true },
	{ left: '$', right: '$', display: false }
];

// "Strict" delimiters: these are unambiguous LaTeX syntax and can be matched
// without surrounding-character constraints.
const STRICT_DELIMITERS = [
	{ left: '\\pu{', right: '}', display: false },
	{ left: '\\ce{', right: '}', display: false },
	{ left: '\\(', right: '\\)', display: false },
	{ left: '\\[', right: '\\]', display: true },
	{ left: '\\begin{equation}', right: '\\end{equation}', display: true }
];

const ALL_DELIMITERS = [...LOOSE_DELIMITERS, ...STRICT_DELIMITERS];

// Defines characters that are allowed to immediately precede or follow a
// loose math delimiter ($ and $$). Strict delimiters skip this check.
const ALLOWED_SURROUNDING_CHARS =
	'\\s。，、､;；„“‘’“”（）「」『』［］《》【】‹›«»…⋯:：？！～⇒?!-\\/:-@\\[-`{-~\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
// Modified to fit more formats in different languages. Originally: '\\s?。，、；!-\\/:-@\\[-`{-~\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';

// const DELIMITER_LIST = [
//     { left: '$$', right: '$$', display: false },
//     { left: '$', right: '$', display: false },
// ];

// const inlineRule = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:？！。，：]|$)/;
// const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;


function escapeRegex(string) {
	return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function buildPatterns(delimiters) {
	const inlinePatterns: string[] = [];
	const blockPatterns: string[] = [];

	delimiters.forEach((delimiter) => {
		const { left, right, display } = delimiter;
		const escapedLeft = escapeRegex(left);
		const escapedRight = escapeRegex(right);

		if (!display) {
			// Inline-only delimiters must not span newlines to prevent greedy cross-line matching
			inlinePatterns.push(`${escapedLeft}((?:\\\\[^\\n]|[^\\\\\\n])+?)${escapedRight}`);
		} else {
			// Block delimiters double as inline delimiters when not followed by a newline
			inlinePatterns.push(`${escapedLeft}(?!\\n)((?:\\\\[^]|[^\\\\])+?)(?!\\n)${escapedRight}`);
			blockPatterns.push(`${escapedLeft}\\n((?:\\\\[^]|[^\\\\])+?)\\n${escapedRight}`);
		}
	});

	return { inlinePatterns, blockPatterns };
}

function generateRegexRules() {
	const loose = buildPatterns(LOOSE_DELIMITERS);
	const strict = buildPatterns(STRICT_DELIMITERS);

	// Loose patterns require the surrounding-char lookahead
	const looseInline = loose.inlinePatterns.length
		? `(?:${loose.inlinePatterns.join('|')})(?=[${ALLOWED_SURROUNDING_CHARS}]|$)`
		: null;
	const looseBlock = loose.blockPatterns.length
		? `(?:${loose.blockPatterns.join('|')})(?=[${ALLOWED_SURROUNDING_CHARS}]|$)`
		: null;

	// Strict patterns match without surrounding-char constraints
	const strictInline = strict.inlinePatterns.length
		? `(?:${strict.inlinePatterns.join('|')})`
		: null;
	const strictBlock = strict.blockPatterns.length
		? `(?:${strict.blockPatterns.join('|')})`
		: null;

	// Combine: try strict first (more specific), then loose
	const inlineParts = [strictInline, looseInline].filter(Boolean);
	const blockParts = [strictBlock, looseBlock].filter(Boolean);

	const inlineRule = new RegExp(`^(${inlineParts.join('|')})`, 'u');
	const blockRule = new RegExp(`^(${blockParts.join('|')})`, 'u');

	return { inlineRule, blockRule };
}

const { inlineRule, blockRule } = generateRegexRules();

// Set of loose left delimiters for quick lookup in katexStart
const LOOSE_LEFT_SET = new Set(LOOSE_DELIMITERS.map((d) => d.left));

export default function (options = {}) {
	return {
		extensions: [inlineKatex(options), blockKatex(options)]
	};
}

function katexStart(src, displayMode: boolean) {
	const ruleReg = displayMode ? blockRule : inlineRule;

	let indexSrc = src;

	while (indexSrc) {
		let index = -1;
		let startIndex = -1;
		let startDelimiter = '';
		let endDelimiter = '';
		for (const delimiter of ALL_DELIMITERS) {
			if (delimiter.display !== displayMode) {
				continue;
			}

			startIndex = indexSrc.indexOf(delimiter.left);
			if (startIndex === -1) {
				continue;
			}

			index = startIndex;
			startDelimiter = delimiter.left;
			endDelimiter = delimiter.right;
		}

		if (index === -1) {
			return;
		}

		// Strict delimiters skip the surrounding-char check; loose ones require it
		const isStrict = !LOOSE_LEFT_SET.has(startDelimiter);
		const surroundingOk =
			isStrict ||
			index === 0 ||
			indexSrc.charAt(index - 1).match(new RegExp(`[${ALLOWED_SURROUNDING_CHARS}]`, 'u'));

		if (surroundingOk) {
			const possibleKatex = indexSrc.substring(index);

			if (possibleKatex.match(ruleReg)) {
				return index;
			}
		}

		indexSrc = indexSrc.substring(index + startDelimiter.length).replace(endDelimiter, '');
	}
}

function katexTokenizer(src, tokens, displayMode: boolean) {
	const ruleReg = displayMode ? blockRule : inlineRule;
	const type = displayMode ? 'blockKatex' : 'inlineKatex';

	const match = src.match(ruleReg);

	if (match) {
		const text = match
			.slice(2)
			.filter((item) => item)
			.find((item) => item.trim());

		return {
			type,
			raw: match[0],
			text: text,
			displayMode
		};
	}
}

function inlineKatex(options) {
	return {
		name: 'inlineKatex',
		level: 'inline',
		start(src) {
			return katexStart(src, false);
		},
		tokenizer(src, tokens) {
			return katexTokenizer(src, tokens, false);
		},
		renderer(token) {
			return `${token?.text ?? ''}`;
		}
	};
}

function blockKatex(options) {
	return {
		name: 'blockKatex',
		level: 'block',
		start(src) {
			return katexStart(src, true);
		},
		tokenizer(src, tokens) {
			return katexTokenizer(src, tokens, true);
		},
		renderer(token) {
			return `${token?.text ?? ''}`;
		}
	};
}
