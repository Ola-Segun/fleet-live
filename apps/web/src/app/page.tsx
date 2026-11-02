import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { FleetLiveHero } from "@/components/ui/fleet-live-hero";
import {
  CapabilityGrid,
  CtaPanel,
  FlowRail,
  Section,
  StatStrip,
} from "@/components/ui/fleet-live-ui";

export const metadata: Metadata = {
  title: "Fleet operations, without the noise",
  description:
    "Explore Fleet Live, a real-time fleet operations concept designed to make unreliable vehicle telemetry easier to understand. Try the interactive simulated fleet demo.",
};

const proof = [
  { value: "5,000", label: "vehicles rendered in the demo", note: "Stress size can be raised to 20,000." },
  { value: "0", label: "false speeding alerts in evaluation", note: "Compared with 270 from a naive rule in the same simulation." },
  { value: "1.4 m", label: "p95 replay position difference", note: "Measured against the live estimate in the documented evaluation." },
  { value: "600", label: "Lagos road routes in the simulator", note: "Seeded routes make repeatable evaluation possible." },
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
  { title: "Demonstrate", body: "Publish a clear, accessible demo and make its engineering evidence easy to explore." },
  { title: "Validate", body: "Test real tracker data with an operator or telematics partner before treating simulation assumptions as fact." },
  { title: "Make it shared", body: "Add organizations, roles, durable history, and notifications when a real pilot confirms the need." },
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

        <Section
          tone="paper"
          edge
          eyebrow="PROJECT EVALUATION"
          title="Measured results from the demo."
          lede="Deterministic simulation and benchmark results—not field or customer outcomes. Explore the engineering case study for conditions and methodology."
        >
          <StatStrip items={proof} />
        </Section>

        <Section
          tone="mist"
          layout="split"
          eyebrow="THE OPERATIONS CONSOLE"
          title="From noisy pings to a useful picture."
          lede="Fleet Live brings the dispatcher’s core view together and treats poor-quality telemetry as a first-class engineering problem."
        >
          <CapabilityGrid
            items={features.map((feature) => ({
              kicker: `${feature.number} / CAPABILITY`,
              title: feature.title,
              body: feature.description,
              tags: feature.tags.split(" · "),
            }))}
          />
          <CtaPanel
            status="SIMULATED DATA · INTERACTIVE DEMO"
            title="Try the real operations console."
            body="Choose your fleet size and scenario, then explore vehicle search, alerts, zones, and replay."
            action={{ label: "Set up the demo", href: "/app" }}
          />
        </Section>

        <Section
          tone="ink"
          edge
          layout="split"
          eyebrow="THE PRODUCT WEDGE"
          title="An intelligence layer, not another tracker brand."
          lede="The strongest direction is to help fleet operators and telematics installers make more sense of the devices and feeds they already have."
          action={{ label: "Explore the intended users", href: "/use-cases" }}
        >
          <FlowRail
            label="Product direction"
            stages={roadmap}
          />
        </Section>

        <Section
          tone="paper"
          layout="split"
          eyebrow="BUILT TO BE OPENED AND QUESTIONED"
          title="A product demo with the engineering story behind it."
          lede="Explore the architecture, measured trade-offs, accessibility work, and limitations. The project is transparent about what is implemented and what remains a proposal."
        >
          <CtaPanel
            status="ENGINEERING CASE STUDY"
            title="Explore how the system works."
            body="Follow the data pipeline, rendering decisions, evaluation results, and known limitations."
            action={{ label: "Explore the engineering", href: "/engineering" }}
          />
        </Section>
      </main>
    </SiteShell>
  );
}
