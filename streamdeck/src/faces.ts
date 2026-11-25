import { formatFinishClock, formatMinutes } from "./format.js";
import type { Summary } from "./model.js";
import type { KeyFace } from "./render.js";

export type Field = "watching" | "drop-progress" | "drop-position" | "next-drop" | "campaign-eta" | "next-game";

const LABELS: Record<Field, string> = {
	watching: "Watching",
	"drop-progress": "Drop",
	"drop-position": "Campaign",
	"next-drop": "Next drop",
	"campaign-eta": "All drops",
	"next-game": "Next game",
};

export function errorFace(field: Field, message: string): KeyFace {
	return { label: LABELS[field], value: "Offline", sub: message, tone: "error" };
}

export function loadingFace(field: Field): KeyFace {
	return { label: LABELS[field], value: "…", tone: "muted" };
}

export function faceFor(field: Field, s: Summary, now: Date = new Date()): KeyFace {
	const label = LABELS[field];
	const d = s.drop;
	const noDrop: KeyFace = { label, value: "No drop", sub: "idle", tone: "muted" };

	switch (field) {
		case "watching": {
			const w = s.watching;
			if (!w) return { label, value: "Nobody", tone: "muted" };
			return { label, value: w.display_name, sub: w.game || undefined };
		}
		case "drop-progress": {
			if (!d) return noDrop;
			return {
				label,
				value: `${d.progress}/${d.required}`,
				sub: d.name || "min",
				progress: d.required > 0 ? d.progress / d.required : 0,
			};
		}
		case "drop-position": {
			if (!d) return noDrop;
			if (d.total <= 0) return { label, value: "—", sub: d.game };
			return { label, value: `${d.position}/${d.total}`, sub: d.game, progress: d.claimed / d.total };
		}
		case "next-drop": {
			if (!d) return noDrop;
			if (!d.estimated) return { label, value: "n/a", sub: "update server", tone: "muted" };
			if (!d.next) return { label, value: "Last one", sub: d.unreachable ? `${d.unreachable} locked` : "in campaign", tone: "muted" };
			return {
				label,
				value: d.next.name,
				sub: `${d.next.progress}/${d.next.required}m`,
				progress: d.next.required > 0 ? d.next.progress / d.next.required : 0,
			};
		}
		case "campaign-eta": {
			if (!d) return noDrop;
			const l = d.estimated ? label : "This drop";
			const left = d.campaign_remaining_minutes;
			if (left <= 0) return { label: l, value: "Done", sub: d.game };
			if (d.finishes_after_campaign_end) return { label: l, value: formatMinutes(left), sub: "ends before!", tone: "warn" };
			return { label: l, value: formatMinutes(left), sub: `≈ ${formatFinishClock(left, now)}` };
		}
		case "next-game": {
			const g = s.next_game;
			if (!g) return { label, value: "None", sub: "queue empty", tone: "muted" };
			const sub = g.source === "queue" ? (g.rank ? `queued · #${g.rank}` : "queued") : `priority #${g.rank}`;
			return { label, value: g.game, sub, tone: g.source === "queue" ? "normal" : "muted" };
		}
	}
}
