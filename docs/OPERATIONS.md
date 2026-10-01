# Operations

Running, deploying and diagnosing Fleet Live: the demo as it is today, and
what changes once a backend exists ([BACKEND.md](BACKEND.md)).

---

## 1 · Deployment shapes

| Shape | What runs | Hosting | Guide |
| --- | --- | --- | --- |
| **Static demo** (today) | The Next.js app; the simulator runs in each visitor's browser | Vercel, or any host that runs `next build` and `next start` | [DEPLOY.md](DEPLOY.md) |
| **Demo + relay** | The app plus `apps/sim-server` for network mode | The app on Vercel; the server on a container host (Fly.io, Render, Railway) behind TLS | §3 |
| **Production** | Gateway, bus, framer, stream nodes, API, database | Containers or Kubernetes, plus managed PostgreSQL and Redis | [BACKEND.md](BACKEND.md) |

## 2 · The static demo

- **Build:** `pnpm --filter @fleet/web build`. The page prerenders as
  static, and the Worker and map load on the client.
- **Runtime dependencies:**
  - OpenFreeMap tiles (`tiles.openfreemap.org`) for the base map;
  - nothing else. The route data is in the bundle.
- **Configuration:** none. No environment variables or secrets.
- **Verify a deploy:**

  ```sh
  BASE_URL=https://<deploy>/ pnpm smoke:ui
  BASE_URL=https://<deploy>/ pnpm smoke:replay
  ```

- **Cost driver:** static hosting and bandwidth (about 892 KB gzipped per
  visit). The simulation runs on the visitor's machine.

## 3 · Running `apps/sim-server` in the cloud

```sh
HOST=0.0.0.0 PORT=8787 VEHICLES=5000 pnpm --filter @fleet/sim-server start
```

- Put it behind TLS (most container hosts terminate TLS for you). Clients
  then connect with `?mode=network&ws=wss://<host>/stream`.
- Allow WebSocket upgrades, and set the proxy's idle timeout above 10 s (the
  heartbeat).
- **Health check:** `GET /health` returns
  `{ ok, clients, lastFrameSeq }`.
- **Capacity:** about 105 KiB/s per connected client for 5,000 trucks
  (measured), and the simulator costs about 5–6% of one core.
- The server keeps everything in memory. A restart starts a new fleet, and
  clients resume into a snapshot automatically.
- `/vehicles` sends `Access-Control-Allow-Origin: *`. That's fine for public
  demo data; restrict it for anything real.

A minimal container recipe (adjust to your host):

```dockerfile
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@fleet/sim-server", "start"]
```

## 4 · CI

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Every push to `main`, and pull requests | `check` job: typecheck, lint, tests, build, bundle budget. `browser` job: every browser check in Chromium with software WebGL; screenshots and accessibility trees kept as artifacts |
| `.github/workflows/evaluate.yml` | Mondays 04:00 UTC, and on demand | The evaluations and benchmarks; output kept as artifacts |

When CI fails:

1. **The check job:** run `pnpm check` locally. If `--frozen-lockfile` fails,
   run `pnpm install` and commit the lockfile.
2. **The browser job:** download the `browser-checks` artifact (screenshots
   and `next.log`), then reproduce locally with `CI=true pnpm smoke:<name>`,
   which forces the same software rendering.
3. **External tiles:** the browser job needs `tiles.openfreemap.org`. An
   outage there fails map-dependent checks; rerun once it's back.

## 5 · Diagnosing a running app

### What the status line tells you

| Shows | Meaning |
| --- | --- |
| `Demo fleet` / `Network` | The data source |
| `Live` (green) / `Reconnecting` / `Connecting…` | Connection state; in network mode with backoff |
| `N trucks` | Trucks in the latest snapshot (or at the replay time) |
| `as of 1.4 s ago` | The display delay: how far behind real time the map draws, on purpose |
| `Replay 14:05:30` (badge) | Replaying; the map, list and details show that time |
| `N reconnects`, `N frames missed` | Only shown when non-zero |

### Tools

- **`?hud=1`:** frame rate and the truck layer's CPU per frame.
- **`window.__fleetPerf`** in the console: `layer` (frames, uploads, context
  restores, alerting trucks drawn), `longTasks`, `lastPickMs`, `probe(id)`.
- **`pnpm profile:frames`:** a Chrome trace of slow frames.
- **Chrome DevTools → Performance:** the Worker's activity shows on its own
  track.

### Symptoms

| Symptom | Look at |
| --- | --- |
| Trucks jump or stutter | `?hud=1` frame times; `profile:frames`. Usually a long task on the main thread, not the GPU |
| Many stale (red ring) trucks | Is the source sending? In network mode, check the server's `/health` `lastFrameSeq` advancing; then the feed stats in the status message |
| Reconnect loop | The server's close code: 1008 (a bad hello, a client or proxy issue) or 1013 (a slow client). Check that the proxy allows WebSockets |
| Alerts never announced | Fixed in Layer 10 (`Gather`); check `smoke:alerts` "keep being announced" |
| Blank map, trucks present | Tiles blocked |
| Trucks vanish after a theme switch or GPU reset | `__fleetPerf.layer.layersAdded` should increase and frames continue; see `ensureVehicleLayer` in `LiveMap.tsx` |

## 6 · Local development hygiene

- **Stop servers by the port they own,** not by process name. On Windows:
  `Get-NetTCPConnection -LocalPort 3100 -State Listen | % { Stop-Process -Id $_.OwningProcess }`.
  Killing every `node` process also kills editors and other tools.
- **A heavy tab running the app** competes with browser checks and
  measurements; close it while measuring.
- **Measurements in the docs** come from the dev laptop (i7-10610U, Intel
  UHD, Chrome). On other hardware, expect different absolute numbers; the
  comparisons are what matter.
