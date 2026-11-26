/**
 * Renders a 144x144 key face as SVG. Stream Deck scales it down for the
 * 72x72 keys; drawing at 144 keeps text sharp on the XL / MK.2 @2x keys.
 */

export type KeyFace = {
	label: string; // small header, e.g. "DROP"
	value: string; // main text, wrapped to fit
	sub?: string; // footer line
	progress?: number; // 0..1, draws a bar above the footer
	tone?: "normal" | "warn" | "muted" | "error";
};

const SIZE = 144;
const COLORS = {
	bg: "#18181b",
	label: "#a1a1aa",
	text: "#fafafa",
	accent: "#9146ff",
	track: "#3f3f46",
	warn: "#f59e0b",
	error: "#ef4444",
	muted: "#71717a",
};

export function escapeXml(s: string): string {
	return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/**
 * Greedy word wrap into at most `maxLines` lines of `maxChars` characters.
 * Over-long words are hard-cut; overflow is marked with an ellipsis.
 */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let cur = "";
	let i = 0;
	for (; i < words.length; i++) {
		let w = words[i];
		while (w.length > maxChars) {
			if (cur) {
				lines.push(cur);
				cur = "";
			}
			lines.push(w.slice(0, maxChars));
			w = w.slice(maxChars);
		}
		const next = cur ? `${cur} ${w}` : w;
		if (next.length <= maxChars) {
			cur = next;
		} else {
			lines.push(cur);
			cur = w;
		}
		if (lines.length >= maxLines) break;
	}
	if (cur && lines.length < maxLines) {
		lines.push(cur);
		cur = "";
		i++;
	}
	const truncated = lines.length > maxLines || i < words.length || cur !== "";
	const out = lines.slice(0, maxLines);
	if (truncated && out.length > 0) {
		const last = out[out.length - 1];
		out[out.length - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + "…";
	}
	return out;
}

/** Rough per-glyph advance for bold Arial/Helvetica, in em. Good enough to pick a size. */
function glyphEm(ch: string): number {
	if (ch === " ") return 0.28;
	if ("ijl.,:;'|!I".includes(ch)) return 0.28;
	if ("frt()-/1".includes(ch)) return 0.37;
	if ("mwMW".includes(ch)) return 0.88;
	if (/[0-9]/.test(ch)) return 0.56;
	if (/[A-Z]/.test(ch)) return 0.72;
	if (/[a-z]/.test(ch)) return 0.58;
	if (ch.codePointAt(0)! >= 0x2e80) return 1.0; // CJK / kana / hangul: full width
	return 0.7; // symbols and accented letters: err wide
}

export function textWidth(text: string, size: number): number {
	let em = 0;
	for (const ch of text) em += glyphEm(ch);
	return em * size;
}

const isWide = (ch: string) => ch.codePointAt(0)! >= 0x2e80;

/**
 * Splits text into breakable tokens. Latin words break at spaces; CJK text
 * has no spaces, so every wide character is its own token and lines may break
 * between any two of them. `space` says whether a space precedes the token.
 */
function tokenize(text: string): { text: string; space: boolean }[] {
	const out: { text: string; space: boolean }[] = [];
	for (const word of text.trim().split(/\s+/).filter(Boolean)) {
		let buf = "";
		let first = true;
		const push = (t: string) => {
			out.push({ text: t, space: first && out.length > 0 });
			first = false;
		};
		for (const ch of word) {
			if (isWide(ch)) {
				if (buf) push(buf);
				buf = "";
				push(ch);
			} else {
				buf += ch;
			}
		}
		if (buf) push(buf);
	}
	return out;
}

/**
 * Word wrap by measured width. Returns null if any single word is wider than
 * the line or the text needs more than `maxLines` lines, so the caller can try
 * a smaller size instead of chopping a word in half.
 */
export function wrapWords(text: string, size: number, maxWidth: number, maxLines: number): string[] | null {
	const lines: string[] = [];
	let cur = "";
	for (const tok of tokenize(text)) {
		if (textWidth(tok.text, size) > maxWidth) return null;
		const next = cur ? `${cur}${tok.space ? " " : ""}${tok.text}` : tok.text;
		if (textWidth(next, size) <= maxWidth) {
			cur = next;
		} else {
			lines.push(cur);
			cur = tok.text;
		}
	}
	if (cur) lines.push(cur);
	return lines.length <= maxLines ? lines : null;
}

/** Last resort: hard-cut by width and end with an ellipsis. */
function cutToWidth(text: string, size: number, maxWidth: number, maxLines: number): string[] {
	const lines: string[] = [];
	let cur = "";
	for (const ch of text.trim()) {
		if (textWidth(cur + ch, size) > maxWidth) {
			lines.push(cur.trimEnd());
			cur = ch.trim();
			if (lines.length === maxLines) break;
		} else {
			cur += ch;
		}
	}
	if (lines.length < maxLines && cur) return [...lines, cur];
	const last = lines[maxLines - 1] ?? "";
	lines[maxLines - 1] = (textWidth(last + "…", size) > maxWidth ? [...last].slice(0, -1).join("") : last) + "…";
	return lines.slice(0, maxLines);
}

const MAX_TEXT_WIDTH = SIZE - 14;
// Smallest size still readable on a 72px key from arm's length. Below this we
// truncate with an ellipsis rather than shrink further.
const MIN_SIZE = 18;

/** Biggest font size at which the whole value fits without splitting a word. */
function layoutValue(value: string, bandHeight: number): { size: number; lines: string[] } {
	for (const size of [40, 34, 30, 26, 23, 20, MIN_SIZE]) {
		const maxLines = Math.min(4, Math.floor(bandHeight / (size * 1.1)));
		const lines = wrapWords(value, size, MAX_TEXT_WIDTH, maxLines);
		if (lines) return { size, lines };
	}
	const maxLines = Math.min(4, Math.floor(bandHeight / (MIN_SIZE * 1.1)));
	return { size: MIN_SIZE, lines: cutToWidth(value, MIN_SIZE, MAX_TEXT_WIDTH, maxLines) };
}

/** Header line: shrinks (and drops letter-spacing) until it fits the key. */
function labelSvg(label: string): string {
	const text = label.toUpperCase();
	const n = [...text].length;
	let size = 15;
	let spacing = 1.5;
	const width = () => textWidth(text, size) + spacing * (n - 1);
	while (width() > MAX_TEXT_WIDTH && size > 10) {
		if (spacing > 0) spacing = Math.max(0, spacing - 0.5);
		else size -= 1;
	}
	return `<text x="72" y="24" font-size="${size}" font-weight="700" letter-spacing="${spacing}" fill="${COLORS.label}" text-anchor="middle">${escapeXml(text)}</text>`;
}

export function renderKey(face: KeyFace): string {
	const tone = face.tone ?? "normal";
	const valueColor = tone === "error" ? COLORS.error : tone === "muted" ? COLORS.muted : COLORS.text;
	const barColor = tone === "warn" ? COLORS.warn : COLORS.accent;

	const hasBar = face.progress !== undefined;
	// Vertical band between header (ends ~30) and footer (starts ~114, or ~102 with bar).
	const top = 32;
	const bottom = hasBar ? 102 : 114;
	const { size, lines } = layoutValue(face.value, bottom - top);
	const lineH = size * 1.1;
	const blockH = lines.length * lineH;
	const firstBaseline = top + (bottom - top - blockH) / 2 + size * 0.85;

	const text = lines
		.map(
			(l, i) =>
				`<text x="72" y="${(firstBaseline + i * lineH).toFixed(1)}" font-size="${size}" font-weight="700" fill="${valueColor}" text-anchor="middle">${escapeXml(l)}</text>`,
		)
		.join("");

	let bar = "";
	if (hasBar) {
		const p = Math.max(0, Math.min(1, face.progress ?? 0));
		bar =
			`<rect x="12" y="108" width="120" height="8" rx="4" fill="${COLORS.track}"/>` +
			(p > 0 ? `<rect x="12" y="108" width="${(120 * p).toFixed(1)}" height="8" rx="4" fill="${barColor}"/>` : "");
	}

	const sub = face.sub
		? `<text x="72" y="${hasBar ? 136 : 132}" font-size="16" fill="${tone === "warn" ? COLORS.warn : COLORS.label}" text-anchor="middle">${escapeXml(wrap(face.sub, 15, 1)[0] ?? "")}</text>`
		: "";

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" font-family="Arial, Helvetica, sans-serif">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${COLORS.bg}"/>` +
		`<rect width="${SIZE}" height="4" fill="${tone === "error" ? COLORS.error : COLORS.accent}"/>` +
		labelSvg(face.label) +
		text +
		bar +
		sub +
		`</svg>`
	);
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
