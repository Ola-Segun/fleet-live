# From demo to a real product

Everything it would take to turn Fleet Live into a product a logistics
company pays for and relies on. That covers technology, product features,
hardware, operations, security, legal and business.

- **Technical detail for the backend:** [BACKEND.md](BACKEND.md). This
  document links to it rather than repeating it.
- **Status:** a planning checklist. None of the work below is built. Sizes
  are relative (S, M, L, XL), not time estimates: duration depends on the
  team.

---

## 1 · Where the project stands

| Part | State |
| --- | --- |
| Dispatcher web app: live map, find, follow, list, alerts, zones, replay, accessibility, light/dark | **Done and tested** (Layers 1–9) |
| Handling a bad feed: order, duplicates, clocks, smoothing, reconnects | **Done**, measured against ground truth |
| Quality gates: tests, CI workflows, bundle budget | **Done locally**; CI not yet run on GitHub |
| Data source | **Simulated**; `apps/sim-server` is a reference relay |
| Backend, real devices, accounts, storage | **Not built** (proposal in [BACKEND.md](BACKEND.md)) |
| Product features beyond live tracking (jobs, reports, driver app) | **Not built** |
| Business, legal, hardware, support | **Not started** |

The hardest technical part of a fleet product, making an unreliable feed
look reliable, is done. Most of what remains is breadth.

## 2 · The minimum sellable product

Not everything below is needed before the first paying customer. The
smallest product a small fleet (20–200 trucks) would pay for:

1. Real trackers on their trucks, reporting through the gateway
   ([BACKEND.md §3](BACKEND.md#3--ingesting-real-trackers)).
2. Sign-in, their fleet only, and two roles: admin and dispatcher.
3. The live map and list (built), with their vehicles and drivers managed in
   an admin screen.
4. Zones and alerts shared across the company, with **SMS or WhatsApp
   notifications**: the feature that works when nobody is watching the
   screen.
5. History and replay for at least 30 days, and a **trip report** they can
   export.
6. A support channel and an uptime commitment they can understand.

Everything else in this document comes after, driven by what customers ask
for.

## 3 · Technology workstreams

### 3.1 Backend core (see [BACKEND.md](BACKEND.md))

| Item | Size | Done when |
| --- | --- | --- |
| Device gateway (Traccar to start) and normaliser | M | Real trackers appear on the map with correct seq, ignition and buffered flags |
| Message bus, framer, stream nodes | L | Two stream nodes behind a load balancer; a client resumes on either without loss |
| PostgreSQL + TimescaleDB + PostGIS schema, with migrations | M | Schema versioned (for example with a migration tool); repeatable from empty |
| REST API: vehicles, drivers, devices, zones, alerts, history | L | Every endpoint scoped by tenant, validated, documented (OpenAPI) |
| Server-side alerts (reusing `@fleet/alerts`) and the notifier | M | Alert evaluated once, persisted, sent by SMS within a minute |
| Long-range history and replay endpoint | M | Replay any day in the last 30, through the existing client |

### 3.2 Accounts, identity, administration

| Item | Size | Notes |
| --- | --- | --- |
| Sign-in (OIDC provider), password reset, multi-factor for admins | M | Buy, don't build: a managed identity service |
| Tenants (one company per tenant), invites, roles: owner, admin, dispatcher, viewer | M | Every row and stream scoped by tenant |
| Admin screens: vehicles, drivers, devices (by IMEI), device ↔ vehicle assignment with dates | L | The data the map already shows, made editable |
| Audit log: who acknowledged, resolved, edited zones, viewed history | S | Needed for disputes and for data protection |
| Account settings: time zone, units, notification preferences, quiet hours | S | |

### 3.3 Product features customers expect

Roughly in the order fleet customers tend to ask for them. Confirm with real
customers before building.

| Feature | Size | What it involves |
| --- | --- | --- |
| **Trips and reports:** trips (ignition on to off), distance, driving time, stops, idling; daily and weekly reports; CSV/PDF export; scheduled email | L | Trip segmentation server-side from positions; reports as queries over TimescaleDB aggregates |
| **Driver behaviour:** speeding events (built), harsh braking and acceleration, idling; a score per driver | M | Needs accelerometer data or speed derivatives from trackers that report them |
| **Jobs and dispatch:** create a delivery job (pickup, drop-off), assign a truck, track progress, ETA, proof of delivery | XL | A new domain: jobs, stops, statuses; ETAs from a routing engine |
| **Addresses:** search places, reverse-geocode a truck's position | M | A geocoding service; self-hosted options exist (for example Nominatim on OpenStreetMap) |
| **Routing and ETAs** | M | A self-hosted OSRM (the routes were already generated with it) or a commercial API |
| **Maintenance and documents:** service intervals by distance or engine hours; vehicle paper expiry (licence, insurance, road worthiness) with reminders | M | Simple scheduling; high value in Nigerian fleets, where papers are checked on the road |
| **Fuel:** fuel level or consumption from sensors, theft alerts | M–L | Depends on fuel sensors or CAN-bus trackers |
| **A driver app:** an offline-first mobile app showing jobs and navigation, logging proof of delivery, optionally reporting position | XL | A second client (for example Expo/React Native); the same backend |
| **Customer sharing:** a time-limited public link showing one truck's ETA to the receiving customer | S | A read-only stream for one vehicle |
| **Integrations:** webhooks, a public API with keys, export to ERP or accounting tools | M | Built on the REST API |

### 3.4 The web app's remaining work

| Item | Size | Notes |
| --- | --- | --- |
| Configuration from the environment (stream URL, API URL), sign-in, zones and alerts from the API | M | [BACKEND.md §12](BACKEND.md#12--changes-to-the-client) |
| A list-only fallback without WebGL; loading, empty and error states everywhere | S | Backlog L12 |
| The manual NVDA pass | S | [a11y/NVDA-CHECKLIST.md](a11y/NVDA-CHECKLIST.md) |
| Performance on a low-end Android phone and on a dispatcher's office PC | S | Measured so far on one laptop only |
| Localisation: copy ready for translation; number, date and time formats per locale | M | English-only today; Lagos time is hard-coded for display |
| Error reporting from browsers (for example Sentry) | S | |

## 4 · Hardware and connectivity

A tracking product is also a hardware logistics business.

| Item | What to decide or do |
| --- | --- |
| **Trackers** | Choose one or two models (supported by the gateway, with an ignition input, an internal battery for tamper alerts, and optionally CAN-bus and fuel inputs). Get samples and test them on the road in Lagos before committing |
| **Supply** | A local distributor or importer; import duties and lead times; spares |
| **SIM cards and data** | Machine-to-machine (M2M) or IoT SIMs from a mobile network operator, roaming across networks for coverage; data plans per device; who pays when a SIM runs out |
| **Installation** | Trained installers or partner workshops; an installation checklist (ignition wire, antenna placement, a tamper-resistant mount); photo proof per install |
| **Device management** | Provisioning (IMEI → vehicle), remote configuration (report intervals), firmware updates, health monitoring (devices silent for days, low battery, power cut alerts) |
| **Returns and faults** | Replacement process, warranty, device inventory |

The simulator's assumptions (a report every 1 s moving and 30 s parked, 4 m
GPS error, coverage gaps) should be checked against real devices and
updated. Then rerun the evaluations to confirm the feed's settings still
hold.

## 5 · Running it: reliability and operations

| Item | Size | Done when |
| --- | --- | --- |
| **Environments:** development, staging, production; production data never in development | M | Each deploys from CI |
| **Infrastructure as code** (for example Terraform) and **secrets management** | M | The whole environment can be recreated from the repository plus secrets |
| **CI/CD for the backend:** tests, migrations, gradual rollout, rollback | M | A bad deploy is rolled back in minutes |
| **Backups and disaster recovery:** database backups, restore drills, recovery objectives | M | A restore has been rehearsed; recovery point and time targets written down |
| **Monitoring and on-call:** dashboards, alerts on the metrics in [BACKEND.md §11](BACKEND.md#11--observability), a rota, runbooks | M | Someone is woken when frames stop flowing |
| **Load testing:** ingest (reports per second), stream fan-out (clients per node), API | M | The capacity per node is measured, not assumed |
| **Status page and incident process** | S | Customers learn of an outage from you first |
| **Data retention jobs:** raw positions downsampled or deleted on schedule | S | Matches the published retention policy |

## 6 · Security

| Item | Notes |
| --- | --- |
| Threat model | Who would attack this, and how: competitors, thieves wanting a truck's location, insiders |
| Authentication hardening | Multi-factor for admins, session expiry, rate limits on sign-in |
| Tenant isolation tests | Automated tests that one tenant can never read another's data, including over the WebSocket |
| Device ingest security | Accept only registered IMEIs; watch for spoofed positions; rate-limit per device |
| Dependency and secret scanning | In CI |
| Penetration test | By a third party, before the first large customer |
| Least privilege | Staff access to production data logged and minimal |

## 7 · Legal and compliance (Nigeria)

Pointers, not legal advice. Take advice from a Nigerian lawyer.

| Item | Notes |
| --- | --- |
| **Company registration** | With the Corporate Affairs Commission (CAC), and tax registration |
| **Terms of service and a customer agreement** | Liability limits, uptime commitment, data ownership (the customer owns their fleet data) |
| **Privacy policy and data processing agreement** | You are the customer's data processor; they are the controller for their drivers' data |
| **Nigeria Data Protection Act 2023** | Location data about drivers is personal data. Check registration duties with the Nigeria Data Protection Commission (NDPC), and the need for a data protection officer and audits under the current NDPC guidance. Help customers with lawful basis, notice to drivers, retention and access requests |
| **Driver notice** | A template customers can give drivers: what is tracked, when, why, and who sees it |
| **Map and data licences** | Keep OpenStreetMap, ODbL and OpenMapTiles attribution visible (checked by `smoke:ui`); review terms for any commercial map or geocoding provider |
| **Open-source licences** | Review the licences of dependencies before distributing; choose this project's own licence |

## 8 · Business

| Area | What to work out |
| --- | --- |
| **Customer** | Which fleets first: haulage, last-mile delivery, oil and gas logistics, cold chain? Size, budget, current tools |
| **Pricing** | Per vehicle per month for software; hardware sold, rented or bundled; installation fee; SMS costs passed on or included |
| **Billing** | Subscriptions and invoices; local payment providers (Paystack and Flutterwave both support recurring payments); naira pricing; handling failed payments |
| **Onboarding** | From signed contract to trucks on the map: account setup, device installation scheduling, training, a first-week check-in |
| **Support** | Channels (WhatsApp, phone, email), hours, response targets, a help centre |
| **Sales and marketing** | A demo (the deployed demo mode already works as one), case studies, a pilot offer |
| **Unit economics** | Per vehicle: hardware, SIM data, SMS, hosting, support, against the monthly price. Hosting per vehicle can be estimated from [BACKEND.md §4.3](BACKEND.md#43-capacity-estimates-from-measured-numbers) |

## 9 · Team

The roles a real product needs. One person can hold several early on.

| Role | Owns |
| --- | --- |
| Frontend engineer | The web app (this repository's strength) |
| Backend engineer | Gateway, streams, API, database |
| DevOps / SRE (part-time to start) | Infrastructure, monitoring, on-call, backups |
| Mobile engineer (when the driver app starts) | The driver app |
| Product and design | Customer research, priorities, flows |
| Field operations | Installers, device inventory, SIM management |
| Sales and support | Customers |

## 10 · Order of work

| Phase | Goal | Includes |
| --- | --- | --- |
| **0. Publish** | The demo in public | GitHub, CI's first run, Vercel deploy, licence ([ROADMAP.md](ROADMAP.md)) |
| **1. Pilot backend** | Real trucks on the map for one friendly fleet | Gateway with 5–20 trackers; framer and stream; database; sign-in; vehicle admin. [BACKEND.md](BACKEND.md) phases 1–3 |
| **2. Sellable** | The minimum sellable product (§2) | Server alerts with SMS; 30-day history; trip report export; tenant isolation tests; backups; monitoring; terms, privacy policy, data protection review |
| **3. Grow** | What customers ask for | Reports, driver behaviour, maintenance and documents, geocoding, customer ETA links |
| **4. Expand** | Bigger fleets and new segments | Jobs and dispatch, the driver app, integrations, protocol v2 filters, a penetration test, a status page |

At each phase, run the existing evaluations again against **real** data where
possible. The simulator's assumptions are the biggest unknown between this
demo and a real deployment.
