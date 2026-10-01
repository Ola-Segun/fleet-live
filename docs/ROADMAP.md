# Roadmap and known limits

What Fleet Live doesn't do yet, and what would come next. Ordered by value,
with the reason for each.

## Known limits (today)

| Limit | Why it exists | What lifting it takes |
| --- | --- | --- |
| **Simulated data only** | A portfolio project with no real fleet; the simulator also provides ground truth | A device gateway and stream service ([BACKEND.md](BACKEND.md)) |
| **History lives in the browser session** | No server-side storage; a demo-mode reload starts a new fleet | Server-side positions and `GET /history` ([BACKEND.md §9](BACKEND.md#9--replay-from-the-server)) |
| **Replay time isn't in the URL** | A link to 14:05 would open onto a fleet with no 14:05 | Server-side history |
| **Zones are per browser** | Stored in `localStorage` | A zones API, shared per fleet |
| **Alerts are evaluated in each browser** | No server; acknowledgements reset on reload | A server-side alert service with notifications |
| **No sign-in or tenants** | A public demo | OIDC and tenant scoping |
| **The manual screen-reader pass isn't done** | It needs a person with NVDA | Run `docs/a11y/NVDA-CHECKLIST.md` (36 steps) and record the results |
| **No list-only fallback without WebGL** | The design asked for it (L12); not built | Detect a WebGL2 failure, hide the map, keep the list and details |
| **Alerts aren't replayed** | The alert list is live state | Record alert events in history, or query them server-side |
| **One city** | Routes, origin, time zone and traffic model are Lagos | [EXTENDING.md: "Use another city"](EXTENDING.md#use-another-city) |
| **Gaussian GPS noise only** | Real multipath jumps (tens of metres near tall buildings) aren't modelled, so the alert dwell's defence against them isn't measured | Add jump noise to `DeviceConfig`; rerun the alerts evaluation |
| **Performance measured on one laptop** | One machine available | Measure on a low-end Android phone and a desktop GPU |
| **The workflows haven't run on GitHub yet** | The repository isn't published | Push; fix whatever the first run finds |
| **Protocol v1 broadcasts everything** | Simple and enough for 5,000 trucks | v2 subscription filters (viewport or group) for large fleets |

## Next, in order

1. **Publish:** a GitHub repository, the first CI run, a Vercel deploy, a
   licence. This turns the work into something people can open.
2. **The NVDA pass.** It's the only accessibility check not yet done, and
   it's what a screen-reader user actually experiences.
3. **A list-only fallback without WebGL** (backlog L12), and a "loading" and
   "empty" state for every panel.
4. **A relay server in the cloud** (BACKEND phase 1): network mode over the
   internet, with real mobile-network behaviour.
5. **Real trackers through Traccar** (phase 2): the seq and ignition mapping
   proven on hardware.
6. **Persistence, API, sign-in** (phase 3), then **server-side alerts with
   SMS notifications** (phase 4).
7. **Long-range replay and protocol v2 filters** (phase 5).

## Ideas worth exploring

- **ETA and route progress** in the details panel (design L3 mentions it):
  the simulator knows each truck's route, and a real system would get it from
  the dispatch system.
- **The raw-versus-smoothed overlay** (design L10): show raw pings next to the
  smoothed track, to make the feed's work visible.
- **Clustering** at city zoom, as an option, for very large fleets.
- **An offline-first driver app** (Expo) as a second client of the same
  protocol.
