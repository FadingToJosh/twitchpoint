/** "184" -> "3h 04m", "45" -> "45m". */
export function formatMinutes(min: number): string {
	if (!Number.isFinite(min) || min <= 0) return "0m";
	const h = Math.floor(min / 60);
	const m = Math.round(min % 60);
	if (h === 0) return `${m}m`;
	if (h >= 24) {
		const d = Math.floor(h / 24);
		return `${d}d ${h % 24}h`;
	}
	return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Local wall-clock time `min` minutes after `now`, e.g. "22:35" or "Thu 09:10". */
export function formatFinishClock(min: number, now: Date = new Date()): string {
	const t = new Date(now.getTime() + min * 60_000);
	const hhmm = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const sameDay = t.toDateString() === now.toDateString();
	return sameDay ? hhmm : `${t.toLocaleDateString([], { weekday: "short" })} ${hhmm}`;
}
