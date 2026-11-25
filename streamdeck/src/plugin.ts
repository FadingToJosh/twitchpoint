import streamDeck from "@elgato/streamdeck";

import {
	attachPoller,
	CampaignEtaAction,
	DropPositionAction,
	DropProgressAction,
	NextDropAction,
	NextGameAction,
	renderAll,
	WatchingAction,
} from "./actions.js";
import { Poller, type PollerSettings } from "./poller.js";

type GlobalSettings = Partial<PollerSettings> & { [key: string]: string | number | undefined };

streamDeck.logger.setLevel("info");

const poller = new Poller(renderAll);
attachPoller(poller);

streamDeck.actions.registerAction(new WatchingAction());
streamDeck.actions.registerAction(new DropProgressAction());
streamDeck.actions.registerAction(new DropPositionAction());
streamDeck.actions.registerAction(new NextDropAction());
streamDeck.actions.registerAction(new CampaignEtaAction());
streamDeck.actions.registerAction(new NextGameAction());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	poller.configure(ev.settings);
});

await streamDeck.connect();
poller.configure(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
