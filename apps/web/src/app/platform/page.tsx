import type { Metadata } from "next";
import { DemoPreview, PageIntro, SiteShell } from "@/components/site-shell";
import {
  BoundaryPair,
  CapabilityGrid,
  CtaPanel,
  Section,
} from "@/components/ui/fleet-live-ui";

export const metadata: Metadata = {
  title: "Platform",
  description: "Explore the Fleet Live demo capabilities: live fleet map, vehicle inspection, alerts, geofences, and replay.",
};

const capabilities = [
  {
    kicker: "Live map",
    title: "See the fleet",
    description: "Scan a live map and searchable vehicle list. Select a truck for context, filter the view, or follow it while it moves.",
    detail: "Interactive map · searchable list · vehicle details",
  },
  {
    kicker: "Alerts and zones",
    title: "Investigate signals",
    description: "Review simulated speeding, offline, and geofence events. Draw local zones and inspect the vehicles associated with an alert.",
    detail: "Alert panel · zone drawing · acknowledgement",
  },
  {
    kicker: "Replay",
    title: "Look back",
    description: "Use the session replay controls to inspect recent simulated activity with the same map and vehicle view used for live tracking.",
    detail: "In-session history · replay controls",
  },
];

export default function PlatformPage() {
  return (
    <SiteShell>
      <main id="main-content">
        <PageIntro
          eyebrow="THE PLATFORM · INTERACTIVE DEMO"
          title="A control-room view built around the realities of GPS."
          description="Explore the capabilities that are implemented today, and see how the product is designed to remain useful when location updates arrive late, out of order, more than once, or not at all."
        />
        <Section
          tone="paper"
          edge
          title="A working view, not a static mock-up."
          lede="The console combines the fleet map and operating controls in one responsive interface."
        >
          <DemoPreview />
          <p className="text-xs leading-5 text-slate-500">
            Illustrative preview. The interactive demo runs a seeded simulation over Lagos routes; it is not a live customer fleet.
          </p>
        </Section>
        <Section
          tone="mist"
          title="See the fleet, investigate signals, look back."
          lede="Three capabilities, all running on simulated data in your browser."
        >
          <CapabilityGrid
            items={capabilities.map((item, index) => ({
              kicker: item.kicker,
              title: item.title,
              body: item.description,
              tags: item.detail.split(" · "),
              lit: index === 0,
            }))}
          />
        </Section>
        <Section
          tone="ink"
          edge
          layout="stack"
          title="A demonstration with clear boundaries."
          lede="The current experience is interactive, but it is not yet a production fleet service."
          action={{ label: "Explore the engineering case study", href: "/engineering" }}
        >
          <BoundaryPair
            available={{
              kicker: "Available in the demo",
              title: "An interactive dispatcher experience",
              items: [
                "Live simulated map, searchable fleet, selection, and follow mode.",
                "Browser-local zones, alert review, theme settings, and replay.",
                "Worker-driven simulation and a WebGL2 vehicle layer.",
              ],
            }}
            limits={{
              kicker: "Not a production service yet",
              title: "The demo has deliberate boundaries",
              items: [
                "No real trackers or customer vehicle data are connected.",
                "No sign-in, tenant separation, shared server-side zones, or durable cloud history.",
                "Alerts do not notify a person outside this browser session.",
              ],
            }}
          />
          <CtaPanel
            status="Simulated data"
            title="See the controls in action"
            body="Try searching for a vehicle, opening its details, and exploring the alert, zone, and replay panels."
            action={{ label: "Explore the interactive demo", href: "/app" }}
          />
        </Section>
      </main>
    </SiteShell>
  );
}
