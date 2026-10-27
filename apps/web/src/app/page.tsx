import type { Metadata } from "next";
import Link from "next/link";
import {
  Eyebrow,
  SectionHeading,
  SiteShell,
} from "@/components/site-shell";
import DitheredShaderBackground from "@/components/ui/dithered-shader-background-1";
import { FleetLiveHero } from "@/components/ui/fleet-live-hero";

export const metadata: Metadata = {
  title: "Fleet operations, without the noise",
  description:
    "Explore Fleet Live, a real-time fleet operations concept designed to make unreliable vehicle telemetry easier to understand. Try the interactive simulated fleet demo.",
};

const proof = [
  { value: "5,000", label: "simulated vehicles rendered in the demo" },
  { value: "0", label: "false speeding alerts in a scored simulation" },
  { value: "1.4 m", label: "p95 replay position difference in evaluation" },
  { value: "600", label: "Lagos road routes in the simulator" },
];

const features = [
  {
    number: "01",
    title: "See the whole operation",
    description:
      "Explore a fleet on a live map, find a vehicle, inspect its details, and follow it across the city.",
    tags: "MAP · SEARCH · VEHICLE DETAILS",
  },
  {
    number: "02",
    title: "Make sense of messy signals",
    description:
      "The feed is designed for late, duplicated, out-of-order, and missing GPS reports—not just the happy path.",
    tags: "ORDERING · SMOOTHING · ALERTS",
  },
  {
    number: "03",
    title: "Review events in context",
    description:
      "Explore zones, inspect alert context, and replay the recent simulated fleet through the same map.",
    tags: "ZONES · ALERTS · REPLAY",
  },
];

const roadmap = [
  ["01 / NOW", "Demonstrate", "Publish a clear, accessible demo and make its engineering evidence easy to explore."],
  ["02 / NEXT", "Validate", "Test real tracker data with an operator or telematics partner before treating simulation assumptions as fact."],
  ["03 / LATER", "Make it shared", "Add organizations, roles, durable history, and notifications when a real pilot confirms the need."],
];

export default function Home() {
  return (
    <SiteShell>
      <main id="main-content">
        <FleetLiveHero
          demoHref="/app"
          platformHref="/platform"
          navLinks={[]}
          showNav={false}
          className="-mt-[80px] md:-mt-[68px]"
        />

        <section aria-label="Project evaluation results" className="border-b border-brand-line bg-white">
          <div className="mx-auto grid max-w-[90rem] grid-cols-2 divide-x divide-y divide-brand-line px-5 sm:px-6 md:grid-cols-4 md:divide-y-0">
            {proof.map((item) => (
              <div key={item.value} className="px-4 py-6 first:pl-0 sm:px-6 sm:py-7 md:first:pl-0">
                <p className="text-2xl font-semibold tracking-tight text-brand-ink sm:text-3xl">{item.value}</p>
                <p className="mt-1.5 max-w-[190px] text-xs leading-5 text-brand-muted sm:text-sm">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto max-w-[90rem] px-5 pb-4 text-[10px] leading-4 text-slate-500 sm:px-6">
            Deterministic simulation and benchmark results, not field or customer outcomes. Refer to the project evaluations for conditions and methodology.
          </p>
        </section>

        <section className="px-5 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-[90rem]">
            <SectionHeading
              eyebrow="THE OPERATIONS CONSOLE"
              title="From noisy pings to a useful picture."
              description="Fleet Live brings the dispatcher’s core view together and treats poor-quality telemetry as a first-class engineering problem."
            />
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {features.map((feature) => (
                <article key={feature.number} className="rounded-2xl border border-brand-line bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-ink/5">
                  <p className="font-mono text-xs text-brand-green">{feature.number} <span className="text-slate-400">/ CAPABILITY</span></p>
                  <h3 className="mt-7 text-xl font-semibold tracking-tight text-brand-ink">{feature.title}</h3>
                  <p className="mt-3 min-h-[96px] text-sm leading-6 text-brand-muted">{feature.description}</p>
                  <p className="mt-5 border-t border-brand-line pt-4 text-[10px] font-medium tracking-[0.11em] text-slate-500">{feature.tags}</p>
                </article>
              ))}
            </div>
            <div className="mt-8 flex flex-col justify-between gap-5 rounded-2xl border border-brand-green/15 bg-brand-tint p-6 sm:flex-row sm:items-center sm:p-8">
              <div>
                <p className="text-base font-semibold text-brand-ink">Try the real interactive console</p>
                <p className="mt-1 text-sm leading-6 text-brand-muted">Explore vehicle search, alerts, zones, replay, and the responsive map experience.</p>
              </div>
              <Link href="/app" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-ink px-4 text-sm font-semibold text-white transition hover:bg-brand-ink-soft">
                Launch the demo <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="relative isolate overflow-hidden border-y border-white/10 bg-brand-ink px-5 py-20 text-white sm:px-6 sm:py-24">
          <DitheredShaderBackground scale={0.22} />
          <div className="relative z-10 mx-auto grid max-w-[90rem] gap-12 lg:grid-cols-[.78fr_1.22fr]">
            <div>
              <Eyebrow dark>THE PRODUCT WEDGE</Eyebrow>
              <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">An intelligence layer, not another tracker brand.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                The strongest direction is to help fleet operators and telematics installers make more sense of the devices and feeds they already have.
              </p>
              <Link href="/use-cases" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-lime hover:text-brand-lime-hover">
                Explore the intended users <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {roadmap.map(([stage, title, description]) => (
                <article key={stage} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
                  <p className="text-[10px] font-bold tracking-[0.15em] text-brand-lime">{stage}</p>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto grid max-w-[90rem] items-center gap-10 lg:grid-cols-[1fr_auto]">
            <div>
              <Eyebrow>BUILT TO BE OPENED AND QUESTIONED</Eyebrow>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-brand-ink sm:text-4xl">A product demo with the engineering story behind it.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-brand-muted">
                Explore the architecture, measured trade-offs, accessibility work, and limitations. The project is transparent about what is implemented and what remains a proposal.
              </p>
            </div>
            <Link href="/engineering" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-ink px-5 text-sm font-semibold text-white transition hover:bg-brand-ink-soft">
              Explore the engineering <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
