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
