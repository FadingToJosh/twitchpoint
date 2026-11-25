import streamDeck, { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { errorFace, faceFor, loadingFace, type Field } from "./faces.js";
import type { Poller, PollState } from "./poller.js";
import { renderKey, toDataUrl } from "./render.js";

type Settings = Record<string, never>;

let poller: Poller | undefined;
const registered: TwitchpointAction[] = [];

export function attachPoller(p: Poller): void {
	poller = p;
}

/** Re-renders every visible key from the given state. */
export function renderAll(state: PollState): void {
	for (const a of registered) a.renderVisible(state);
}

function visibleCount(): number {
	return registered.reduce((n, a) => n + [...a.actions].length, 0);
}

abstract class TwitchpointAction extends SingletonAction<Settings> {
	abstract readonly field: Field;

	constructor() {
		super();
		registered.push(this);
	}

	private image(state: PollState): string {
		const face =
			state.kind === "ok"
				? faceFor(this.field, state.summary)
				: state.kind === "error"
					? errorFace(this.field, state.message)
					: loadingFace(this.field);
		return toDataUrl(renderKey(face));
	}

	renderVisible(state: PollState): void {
		const img = this.image(state);
		for (const a of this.actions) {
			if (a.isKey()) void a.setImage(img);
		}
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!poller) return;
		if (ev.action.isKey()) {
			await ev.action.setTitle("");
			await ev.action.setImage(this.image(poller.state));
		}
		poller.start();
	}

	override onWillDisappear(_ev: WillDisappearEvent<Settings>): void {
		// Stop polling when no Twitchpoint key is on screen (other page/profile).
		// The SDK removes the disappearing action after this handler runs.
		setTimeout(() => {
			if (visibleCount() === 0) poller?.stop();
		}, 0);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		if (!poller) return;
		await poller.refreshNow();
		if (poller.state.kind === "error") {
			await ev.action.showAlert();
			streamDeck.logger.warn(`refresh failed: ${poller.state.message} (${poller.baseUrl})`);
		}
	}
}

@action({ UUID: "com.fadingtojosh.twitchpoint.watching" })
export class WatchingAction extends TwitchpointAction {
	readonly field = "watching" as const;
}

@action({ UUID: "com.fadingtojosh.twitchpoint.drop-progress" })
export class DropProgressAction extends TwitchpointAction {
	readonly field = "drop-progress" as const;
}

@action({ UUID: "com.fadingtojosh.twitchpoint.drop-position" })
export class DropPositionAction extends TwitchpointAction {
	readonly field = "drop-position" as const;
}

@action({ UUID: "com.fadingtojosh.twitchpoint.next-drop" })
export class NextDropAction extends TwitchpointAction {
	readonly field = "next-drop" as const;
}

@action({ UUID: "com.fadingtojosh.twitchpoint.campaign-eta" })
export class CampaignEtaAction extends TwitchpointAction {
	readonly field = "campaign-eta" as const;
}

@action({ UUID: "com.fadingtojosh.twitchpoint.next-game" })
export class NextGameAction extends TwitchpointAction {
	readonly field = "next-game" as const;
}
