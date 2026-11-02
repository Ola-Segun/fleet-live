# Getting started: setup

From a clean machine to a running dashboard, the tests and the browser
checks. Works on Windows, macOS and Linux.

---

## 1 · Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | 22 (see `.nvmrc`) | Use nvm, fnm or Volta: `nvm use` reads `.nvmrc` |
| **pnpm** | 10.14 (pinned in `package.json` as `packageManager`) | `corepack enable` provides the right version automatically |
| **Git** | Any recent version | |
| **Google Chrome** | Current | Only for the browser checks. Without it, install Playwright's Chromium (§6) |
| A GPU-capable browser | Any browser with WebGL2 | The map needs WebGL2. Every current desktop and mobile browser has it |

No database, API keys or environment variables are needed to run the app.
The base map tiles (OpenFreeMap) need no key, and the route data is committed.

## 2 · Install

```sh
git clone <repository-url> fleet-live
cd fleet-live
corepack enable           # once per machine: gives you the pinned pnpm
pnpm install              # installs every workspace package
```

`pnpm install` also links the workspace packages (`@fleet/*`) into each
other. There's nothing to build first: packages are consumed as TypeScript
source.

> **Windows:** run the commands in PowerShell or Git Bash. If an install
> stalls, run `pnpm install --reporter=append-only` to see progress.

## 3 · Run the product site and console (demo mode)

```sh
pnpm --filter @fleet/web dev
```

Open <http://localhost:3000> for the public product site, then choose **Open
interactive demo** or go directly to <http://localhost:3000/app> for the
dispatcher console. In demo mode the simulator runs inside the browser's
Worker. It warms up 30 simulated seconds, then 5,000 trucks start moving,
about 4 seconds after the console opens.

Try:

- `http://localhost:3000/app?at=2230`: night-time roads, so speeding alerts
  arrive within a minute;
- `?hud=1`: the performance overlay;
- the Dark mode button, top left;
- Replay, after a minute of recording.

All URL options are in [CONFIGURATION.md](CONFIGURATION.md#1--url-options-the-web-app).

### Production build

The browser checks run against this, and so does what a deploy runs:

```sh
pnpm --filter @fleet/web build
pnpm --filter @fleet/web start -p 3100     # public site: http://127.0.0.1:3100
```

The interactive console is at <http://127.0.0.1:3100/app>.

## 4 · Run with a server (network mode)

Two terminals:

```sh
# terminal 1: the simulator as a WebSocket server
pnpm --filter @fleet/sim-server start
#   → ws://127.0.0.1:8787/stream, vehicles at http://127.0.0.1:8787/vehicles

# terminal 2: the dashboard
pnpm --filter @fleet/web dev
```

Then open
<http://localhost:3000/app?mode=network&ws=ws://127.0.0.1:8787/stream>.

To see the reconnect logic at work, drop every client every 20 s:

```sh
FORCE_DISCONNECT_MS=20000 pnpm --filter @fleet/sim-server start   # PowerShell: $env:FORCE_DISCONNECT_MS=20000; pnpm …
```

The status line shows reconnects, and the map keeps going: the client
resumes from the last frame it saw.

Server environment variables: `PORT`, `HOST`, `VEHICLES`, `SEED`,
`FORCE_DISCONNECT_MS` (see [CONFIGURATION.md §3](CONFIGURATION.md#3--the-simulator-server-appssim-server)).

## 5 · Checks

```sh
pnpm check            # typecheck (every package, the app, the scripts) + lint + 224 tests
pnpm test             # tests only
pnpm test:watch       # tests, re-run on save
```

The tests take a minute or two. They need no browser or network.

## 6 · Browser checks

These drive a real browser against the production build:

```sh
pnpm --filter @fleet/web build
pnpm --filter @fleet/web start -p 3100     # leave this running
pnpm smoke:all                             # in another terminal
```

`smoke:all` runs `smoke:web`, `smoke:ui`, `smoke:alerts`, `smoke:replay`,
`a11y` and `a11y:contrast`: 15 to 20 minutes on the dev laptop. Run one at a time
while iterating.

Which browser they use:

- **Windows with Chrome installed** at the default path: that Chrome, on the
  real GPU.
- **Elsewhere:** install Playwright's Chromium once with
  `pnpm exec playwright install chromium`, or point `CHROME_PATH` at a
  Chrome binary.
- **Without a GPU (like CI):** `SOFTWARE_GL=1 pnpm smoke:ui`. Timing is then
  recorded but not gated.

Point the checks at any deployment with `BASE_URL=https://… pnpm smoke:ui`.

## 7 · Measurements

These are the sources of the numbers in the docs:

```sh
pnpm --filter @fleet/feed evaluate      # smoothing error against ground truth
pnpm --filter @fleet/alerts evaluate    # alerts: caught, missed, false, late (~10 min)
pnpm --filter @fleet/replay evaluate    # replay error and memory per interval (~2 min)
pnpm --filter @fleet/<sim|feed|alerts|replay> bench   # costs, min and median of 5
pnpm bundle:size                        # after a web build
pnpm profile:frames                     # a Chrome trace of slow frames (app on :3100)
```

## 8 · Editor setup

- **VS Code:** the ESLint and Tailwind CSS IntelliSense extensions. TypeScript
  uses the workspace version (`node_modules/typescript`).
- Each package has its own `tsconfig.json` extending `tsconfig.base.json`.
  The browser scripts have `scripts/tsconfig.json`.
- **Next.js 16 changed several APIs.** Before writing app code, read the
  bundled guides in `apps/web/node_modules/next/dist/docs/`, as
  `apps/web/AGENTS.md` says.

## 9 · Repository layout

```text
fleet-live/
  apps/
    web/            the dashboard (Next.js)          → docs/WEB-APP.md
    sim-server/     the WebSocket server              → docs/PROTOCOL.md
  packages/         the libraries                     → docs/PACKAGES.md
  scripts/          browser checks, budget, profiler  → docs/TESTING.md
  docs/             documentation (start at docs/README.md)
  .github/workflows CI and weekly evaluations         → docs/QUALITY.md
  DESIGN.md         the original design
```

## 10 · Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| A blank grey map, but the status line says Live | Tiles blocked (offline, proxy, firewall) | Check that `tiles.openfreemap.org` is reachable |
| The map shows but no trucks are drawn | WebGL2 disabled (remote desktop, some VMs) | Enable hardware acceleration; check `chrome://gpu`. A list-only fallback without WebGL isn't built yet (see ROADMAP.md) |
| Port 3000, 3100 or 8787 already in use | An old server is still running | Stop *that* process by port. **Windows:** `Get-NetTCPConnection -LocalPort 3100 -State Listen \| % { Stop-Process -Id $_.OwningProcess }`. **macOS/Linux:** `lsof -ti :3100 \| xargs kill`. Don't kill every `node` process |
| Trucks frozen after the laptop wakes | Large clock jump | Expected: the display clock resyncs within a second |
| Status shows "Reconnecting" in network mode | The server isn't running, or the URL is wrong | Start `@fleet/sim-server`; check that `?ws=` starts `ws://` |
| Browser checks time out on first load | The machine is busy (another tab running the app, software GL) | Close other heavy tabs; under `SOFTWARE_GL` the waits are already longer |
| `pnpm install --frozen-lockfile` fails in CI | `package.json` changed without updating the lockfile | Run `pnpm install` locally and commit `pnpm-lock.yaml` |
| Type errors only in `scripts/` | The scripts have their own tsconfig | `npx tsc -p scripts` |
| Replay button disabled | Less than 30 s recorded | Wait; history starts when the page loads |

More operational detail: [OPERATIONS.md](OPERATIONS.md).
