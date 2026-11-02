# Manual screen-reader pass: NVDA on Windows

Automated tools (axe, the contrast sweep, the live-region and status-name
checks in `pnpm a11y`) catch only part of what makes an interface usable
without sight. This pass has to be done by a person listening.

**Status: not yet run.** Record the date, versions and what NVDA actually said
in the table. Wherever it differs from the expected speech, write down exactly
what you heard.

## Setup (about 10 minutes)

1. Install NVDA (free) from <https://www.nvaccess.org/download/>.
2. Run the app: `pnpm --filter @fleet/web build`, then
   `pnpm --filter @fleet/web start -p 3100`. Open
   <http://127.0.0.1:3100/app> in Chrome.
3. Start NVDA (Ctrl+Alt+N).
   - The NVDA key is **Insert**, or Caps Lock if you chose that.
   - **Browse mode** reads the page, and letters jump between elements.
   - **Focus mode** sends keys to the app. NVDA switches to it automatically in
     search boxes and lists.
   - NVDA+Space toggles between the two.
4. Stop the mouse from reading things while you work: NVDA menu → Preferences →
   Settings → Mouse → untick "Enable mouse tracking".

Tested with: NVDA version ______ · Chrome version ______ · Date ______ ·
Tester ______

## The pass

| # | Do this | NVDA should say (roughly) | What it said | OK? |
| --- | --- | --- | --- | --- |
| 1 | Load the page, wait 5 s, then press NVDA+F7 → Landmarks | Landmarks: banner, complementary, main; regions "Fleet" and "Map of the fleet" | | |
| 2 | Listen for 30 s without touching anything | "Connection live" **once**, then **silence**. Anything read repeatedly (counts, "as of…") is a failure | | |
| 3 | Press H | "Fleet Live Demo, heading level 1" | | |
| 4 | Ctrl+Home, then Tab once | "Skip to the side panel, link" | | |
| 5 | Press Enter, then Tab twice | "Trucks, tab, selected", then "Search trucks by plate or driver, edit, search" (focus mode) | | |
| 6 | Type `kja`, then pause 1 s | After the pause: "*N* trucks shown" | | |
| 7 | Press Enter | "*plate* selected, Moving." (or its status). The details panel opens | | |
| 8 | Press Escape, then Tab until the list | "Trucks, list box". The first truck is read with plate, driver, **status in words** and speed, and "1 of *N*" | | |
| 9 | Press Down arrow twice | Each truck is read, with its position ("3 of *N*") | | |
| 10 | Wait 10 s on one truck | Nothing is read. The list re-sorts live, but the highlighted truck must not change under you | | |
| 11 | Press Enter | "*plate* selected, *status*." | | |
| 12 | Press NVDA+Space (browse mode), then press H until the truck's plate | "*plate*, heading level 2", then driver, Status, Speed, Heading, Last report | | |
| 13 | Tab to the follow button | "Follow on map, toggle button, not pressed" | | |
| 14 | Press Space | "pressed". The map now follows the truck | | |
| 15 | Tab to "Close truck details", press Enter | Focus lands on the list: "Trucks, list box…". **Not** "Fleet Live" or the top of the page | | |
| 16 | Tab to the "Moving" filter button, press Space | "Moving *N*, toggle button, not pressed", then after a pause "*N* trucks shown" | | |
| 17 | Tab to Sort | "Sort, combo box, Needs attention" | | |
| 18 | In browse mode, press F | **NVDA's own quick navigation** (next form field). Not the app's follow shortcut. If it follows instead, the shortcut is stealing a screen-reader key | | |
| 19 | Tab to "Single-key shortcuts: on", press Space | "Single-key shortcuts: off, toggle button, not pressed" | | |
| 20 | Tab into the map region | "Map of the fleet, region", then the zoom buttons. The canvas itself isn't navigable: the list is the accessible way to the trucks | | |

### Alerts and zones (Layer 8b)

Open <http://127.0.0.1:3100/app?at=2230>. The demo then starts at 22:30 Lagos
time, when speeding happens, so alerts arrive within a minute.

| # | Do this | NVDA should say (roughly) | What it said | OK? |
| --- | --- | --- | --- | --- |
| 21 | Wait up to a minute without touching anything | "Alert: *plate* speeding, up to *N* km/h." or "*N* new alerts. Latest: …". At most one such sentence every 5 seconds, never a stream | | |
| 22 | Tab to the tab bar; press Right arrow | "Alerts, *N* new, tab, selected, 2 of 3" | | |
| 23 | Tab into the panel | "*N* open: *a* active, *e* ended", then "Show truck, button", described by the alert's sentence | | |
| 24 | Tab to "Acknowledge", press Enter | The button disappears; the status line now ends "acknowledged". **The list must not reorder under you** while focus is in it | | |
| 25 | Tab to "Resolve", press Enter | Focus lands on the next alert's "Show truck", **not** the top of the page | | |
| 26 | Press Enter on "Show truck" | The truck's details open with an "Alerts" heading and the same sentence | | |
| 27 | Tab to the tab bar, press Right arrow to Zones | "Zones, tab, selected, 3 of 3"; each zone is a heading followed by "*N* trucks inside" | | |
| 28 | Activate "Draw a zone", then "Add corner at map centre" three times, moving the map with the arrow keys between them | "*N* corners so far" updates; "Finish shape" becomes available at 3 | | |
| 29 | Activate "Finish shape" | Focus goes to "Zone name, edit". Type a name, Tab, choose a kind, activate "Save zone" | | |
| 30 | Paste `{nope` into "Import GeoJSON", activate "Import pasted" | "That isn't valid JSON." read out without moving focus | | |

### Replay (Layer 9)

Wait a minute after loading, so there is something to replay.

| # | Do this | NVDA should say (roughly) | What it said | OK? |
| --- | --- | --- | --- | --- |
| 31 | Find and activate "Replay" (it's after the map region) | "Replay at *hh:mm:ss*, paused. The map, list and details show that time. Alerts stay live." | | |
| 32 | Tab to the slider | "Replay time, slider, *hh:mm:ss*, *N* s ago" (a time, not a number) | | |
| 33 | Press Left arrow, then Page Down | The time goes back 5 s, then a minute, read out each time | | |
| 34 | Tab to "Play", press Space; wait 5 s | "Pause, button"; nothing is read while it plays (the clock isn't a live region) | | |
| 35 | Tab to "Playback speed", choose 60× | "Playback speed, combo box, 60×"; after a few seconds, "Caught up with live." | | |
| 36 | Activate "Replay" again, then "Back to live" | "Back to live." | | |

## What to do with the results

- **Every "OK" is ticked:** write "manual NVDA pass: done (date)" in
  `docs/LAYERS.md` under Layers 8a, 8b and 9, with the versions tested.
- **Something is wrong:** open an issue quoting what NVDA said, and fix it
  before the Layer 10 release. Items 2, 10, 15, 21, 24, 25 and 34 are the
  ones automated checks approximate but can't prove.
- **Known limitation, not a failure:** trucks can't be explored on the map by
  screen reader. The list is the equivalent, per the design (§8).
