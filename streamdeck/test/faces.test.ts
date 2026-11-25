import assert from "node:assert/strict";
import { test } from "node:test";

import { faceFor } from "../src/faces.js";
import { formatMinutes } from "../src/format.js";
import { summaryFromLegacy, type Summary } from "../src/model.js";
import { renderKey, wrap } from "../src/render.js";

const summary: Summary = {
	version: "test",
	generated_at: "2026-11-25T12:00:00Z",
	watching: { login: "bob", display_name: "Bob", game: "Rust", is_drop_target: true },
	also_watching: ["Alice"],
	drop: {
		campaign: "Season Drops",
		game: "Rust",
		channel: "bob",
		name: "Skin 4",
		progress: 56,
		required: 120,
		percent: 46,
		position: 4,
		total: 5,
		claimed: 3,
		next: { id: "d5", name: "Skin 5", progress: 56, required: 240, finish_in_minutes: 184 },
		campaign_remaining_minutes: 184,
		campaign_ends_at: "2026-11-27T12:00:00Z",
		finishes_after_campaign_end: false,
		unreachable: 0,
		estimated: true,
	},
	next_game: { game: "Valorant", campaign: "Valo Event", source: "queue", rank: 2 },
};

test("faces show the requested numbers", () => {
	assert.equal(faceFor("drop-progress", summary).value, "56/120");
	assert.equal(faceFor("drop-position", summary).value, "4/5");
	assert.equal(faceFor("next-drop", summary).value, "Skin 5");
	assert.equal(faceFor("campaign-eta", summary).value, "3h 04m");
	assert.equal(faceFor("watching", summary).value, "Bob");
	assert.equal(faceFor("next-game", summary).value, "Valorant");
});

test("campaign ETA warns when it can't finish in time", () => {
	const s = structuredClone(summary);
	s.drop!.finishes_after_campaign_end = true;
	const f = faceFor("campaign-eta", s);
	assert.equal(f.tone, "warn");
});

test("legacy fallback is honest about what it can't know", () => {
	const s = summaryFromLegacy(
		[
			{ campaign_name: "C", game_name: "Rust", drop_name: "Skin 4", channel_login: "bob", progress: 56, required: 120, percent: 46, end_at: "2026-11-27T00:00:00Z", status: "ACTIVE", eta_minutes: 64, claimed_drops: 3, watchable_drops: 5 },
			{ campaign_name: "A", game_name: "Apex", drop_name: "", channel_login: "", progress: 0, required: 0, percent: 0, end_at: "2026-11-25T13:00:00Z", status: "QUEUED", eta_minutes: 0 },
			{ campaign_name: "V", game_name: "Valorant", drop_name: "", channel_login: "", progress: 0, required: 0, percent: 0, end_at: "2026-11-29T00:00:00Z", status: "QUEUED", eta_minutes: 0 },
		],
		[
			{ login: "alice", display_name: "Alice", is_watching: true, game_name: "Just Chatting" },
			{ login: "bob", display_name: "Bob", is_watching: true, game_name: "Rust" },
		],
		["Rust", "Valorant", "Apex"],
	);
	assert.equal(s.watching?.login, "bob");
	assert.equal(s.drop?.position, 4);
	assert.equal(s.next_game?.game, "Valorant");
	assert.equal(faceFor("next-drop", s).value, "n/a");
	assert.equal(faceFor("campaign-eta", s).label, "This drop");
});

test("wrap and render", () => {
	assert.deepEqual(wrap("Hello big world", 9, 2), ["Hello big", "world"]);
	assert.equal(wrap("abcdefghijklmnop", 5, 2).at(-1)?.endsWith("…"), true);
	assert.equal(formatMinutes(45), "45m");
	assert.equal(formatMinutes(60 * 26), "1d 2h");
	const svg = renderKey(faceFor("drop-progress", summary));
	assert.match(svg, /56\/120/);
	assert.doesNotMatch(renderKey({ label: "x", value: "<b>&" }), /<b>/);
});

test("polls fast while farming, slow while idle", async () => {
	const { nextDelaySec, DEFAULT_SETTINGS } = await import("../src/poller.js");
	const idle = { ...summary, drop: null };
	assert.equal(nextDelaySec({ kind: "ok", summary, at: new Date() }, DEFAULT_SETTINGS), 60);
	assert.equal(nextDelaySec({ kind: "ok", summary: idle, at: new Date() }, DEFAULT_SETTINGS), 300);
	assert.equal(nextDelaySec({ kind: "error", message: "x", last: summary }, DEFAULT_SETTINGS), 60);
	assert.equal(nextDelaySec({ kind: "error", message: "x" }, DEFAULT_SETTINGS), 300);
	assert.equal(nextDelaySec({ kind: "ok", summary: idle, at: new Date() }, { ...DEFAULT_SETTINGS, idleIntervalSec: 30 }), 60);
});

test("single long words shrink instead of being split", async () => {
	const { wrapWords } = await import("../src/render.js");
	assert.equal(wrapWords("Soulframe", 32, 130, 1), null); // too wide at 32px
	assert.deepEqual(wrapWords("Soulframe", 26, 130, 1), ["Soulframe"]);
	const svg = renderKey({ label: "Next game", value: "Soulframe" });
	assert.match(svg, />Soulframe</);
	assert.match(renderKey({ label: "x", value: "Tom Clancy's Rainbow Six Siege X" }), />Tom Clancy&apos;s</);
});

test("next game only lists games with a real campaign", () => {
	const row = (game: string, status: string, block_reason?: string) => ({
		campaign_name: game, game_name: game, drop_name: "", channel_login: "", progress: 0, required: 0,
		percent: 0, end_at: "2026-11-29T00:00:00Z", status, block_reason, eta_minutes: 0,
	});
	const wanted = ["Soulframe", "Hearthstone", "Apex", "Rust"];
	const active = { ...row("Hearthstone", "ACTIVE"), progress: 14, required: 60 };
	let s = summaryFromLegacy([active], [], wanted);
	assert.equal(s.next_game, null);
	assert.equal(faceFor("next-game", s).value, "No other campaigns");
	s = summaryFromLegacy([active, row("Apex", "BLOCKED", "account not linked"), row("Rust", "IDLE")], [], wanted);
	assert.equal(s.next_game?.game, "Rust");
	assert.equal(faceFor("next-game", s).sub, "nobody live · #4");
});

test("intervals are clamped to their documented ranges", async () => {
	const { clampSec, LIMITS } = await import("../src/poller.js");
	assert.equal(clampSec(5, LIMITS.intervalSec, 60), 15);
	assert.equal(clampSec("999", LIMITS.intervalSec, 60), 300);
	assert.equal(clampSec("90.6", LIMITS.intervalSec, 60), 91);
	assert.equal(clampSec("abc", LIMITS.intervalSec, 60), 60);
	assert.equal(clampSec(undefined, LIMITS.idleIntervalSec, 300), 300);
	assert.equal(clampSec(10, LIMITS.idleIntervalSec, 300), 60);
	assert.equal(clampSec(5000, LIMITS.idleIntervalSec, 300), 1800);
});
