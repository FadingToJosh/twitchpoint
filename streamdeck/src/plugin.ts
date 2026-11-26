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
import { setLanguage } from "./i18n.js";
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

// Registration info comes from the launch arguments, so the language is known before connecting.
setLanguage(streamDeck.info.application.language);
await streamDeck.connect();
poller.configure(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
