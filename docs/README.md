# Fleet Live documentation

Start with the path for what you need. Every document links onward.

## Reading paths

| You are… | Read, in order |
| --- | --- |
| **Evaluating the project** (a reviewer or interviewer) | [../README.md](../README.md) → [WALKTHROUGH.md](WALKTHROUGH.md) (5 minutes) → [ARCHITECTURE.md](ARCHITECTURE.md) → the ADRs that interest you |
| **A new developer** | [GETTING-STARTED.md](GETTING-STARTED.md) → [ARCHITECTURE.md](ARCHITECTURE.md) → [PACKAGES.md](PACKAGES.md) → [WEB-APP.md](WEB-APP.md) → [TESTING.md](TESTING.md) |
| **Building a backend or a data source** | [PROTOCOL.md](PROTOCOL.md) → [TYPES.md](TYPES.md) → [BACKEND.md](BACKEND.md) |
| **Planning a real product** | [MARKET.md](MARKET.md) → [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) → [BACKEND.md](BACKEND.md) → [ROADMAP.md](ROADMAP.md) |
| **Changing behaviour** | [EXTENDING.md](EXTENDING.md) → [CONFIGURATION.md](CONFIGURATION.md) → [TESTING.md](TESTING.md) |
| **Deploying or operating it** | [DEPLOY.md](DEPLOY.md) → [OPERATIONS.md](OPERATIONS.md) → [QUALITY.md](QUALITY.md) |

## Every document

### Understand

| Document | What's in it |
| --- | --- |
| [../apps/web/README.md](../apps/web/README.md) | Public pages, the interactive demo route, and local web-app commands |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The architecture type and style; the tech stack; the life of a ping, from tracker to pixel; time; state ownership; failure modes; the performance budget; a code map |
| [TYPES.md](TYPES.md) | Every data type and message contract: network, Worker ↔ page, GPU texture, alerts and zones, replay, URL state |
| [PROTOCOL.md](PROTOCOL.md) | The wire protocol spec: endpoints, session (hello, resume, snapshot, close codes), the byte layout, implementing a compatible server, versioning |
| [GLOSSARY.md](GLOSSARY.md) | Terms as this project uses them |
| [../DESIGN.md](../DESIGN.md) | The original design: problem, scope, backlog, plan |
| [adr/](adr/) | Decisions with their context and measurements: rendering (0001), protocol (0003), precision (0006), routes (0008), simulation (0009), feed (0010), transport (0011), alerts (0012), replay (0013) |
| [LAYERS.md](LAYERS.md) | The build log: for each of 10 layers, why, what, how, what was measured, and what went wrong |

### Build

| Document | What's in it |
| --- | --- |
| [GETTING-STARTED.md](GETTING-STARTED.md) | Setup: prerequisites, install, demo and network modes, checks, editor, troubleshooting |
| [PACKAGES.md](PACKAGES.md) | Each package: purpose, exports, guarantees, scripts |
| [WEB-APP.md](WEB-APP.md) | The dashboard: structure, component tree, data flow, state, the map, theming, accessibility, keyboard map, layouts |
| [CONFIGURATION.md](CONFIGURATION.md) | Every option and default: URL, storage, server, simulation, feed, transport, alerts, replay, app, browser checks |
| [EXTENDING.md](EXTENDING.md) | Recipes: a new alert, a new truck shape, overlays, settings, messages, protocol changes, another city, packages, browser checks |
| [TESTING.md](TESTING.md) | Unit and property tests, ground-truth evaluations, benchmarks, browser and accessibility checks, debugging failures |

### Ship and run

| Document | What's in it |
| --- | --- |
| [QUALITY.md](QUALITY.md) | What CI gates, what it only records, and why |
| [DEPLOY.md](DEPLOY.md) | Deploying the demo (Vercel or any Next.js host) |
| [OPERATIONS.md](OPERATIONS.md) | Deployment shapes, running the server in the cloud, CI failures, diagnosing a running app |
| [BACKEND.md](BACKEND.md) | **Proposal:** from simulation to real trucks: device gateway, message bus, stream service, database schema, API, auth, privacy, server-side alerts, observability, a phased plan |
| [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) | **Everything needed to make it a real product:** the minimum sellable product, backend and admin work, customer features (trips, reports, dispatch, driver app), hardware and SIMs, operations, security, Nigerian legal and data protection, business, team, order of work |
| [MARKET.md](MARKET.md) | **Desk research, 1 Oct 2026:** Nigerian competitors and their prices, what fleets pay for, Fleet Live's edge and what would strengthen it, how it would do at each phase, risks, questions for customers |
| [ROADMAP.md](ROADMAP.md) | Known limits and what comes next |
| [WALKTHROUGH.md](WALKTHROUGH.md) | A five-minute guided tour |
| [a11y/NVDA-CHECKLIST.md](a11y/NVDA-CHECKLIST.md) | The manual screen-reader pass (36 steps) |

## Keeping the docs true

- **A number in the docs comes from a run of the current code.** If you
  change a measured default, rerun its evaluation and update every place it
  is quoted.
- **Source code wins over docs.** When they disagree, fix the doc in the same
  change.
- **Proposals are labelled.** [BACKEND.md](BACKEND.md) describes what isn't
  built yet, and says so.
- **Outside numbers are dated and sourced.** [MARKET.md](MARKET.md) quotes
  prices and company facts from other sites; recheck them before relying on
  them.
