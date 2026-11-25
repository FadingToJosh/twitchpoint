import { summaryFromLegacy, type ChannelRow, type DropRow, type Summary } from "./model.js";

export type PollerSettings = {
	baseUrl: string;
	intervalSec: number;
};

export type PollState =
	| { kind: "loading" }
	| { kind: "ok"; summary: Summary; at: Date }
	| { kind: "error"; message: string; last?: Summary };

export const DEFAULT_SETTINGS: PollerSettings = {
	baseUrl: "http://192.168.68.76:8080",
	intervalSec: 60,
};

const TIMEOUT_MS = 5000;
// Keep showing the last good data through brief blips (Pi busy, Wi-Fi hiccup)
// instead of flashing "Offline" on every missed poll.
const FAILURES_BEFORE_ERROR = 3;

function normalizeBaseUrl(u: string): string {
	let s = (u || "").trim();
	if (!s) return DEFAULT_SETTINGS.baseUrl;
	if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
	return s.replace(/\/+$/, "");
}

async function getJson<T>(url: string): Promise<{ status: number; body?: T }> {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
	if (!res.ok) return { status: res.status };
	return { status: res.status, body: (await res.json()) as T };
}

/** Fetches /api/streamdeck, falling back to the old endpoints on 404. */
export async function fetchSummary(baseUrl: string): Promise<Summary> {
	const base = normalizeBaseUrl(baseUrl);
	const r = await getJson<Summary>(`${base}/api/streamdeck`);
	if (r.body) return r.body;
	if (r.status !== 404) throw new Error(`HTTP ${r.status}`);

	const [drops, channels, wanted] = await Promise.all([
		getJson<DropRow[]>(`${base}/api/drops`),
		getJson<ChannelRow[]>(`${base}/api/channels`),
		getJson<{ games: string[] }>(`${base}/api/wanted_games`),
	]);
	if (!drops.body || !channels.body) throw new Error(`HTTP ${drops.status}/${channels.status}`);
	return summaryFromLegacy(drops.body, channels.body, wanted.body?.games ?? []);
}

function describe(err: unknown): string {
	if (err instanceof Error) {
		if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
		const code = (err as { cause?: { code?: string } }).cause?.code;
		if (code === "ECONNREFUSED") return "refused";
		if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "unreachable";
		if (code === "ENOTFOUND") return "bad host";
		return err.message.slice(0, 20);
	}
	return "error";
}

/**
 * One shared poller for every key: N keys on the deck cost one request per
 * interval, not N.
 */
export class Poller {
	private settings: PollerSettings = { ...DEFAULT_SETTINGS };
	private timer: NodeJS.Timeout | undefined;
	private inFlight: Promise<void> | undefined;
	private failures = 0;
	private lastGood: Summary | undefined;
	state: PollState = { kind: "loading" };

	constructor(private readonly onUpdate: (state: PollState) => void) {}

	configure(partial: Partial<PollerSettings>): void {
		const next: PollerSettings = {
			baseUrl: normalizeBaseUrl(partial.baseUrl ?? this.settings.baseUrl),
			intervalSec: Math.max(15, Number(partial.intervalSec) || this.settings.intervalSec || DEFAULT_SETTINGS.intervalSec),
		};
		const changed = next.baseUrl !== this.settings.baseUrl || next.intervalSec !== this.settings.intervalSec;
		this.settings = next;
		if (changed && this.timer) {
			this.failures = 0;
			this.lastGood = undefined;
			void this.refreshNow();
		}
	}

	get baseUrl(): string {
		return this.settings.baseUrl;
	}

	start(): void {
		if (this.timer) return;
		this.schedule(0);
	}

	stop(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	/** Polls immediately (e.g. on key press) and restarts the interval. */
	async refreshNow(): Promise<void> {
		clearTimeout(this.timer);
		await this.tick();
	}

	private schedule(ms: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.tick(), ms);
	}

	private async tick(): Promise<void> {
		if (!this.inFlight) {
			this.inFlight = (async () => {
				try {
					const summary = await fetchSummary(this.settings.baseUrl);
					this.failures = 0;
					this.lastGood = summary;
					this.state = { kind: "ok", summary, at: new Date() };
				} catch (err) {
					this.failures++;
					if (!this.lastGood || this.failures >= FAILURES_BEFORE_ERROR) {
						this.state = { kind: "error", message: describe(err), last: this.lastGood };
					}
				} finally {
					this.inFlight = undefined;
				}
				this.onUpdate(this.state);
			})();
		}
		await this.inFlight;
		this.schedule(this.settings.intervalSec * 1000);
	}
}
