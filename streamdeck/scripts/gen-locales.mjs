// Writes <lang>.json (Stream Deck manifest localizations) from i18n/manifest.json.
import { readFileSync, writeFileSync } from "node:fs";

const PLUGIN = "com.twitchpoint.streamdeck";
const dir = new URL(`../${PLUGIN}.sdPlugin/`, import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../i18n/manifest.json", import.meta.url), "utf8"));

for (const [lang, m] of Object.entries(manifest)) {
	const out = { Name: "Twitchpoint", Description: m.Description };
	for (const [id, [name, tip]] of Object.entries(m)) {
		if (!Array.isArray(m[id])) continue;
		out[`${PLUGIN}.${id}`] = { Name: name, Tooltip: `${tip} ${m.Refresh}` };
	}
	writeFileSync(new URL(`${lang}.json`, dir), JSON.stringify(out, null, "\t") + "\n");
}
console.log(`wrote ${Object.keys(manifest).length} locale files`);
