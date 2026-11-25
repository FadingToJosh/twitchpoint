# Twitchpoint for Stream Deck

Six keys that show what your Twitchpoint instance is doing. They refresh every
60 s while a drop is being farmed and every 5 min while nothing is targeted
(both configurable). Pressing any of them refreshes immediately.

| Key | Shows | Example |
| --- | --- | --- |
| **Watching** | Channel holding the drop slot (or the first watched channel) + its game | `xQcOW` / Escape from Tarkov |
| **Drop Progress** | Minutes on the drop being farmed + bar | `56/120` |
| **Drop Position** | Which watch-time drop of the campaign this is | `4/5` |
| **Next Drop** | The drop after this one and its progress | `Weapon Skin` / 56/240m |
| **Campaign ETA** | Watch time until every reachable drop is earned, and the local clock time | `3h 04m` / ≈ 10:47 PM |
| **Next Game** | Next game the farmer will switch to (queued campaign, ranked by your wanted-games order) | `Marvel Rivals` / queued · #2 |

All keys share one HTTP request per interval against `GET /api/streamdeck`.

## Install

**Prebuilt:** double-click `com.fadingtojosh.twitchpoint.streamDeckPlugin`
(from the PR / release). Stream Deck 7.1+ on Windows 10+ or macOS 12+.

**From source:**

```bash
cd streamdeck
npm ci
npm run build
npx streamdeck link com.fadingtojosh.twitchpoint.sdPlugin   # dev install
# or: npm run pack   -> dist/com.fadingtojosh.twitchpoint.streamDeckPlugin
```

Then drag the keys from the **Twitchpoint** category onto your deck. Set the
server URL once in any key's settings (default `http://192.168.68.76:8080`);
it's shared by all keys.

## Server requirements

* Twitchpoint has to be reachable from the PC running Stream Deck, which
  means `"web_bind": "0.0.0.0"` in `config.json` (the default is
  `127.0.0.1`, also inside Docker). If you can open the dashboard from your
  PC's browser, this is already done.
* `/api/streamdeck` only exists in builds from this fork. Against an older
  build the plugin falls back to `/api/drops` + `/api/channels`, but then
  **Next Drop shows `n/a`** and **Campaign ETA only covers the current
  drop** (its label switches to "THIS DROP"), because the old endpoints don't
  expose per-drop data.

## How the numbers are computed

`internal/drops/outlook.go` works from the cached inventory:

* Twitch credits every un-gated drop of a campaign **at the same time**, so
  the campaign ETA is the latest finish across drops, not the sum of the gaps.
  A drop gated behind a precondition only starts once that precondition is
  earned, so chained campaigns *do* add up.
* Live websocket minutes for the current drop are applied to the other
  un-gated drops too, so the ETA moves between inventory refreshes.
* Sub-only drops and drops whose precondition is sub-only are excluded
  (`unreachable` in the JSON). The ETA turns amber with "ends before!" when
  continuous watching would still overrun the campaign's end.
* ETA assumes the farmer stays on this campaign. If a higher-priority game goes
  live, it switches and the ETA is wrong until it comes back. That is a
  limitation of predicting anything here, not a bug.
