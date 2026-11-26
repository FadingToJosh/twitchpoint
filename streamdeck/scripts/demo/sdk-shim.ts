/**
 * Browser stand-in for @elgato/streamdeck, used only by the web demo build (scripts/demo/build.mjs).
 *
 * The plugin's own code runs unchanged on top of it: actions are registered the same way, and the
 * demo page "places" them on a fake deck and sends them the same events Stream Deck would
 * (willAppear, keyDown/keyUp, dialDown, ...). Whatever the plugin draws comes back through the
 * callbacks the page passes to host.place(). Global settings live in localStorage.
 */

type Json = Record<string, any>;
type Controller = "Keypad" | "Encoder" | "Neo";

export type PlaceOptions = {
	uuid: string;
	controller?: Controller;
	settings?: Json;
	onImage?(image: string | undefined): void;
	onTitle?(title: string | undefined): void;
	onFeedback?(feedback: Json): void;
	onLayout?(layout: string): void;
	onAlert?(kind: "alert" | "ok"): void;
};

let nextId = 1;
const registered = new Map<string, SingletonAction>();
const visible = new Map<SingletonAction, Set<DemoAction>>();
const globalListeners = new Set<(ev: { settings: Json }) => void>();
const storeKey = () => `sd-demo:${host.storageKey}`;

function readGlobals(): Json {
	try {
		return JSON.parse(localStorage.getItem(storeKey()) ?? "{}") ?? {};
	} catch {
		return {};
	}
}
function writeGlobals(s: Json): void {
	try {
		localStorage.setItem(storeKey(), JSON.stringify(s));
	} catch {
		/* private mode: progress just isn't kept */
	}
}

class DemoAction {
	readonly id = `demo-${nextId++}`;
	readonly manifestId: string;
	controllerType: Controller;
	settings: Json;
	constructor(private o: PlaceOptions) {
		this.manifestId = o.uuid;
		this.controllerType = o.controller ?? "Keypad";
		this.settings = { ...(o.settings ?? {}) };
	}
	get coordinates() {
		return { column: 0, row: 0 };
	}
	isKey() { return this.controllerType === "Keypad"; }
	isDial() { return this.controllerType === "Encoder"; }
	isNeoInfobar() { return this.controllerType === "Neo"; }
	isInMultiAction() { return false; }
	async setImage(image?: string) { this.o.onImage?.(image); }
	async setTitle(title?: string) { this.o.onTitle?.(title); }
	async setState() {}
	async setFeedback(f: Json) { this.o.onFeedback?.(f); }
	async setFeedbackLayout(l: string) { this.o.onLayout?.(l); }
	async setTriggerDescription() {}
	async showAlert() { this.o.onAlert?.("alert"); }
	async showOk() { this.o.onAlert?.("ok"); }
	async getSettings() { return this.settings; }
	async setSettings(s: Json) { this.settings = { ...s }; }
}

export class SingletonAction<_T = any> {
	// manifestId comes from @action() on the prototype; declaring it as a field here would shadow it.
	declare manifestId?: string;
	get actions(): DemoAction[] {
		return [...(visible.get(this) ?? [])];
	}
}

/** Works as both a TC39 decorator and a legacy TypeScript decorator. */
export function action(opts: { UUID: string }) {
	return (target: any, _context?: unknown) => {
		target.prototype.manifestId = opts.UUID;
		return target;
	};
}

const noop = () => {};
const logger = {
	setLevel: noop,
	trace: noop,
	debug: noop,
	info: (...a: unknown[]) => console.info("[plugin]", ...a),
	warn: (...a: unknown[]) => console.warn("[plugin]", ...a),
	error: (...a: unknown[]) => console.error("[plugin]", ...a),
	createScope() { return logger; },
};

const streamDeck = {
	logger,
	info: { application: { language: "en", platform: "windows", version: "7.6.0" }, plugin: { version: "demo" } },
	actions: {
		registerAction(a: SingletonAction) {
			if (a.manifestId) registered.set(a.manifestId, a);
		},
	},
	settings: {
		async getGlobalSettings() { return readGlobals(); },
		async setGlobalSettings(s: Json) {
			writeGlobals(s);
			host.onSaved(s);
		},
		onDidReceiveGlobalSettings(fn: (ev: { settings: Json }) => void) {
			globalListeners.add(fn);
			return { dispose: () => globalListeners.delete(fn) };
		},
		onDidReceiveSettings: noop,
	},
	system: {
		async openUrl(url: string) { host.onOpenUrl(url); },
		onApplicationDidLaunch: noop,
		onApplicationDidTerminate: noop,
		onSystemDidWakeUp: noop,
	},
	ui: {
		async sendToPropertyInspector() {},
		onSendToPlugin: noop,
		current: undefined,
	},
	devices: { [Symbol.iterator]: function* () {} },
	async connect() {},
};
export default streamDeck;

/** What the demo page uses to drive the plugin. */
export const host = {
	/** Namespaces saved progress per plugin. */
	storageKey: "plugin",
	onOpenUrl: (url: string) => console.info("openUrl", url),
	/** Called whenever the plugin saves its global settings. */
	onSaved: (_settings: Json) => {},
	registered,

	/** Puts an action on the fake deck and sends willAppear. */
	place(o: PlaceOptions) {
		const instance = registered.get(o.uuid);
		if (!instance) throw new Error(`No action registered for ${o.uuid}`);
		const a = new DemoAction(o);
		if (!visible.has(instance)) visible.set(instance, new Set());
		visible.get(instance)!.add(a);
		const inst = instance as any;
		const ev = (extra: Json = {}) => ({
			action: a,
			payload: { settings: a.settings, controller: a.controllerType, coordinates: a.coordinates, isInMultiAction: false, ...extra },
		});
		const call = (name: string, extra?: Json) => {
			try {
				const r = inst[name]?.(ev(extra));
				if (r && typeof r.catch === "function") r.catch((e: unknown) => console.error(e));
			} catch (e) {
				console.error(e);
			}
		};
		call("onWillAppear");
		return {
			id: a.id,
			keyDown: () => call("onKeyDown"),
			keyUp: () => call("onKeyUp"),
			dialDown: () => call("onDialDown"),
			dialUp: () => call("onDialUp"),
			rotate: (ticks: number) => call("onDialRotate", { ticks, pressed: false }),
			touchTap: (hold = false) => call("onTouchTap", { hold, tapPos: [100, 50] }),
			setSettings(s: Json) {
				a.settings = { ...s };
				call("onDidReceiveSettings");
			},
			remove() {
				call("onWillDisappear");
				visible.get(instance)?.delete(a);
			},
		};
	},

	setGlobalSettings(s: Json) {
		writeGlobals(s);
		for (const fn of globalListeners) fn({ settings: s });
	},
	resetSaved() {
		try {
			localStorage.removeItem(storeKey());
		} catch {
			/* ignore */
		}
	},
};

// Type-only names some plugins import; values are never used at runtime.
export type KeyDownEvent<T = any> = any;
export type KeyUpEvent<T = any> = any;
export type WillAppearEvent<T = any> = any;
export type WillDisappearEvent<T = any> = any;
export type DialDownEvent<T = any> = any;
export type DialUpEvent<T = any> = any;
export type DialRotateEvent<T = any> = any;
export type TouchTapEvent<T = any> = any;
export type DidReceiveSettingsEvent<T = any> = any;
export type SendToPluginEvent<T = any, U = any> = any;
export type PropertyInspectorDidAppearEvent<T = any> = any;
