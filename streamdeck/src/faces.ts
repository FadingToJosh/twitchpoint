import { formatFinishClock, formatMinutes } from "./format.js";
import type { Summary } from "./model.js";
import { locale, t } from "./i18n.js";
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
	return { label: t(LABELS[field]), value: t("Offline"), sub: t(message), tone: "error" };
}

export function loadingFace(field: Field): KeyFace {
	return { label: t(LABELS[field]), value: "…", tone: "muted" };
}

export function faceFor(field: Field, s: Summary, now: Date = new Date()): KeyFace {
	const label = t(LABELS[field]);
	const d = s.drop;
	const noDrop: KeyFace = { label, value: t("No drop"), sub: t("idle"), tone: "muted" };

	switch (field) {
		case "watching": {
			const w = s.watching;
			if (!w) return { label, value: t("Nobody"), tone: "muted" };
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
			if (!d.estimated) return { label, value: t("n/a"), sub: t("update server"), tone: "muted" };
			if (!d.next) return { label, value: t("Last one"), sub: d.unreachable ? t("{n} locked", { n: d.unreachable }) : t("in campaign"), tone: "muted" };
			return {
				label,
				value: d.next.name,
				sub: `${d.next.progress}/${d.next.required}m`,
				progress: d.next.required > 0 ? d.next.progress / d.next.required : 0,
			};
		}
		case "campaign-eta": {
			if (!d) return noDrop;
			const l = d.estimated ? label : t("This drop");
			const left = d.campaign_remaining_minutes;
			if (left <= 0) return { label: l, value: t("Done"), sub: d.game };
			if (d.finishes_after_campaign_end) return { label: l, value: formatMinutes(left), sub: t("ends before!"), tone: "warn" };
			return { label: l, value: formatMinutes(left), sub: `≈ ${formatFinishClock(left, now, locale())}` };
		}
		case "next-game": {
			const g = s.next_game;
			if (!g) return { label, value: t("No other campaigns"), tone: "muted" };
			const rank = g.rank ? ` · #${g.rank}` : "";
			if (g.source === "queue") return { label, value: g.game, sub: `${t("queued")}${rank}` };
			return { label, value: g.game, sub: `${t("nobody live")}${rank}`, tone: "muted" };
		}
	}
}
