// Web demo entry: the real plugin, started the same way Stream Deck starts it.
// The demo page answers the plugin's fetch() calls with a pretend Twitchpoint server.
import "../../src/plugin";

export { host } from "./sdk-shim";
export { setLanguage } from "../../src/i18n";
export { RUNTIME } from "../../src/strings";
