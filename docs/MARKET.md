# The Nigerian market

Who already sells fleet tracking in Nigeria, what fleets pay for, where Fleet
Live has an edge, and how it would do at each phase of
[PRODUCTION-READINESS.md §10](PRODUCTION-READINESS.md#10--order-of-work).

- **Status:** desk research, gathered on **1 October 2026**. No customer
  has been interviewed, so treat this as a starting set of hypotheses to test
  in a pilot.
- **About the numbers:** Fleet Live's own numbers come from runs of the
  current code, as everywhere in these docs. Market prices and company facts
  come from the sources in §8. Most prices are vendor-stated on the vendors'
  own sites, and some "news" articles found during the research read like
  sponsored content and are not used. Prices change, so check them before
  relying on them.

---

## 1 · Summary

- **The market is led by hardware.** Nigerian fleets buy a tracker,
  installation, engine cut-off, stolen-vehicle recovery and a control room.
  The map software comes bundled, and much of it is white-labelled from
  platforms such as Wialon or Traccar.
- **Software alone sells cheaply.** Renewals run about ₦12,000–35,000 per
  vehicle per year. One local platform hosts other companies' devices for
  ₦30,000 per device per year.
- **Fleet Live's edge is alert quality,** measured against ground truth.
  Fleets use trackers as early warning against hijacking and cargo
  diversion, so an alert that cries wolf stops being read.
- **The best entry is a layer, not a tracker company:** an early-warning and
  control-room layer sold through existing installers, or to interstate
  hauliers with 50–500 trucks. Competing head-on as an installer means
  hardware, field staff and recovery, none of which this project has.

## 2 · Who already does this

| Group | Companies | What they sell | Price (vendor-stated) |
| --- | --- | --- | --- |
| **Tracker installers** (the bulk of the market) | Fenix Telematics, Car Tracker Nigeria (CTNFleet), GPSFleetmatic, Starcom Nigeria, Tramigo, Fleet Partners (Microfleet), and roughly 70–90 smaller firms in directory listings | Hardware and installation, engine cut-off, stolen-vehicle recovery with the police, 24/7 monitoring, a map, playback, geofences, a phone app | Fenix truck tracker: **₦200,000 in year one, then ₦35,000 a year**. Add-ons: fuel monitoring ₦650,000 + ₦80,000 a year; dual dashcam ₦250,000 + ₦45,000; fleet management (roles, roll-up reports) ₦150,000 + ₦35,000. Fenix states 200+ fleet operators and coverage in 12 cities |
| **White-label platforms** (the software installers run) | Wialon (about 2,200 service partners worldwide; Nigeria listed), Traccar (open source), CTN's white-label platform | A branded web and phone app, support for many tracker models, billing tools | CTN white-label: **₦3,000,000 setup + ₦30,000 per device per year**, with volume discounts. CTN states 52,000+ vehicles in 16 cities. Wialon is priced by its sales team |
| **Global telematics** | Cartrack, MiX by Powerfleet (Lagos office), Frotcom | Enterprise fleets, oil and gas safety compliance, video telematics, monthly contracts | Quoted per deal |
| **Freight marketplaces** | Kobo360, Lori Systems, Haul247, truQ | Matching cargo with trucks; tracking is one feature among many | Not comparable. Kobo360 raised $79M and was bought back by its co-founder in 2025 after layoffs; Lori's valuation fell from over $120M to $5M in 2025, with Nigeria its largest market |

**The marketplace lesson:** running trucks and cargo is capital-heavy, and
the best-funded attempts struggled. A software product should stay software.

## 3 · What buyers pay for

| Need | Evidence | What it means for Fleet Live |
| --- | --- | --- |
| **Early warning** against hijacking, kidnapping and cargo diversion | Daily Trust reports that fleets use trackers to get about 20 minutes' notice of an unplanned stop or route deviation, because cargo is gone before the police arrive. SBM Intelligence counted 997 abduction incidents in the year to June 2025. Insurers are cutting premiums for vehicles with live GPS | Alerts are the product, not the map. Their accuracy matters most |
| **Fuel** | Diesel costs about ₦1,660–1,800 a litre and makes up 35–40% of trucking costs. Fuel monitoring is the add-on with the highest price | The add-on that earns money. It needs sensors or CAN-bus trackers |
| **Trust and reach** | Installers advertise cities covered, recovery rates and police coordination | Hard for a software-only product to match; a reason to partner |
| **A low, predictable price** | Annual renewals of ₦12,000–35,000; local vendors market "no long contract" against the global brands | Pricing has to be in naira and simple |
| **Papers** | Vehicle papers are checked on the road ([PRODUCTION-READINESS.md §3.3](PRODUCTION-READINESS.md#33-product-features-customers-expect)) | Expiry reminders are cheap to build and valued |

## 4 · Fleet Live's edge

### 4.1 What is built and measured

| Edge | The number | Why it matters here |
| --- | --- | --- |
| **Alerts that don't cry wolf** | 0 false speeding alerts, against 270 for a naive rule; 18 of 18 silent trackers caught; 154 alerts for 154 real crossings of a zone edge drawn through a parking spot, against 1,036 ([ADR 0012](adr/0012-alerts-hysteresis-in-the-worker.md)) | Early warning only works if people trust it. No competitor found publishes false-alarm rates |
| **A feed that misbehaves** | Reordering, de-duplication, clock correction and resume with exactly-once delivery across forced disconnects ([ADR 0010](adr/0010-feed-order-independence-and-smoothing.md), [ADR 0011](adr/0011-transport-resume-snapshot-backpressure.md)) | Coverage gaps, buffered reports and jammers are part of everyday operation on Nigerian roads |
| **Scale on one screen** | 5,000 trucks (up to 20,000 with `?n=`) at 60 fps, with 0–1 long tasks per 10 s ([ADR 0001](adr/0001-own-webgl-layer.md)) | Fits an installer's control room watching tens of thousands of vehicles. A small fleet doesn't need it |
| **Replay that matches the live map** | Replayed trucks sit within 1.4 m (p95) of where the live map drew them ([ADR 0013](adr/0013-replay-from-recorded-estimates.md)) | Evidence for insurance claims and disputes |
| **Smooth movement from sparse reports** | Trucks are interpolated on the GPU while the map renders slightly in the past | Real trackers often report every 10 s, not every second |

### 4.2 What would make it more needed

In order of value for the effort. None of these is built.

| # | Feature | Why | Size |
| --- | --- | --- | --- |
| 1 | **An early-warning engine:** route-deviation and unplanned-stop alerts, and a tracker going silent on a high-risk road (a possible jammer). Each one scored against ground truth like the existing alerts, with false-alarm rates published | The need in §3 that matters most, built on the edge in §4.1. Today's alert kinds are zone entry, zone exit, speeding and offline | M |
| 2 | **Escalation over WhatsApp or SMS with acknowledgement:** driver, then dispatcher, then owner, until someone confirms | An alert has to work when nobody is watching the screen | M |
| 3 | **Fuel anomaly detection,** including slow drains (a T-connector on the fuel return line reportedly evades simple drop thresholds) | Fuel is where the money is. The same ground-truth scoring applies | M–L |
| 4 | **An incident pack for insurers:** replay clip, event timeline and positions, exported for a claim | Insurers already reward tracking, which makes them a possible sales channel | S–M |
| 5 | **Control-room mode for installers:** one screen across many client companies, with tenant boundaries | Sells to companies that already have hardware, SIMs, installers and recovery, and uses the scale edge | M |
| 6 | **A low-data phone mode** | Owners check from their phones on metered data | S |

## 5 · How it would do at each phase

The phases are those of
[PRODUCTION-READINESS.md §10](PRODUCTION-READINESS.md#10--order-of-work).

| Phase | Expected market position | Success looks like |
| --- | --- | --- |
| **0. Publish** | No revenue. A public demo that also works as a sales demo | Deployed and linked |
| **1. Pilot backend** (5–20 trucks) | Would lose a feature-by-feature comparison to any white-label reseller. Its purpose is learning. Partner with an installer for the hardware | Real report rates, gaps and GPS error are known, and the evaluations have been rerun on real data |
| **2. Minimum sellable product** | **Weak as a standalone tracker company:** renewals near ₦35,000 a year, and rivals bundle recovery and installers in many cities. **Viable as an alerting and control-room layer** for installers, or for interstate hauliers with 50–500 trucks, once §4.2 items 1–2 exist. As a scale check, software alone at ₦30,000 per vehicle per year gives ₦30M a year at 1,000 vehicles | A pilot fleet still acts on the alerts after four weeks, and false alarms stay near zero on real data |
| **3. Grow** | Fuel, paper reminders, driver scores and reports bring it level with the local leaders. Fuel is what raises revenue per vehicle | Revenue per vehicle above the ₦35,000 base |
| **4. Expand** | Large fleets and oil and gas mean competing with MiX and Cartrack: long enterprise sales, a penetration test, formal support. Add dispatch and a driver app, but stay software rather than a marketplace (§2) | A first enterprise contract |

## 6 · Risks and gaps

- **The product has never seen a real truck.** Every measured number comes
  from the simulator. Real devices may report less often, with larger errors
  and longer gaps ([PRODUCTION-READINESS.md §4](PRODUCTION-READINESS.md#4--hardware-and-connectivity)).
- **The alert this market values most, route deviation, isn't built.**
- **No backend, hardware, recovery or fuel feature exists.** A business also
  needs field operations, sales and capital ([PRODUCTION-READINESS.md §9](PRODUCTION-READINESS.md#9--team)).
- **Bandwidth only matters at control-room scale.** About 3 GB per dispatcher
  per day was measured at the simulator's one report per second for 5,000
  trucks ([BACKEND.md §4.3](BACKEND.md#43-capacity-estimates-from-measured-numbers)).
  Bandwidth is linear in reports per second, so a 100-truck fleet reporting
  every 10 s would need roughly 1/500 of that. That is an estimate, not a
  measurement.
- **Incumbents can copy features.** What is harder to copy is the habit of
  measuring alerts against ground truth and publishing the results.

## 7 · Questions for the first customer conversations

1. What happened the last time a truck went somewhere it shouldn't? Who
   found out, and how long after?
2. How many alerts does your current system send in a day, and how many do
   you act on?
3. What do you pay per vehicle today, and to whom: hardware, renewal, add-ons?
4. Does your insurer ask for tracking data, and in what form?
5. Who watches the screen at night?

## 8 · Sources

Gathered 1 October 2026.

- Directory listings: [ensun: GPS fleet tracking, Nigeria](https://ensun.io/search/gps-fleet-tracking/nigeria), [ensun: vehicle tracking, Nigeria](https://ensun.io/search/vehicle-tracking/nigeria)
- Fenix Telematics: [home](https://fenixtelematics.ng/), [truck tracking and prices](https://fenixtelematics.ng/truck-tracking/)
- Car Tracker Nigeria: [white-label fleet software and prices](https://cartracker.com.ng/fleet-management-software/), [versus Cartrack](https://cartracker.com.ng/blog/cartrack-alternative-nigeria/), [fleet tracking price guide](https://cartrackernigeria.ng/how-much-does-fleet-tracking-cost-in-nigeria-2026-complete-pricing-guide-for-businesses/)
- [Starcom Nigeria](https://starcom-nig.com/)
- Product lists: [Data2Bots](https://data2bots.com/blog/10-best-fleet-management-software-for-businesses-in-nigeria), [Raspib Technology](https://www.raspibtech.com/blog/fleet-management-software-nigeria) (both vendors; used only for names)
- [Wialon](https://wialon.com/en/vehicle-tracking-system); [MiX by Powerfleet, oil and gas](https://www.mixtelematics.com/za/industries/oil-and-gas/)
- Kobo360: [TechCabal, layoffs](https://techcabal.com/2025/01/20/kobo360-layoff/), [TechCabal, new owner](https://techcabal.com/2025/03/04/kobo360-new-owner/)
- Lori Systems: [TechCabal, valuation](https://techcabal.com/2025/04/21/lori-120-million-valuation-dips-to-5-million/)
- [Haul247](https://haul247.co/solutions/haulage); truQ: [Disrupt Africa](https://disruptafrica.com/2025/10/10/how-nigerias-truq-helps-small-scale-african-transporters-digitise-operations/)
- Demand: [Daily Trust, fleets buying trackers for early warning](https://dailytrust.com/nigerian-fleets-are-buying-trackers-not-to-recover-trucks-but-to-know-when-to-panic/), [Nigerian Eye, diesel theft](https://www.nigerianeye.com/2026/05/diesel-theft-from-commercial-fleets-in.html)
- Costs: [GlobalPetrolPrices, Nigeria diesel](https://www.globalpetrolprices.com/Nigeria/diesel_prices/), [ConnectNigeria, logistics costs 2026](https://articles.connectnigeria.com/logistics-delivery-cost-nigeria-2026/)
