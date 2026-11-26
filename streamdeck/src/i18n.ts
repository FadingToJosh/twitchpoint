import { RUNTIME } from "./strings.js";

let lang = "en";

/** Sets the UI language from Stream Deck (e.g. "de", "zh_CN"). Unknown languages fall back to English. */
export function setLanguage(l: string | undefined): void {
	lang = l && RUNTIME[l] ? l : "en";
}

export function getLanguage(): string {
	return lang;
}

/** BCP 47 tag for Intl formatting, e.g. "zh_CN" -> "zh-CN". */
export function locale(): string {
	return lang.replace("_", "-");
}

/** Translates an English key; `{n}`-style placeholders are filled from `vars`. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
	const s = RUNTIME[lang]?.[key] ?? key;
	return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
