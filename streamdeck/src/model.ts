/**
 * Shape of Twitchpoint's /api/streamdeck response (internal/web/streamdeck.go),
 * plus a fallback that builds the same shape from the older endpoints so the
 * plugin still shows something against a Twitchpoint build that predates
 * /api/streamdeck. The fallback can't know the next drop or the real campaign
 * ETA, because the old endpoints don't expose per-drop data.
 */

export type OutlookDrop = {
	id: string;
	name: string;
	progress: number;
	required: number;
	finish_in_minutes: number;
};

export type Summary = {
	version: string;
	generated_at: string;
	watching: {
		login: string;
		display_name: string;
		game: string;
		is_drop_target: boolean;
	} | null;
	also_watching: string[];
	drop: {
		campaign: string;
		game: string;
		channel: string;
		name: string;
		progress: number;
		required: number;
		percent: number;
		position: number;
		total: number;
		claimed: number;
		next: OutlookDrop | null;
		campaign_remaining_minutes: number;
		campaign_ends_at: string;
		finishes_after_campaign_end: boolean;
		unreachable: number;
		/** false = old Twitchpoint build: no next drop, ETA covers only the current drop. */
		estimated: boolean;
	} | null;
	next_game: {
		game: string;
		campaign?: string;
		/** queue = a channel is live, farmer can switch now; offline = campaign running, nobody streaming. */
		source: "queue" | "offline";
		rank: number;
	} | null;
};

/** Row from /api/drops (internal/drops/rows.go). Only the fields we use. */
export type DropRow = {
	campaign_name: string;
	game_name: string;
	drop_name: string;
	channel_login: string;
	progress: number;
	required: number;
	percent: number;
	end_at: string;
	status: string;
	block_reason?: string;
	eta_minutes: number;
	claimed_drops?: number;
	watchable_drops?: number;
};

/** Row from /api/channels. */
export type ChannelRow = {
	login: string;
	display_name: string;
	is_watching: boolean;
	game_name: string;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Builds a Summary from /api/drops, /api/channels and /api/wanted_games. */
export function summaryFromLegacy(rows: DropRow[], channels: ChannelRow[], wanted: string[]): Summary {
	const active = rows.find((r) => r.status === "ACTIVE") ?? null;
	const rank = new Map<string, number>();
	wanted.forEach((g, i) => {
		if (!rank.has(norm(g))) rank.set(norm(g), i + 1);
	});
	const rankOf = (g: string) => rank.get(norm(g)) ?? 0;

	const watched = channels.filter((c) => c.is_watching);
	const target = active ? watched.find((c) => norm(c.login) === norm(active.channel_login)) : undefined;
	const primary = target ?? watched[0];

	let drop: Summary["drop"] = null;
	if (active) {
		const total = active.watchable_drops ?? 0;
		const claimed = active.claimed_drops ?? 0;
		drop = {
			campaign: active.campaign_name,
			game: active.game_name,
			channel: active.channel_login,
			name: active.drop_name,
			progress: active.progress,
			required: active.required,
			percent: active.percent,
			position: Math.min(claimed + 1, total),
			total,
			claimed,
			next: null,
			campaign_remaining_minutes: active.eta_minutes,
			campaign_ends_at: active.end_at,
			finishes_after_campaign_end: false,
			unreachable: 0,
			estimated: false,
		};
	}

	// Only games with a real campaign: QUEUED (someone is live) beats IDLE
	// (campaign exists, nobody streaming). Rows with a block_reason (account
	// not linked, everything claimed, filtered) are skipped.
	const curGame = active ? norm(active.game_name) : "";
	const rankOrLast = (g: string) => rankOf(g) || wanted.length + 1;
	const pickBest = (status: string) =>
		rows
			.filter((r) => r.status === status && !r.block_reason && norm(r.game_name) !== curGame)
			.sort((a, b) => rankOrLast(a.game_name) - rankOrLast(b.game_name) || Date.parse(a.end_at) - Date.parse(b.end_at))[0];

	let nextGame: Summary["next_game"] = null;
	const queued = pickBest("QUEUED");
	const waiting = queued ? undefined : pickBest("IDLE");
	const best = queued ?? waiting;
	if (best) {
		nextGame = { game: best.game_name, campaign: best.campaign_name, source: queued ? "queue" : "offline", rank: rankOf(best.game_name) };
	}

	return {
		version: "legacy",
		generated_at: new Date().toISOString(),
		watching: primary
			? {
					login: primary.login,
					display_name: primary.display_name || primary.login,
					game: primary.game_name,
					is_drop_target: primary === target,
				}
			: null,
		also_watching: watched.filter((c) => c !== primary).map((c) => c.display_name || c.login),
		drop,
		next_game: nextGame,
	};
}
