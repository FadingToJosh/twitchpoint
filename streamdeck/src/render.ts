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

/** Picks the biggest font size whose wrap fits the whole text, else the smallest. */
function layoutValue(value: string, bandHeight: number): { size: number; lines: string[] } {
	// Conservative average glyph width for bold sans (caps run wide): ~0.66em.
	const charsAt = (size: number) => Math.max(1, Math.floor((SIZE - 14) / (size * 0.66)));
	const options = [
		{ size: 40, lines: 1 },
		{ size: 32, lines: 1 },
		{ size: 26, lines: 2 },
		{ size: 21, lines: 3 },
		{ size: 17, lines: 4 },
	].filter((o) => o.lines * o.size * 1.1 <= bandHeight);
	for (const o of options) {
		const lines = wrap(value, charsAt(o.size), o.lines);
		if (!lines.some((l) => l.endsWith("…"))) return { size: o.size, lines };
	}
	const last = options[options.length - 1];
	return { size: last.size, lines: wrap(value, charsAt(last.size), last.lines) };
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
		`<text x="72" y="24" font-size="15" font-weight="700" letter-spacing="1.5" fill="${COLORS.label}" text-anchor="middle">${escapeXml(face.label.toUpperCase())}</text>` +
		text +
		bar +
		sub +
		`</svg>`
	);
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
