import type { Metadata } from "next";
import { PageIntro, SiteShell } from "@/components/site-shell";
import {
  BoundaryPair,
  CtaPanel,
  Section,
  Timeline,
} from "@/components/ui/fleet-live-ui";

export const metadata: Metadata = {
  title: "Product direction",
  description: "A staged path from Fleet Live's simulated product demo to real-device validation and a shared fleet operations platform.",
};

const stages = [
  {
    phase: "current" as const,
    status: "CURRENT · DEMONSTRATION",
    title: "Make the system easy to understand",
    summary: "Polish and publish the working demo as a transparent product and engineering portfolio project.",
    bullets: ["Guided product and engineering pages", "Accessibility and responsive review", "Repeatable demo and benchmark evidence"],
  },
  {
    phase: "next" as const,
    status: "NEXT · REAL-WORLD VALIDATION",
    title: "Learn from real devices and operators",
    summary: "Work with an operator or telematics partner to validate report intervals, GPS error, coverage gaps, and alert usefulness.",
    bullets: ["Small, consented device pilot", "Route-deviation and unplanned-stop hypotheses", "Measure acknowledgement and false-alarm rates"],
  },
  {
    phase: "later" as const,
    status: "LATER · SHARED OPERATIONS",
    title: "Turn individual state into team workflows",
    summary: "Only after the pilot, add the backend and shared controls needed by real organizations.",
    bullets: ["Authentication, organizations, and roles", "Shared zones, alerts, and audit history", "Server-side history and notification escalation"],
  },
  {
    phase: "future" as const,
    status: "FUTURE · ADJACENT VALUE",
    title: "Expand when customers prove the need",
    summary: "Choose additions based on validated operational pain and available device data, not a feature checklist.",
    bullets: ["Incident exports and trip reports", "Maintenance or vehicle-document reminders", "Fuel signals, driver tools, or dispatch integrations"],
  },
];

export default function ProductDirectionPage() {
  return (
    <SiteShell>
      <main id="main-content">
        <PageIntro
          eyebrow="PRODUCT DIRECTION · PROPOSAL"
          title="Earn the next stage with evidence."
          description="Fleet Live is a portfolio demonstration today. This roadmap shows a responsible path toward a real product: validate the operational value with real users and devices before building the organization, backend, and feature breadth around it."
        />
        <Section
          tone="paper"
          edge
          layout="split"
          title="Four stages, in the order the evidence allows."
          lede="Each stage is gated by what the previous one proves."
        >
          <Timeline
            items={stages.map((stage) => ({
              status: stage.phase,
              kicker: stage.status,
              title: stage.title,
              body: stage.summary,
              chips: stage.bullets,
            }))}
          />
        </Section>
        <Section
          tone="mist"
          title="Separate the working demo from the product proposal."
          lede="Being explicit about what exists today is part of a credible product direction."
        >
          <BoundaryPair
            available={{
              kicker: "What exists",
              title: "The working product demo",
              items: [
                "A dispatcher-facing browser app with a simulated fleet, map, search, and vehicle inspection.",
                "Alerts, zones, replay, and an engineering pipeline designed around imperfect feeds.",
                "Repeatable evaluation evidence and documented technical trade-offs.",
              ],
            }}
            limits={{
              kicker: "What is proposed",
              title: "A commercial multi-organization service",
              items: [
                "Real tracker ingest, identity, and tenant-scoped data are not built yet.",
                "Shared administration, persistent history, and external notifications are not built yet.",
                "Operations, support, and customer validation remain future work.",
              ],
            }}
          />
        </Section>
        <Section tone="teal" edge>
          <CtaPanel
            status="Validate before expanding"
            title="Earn the next stage with evidence."
            body="The first product milestone is not more features. It is evidence that teams trust the signals enough to act on them."
            action={{ label: "Explore the intended users", href: "/use-cases" }}
          />
        </Section>
      </main>
    </SiteShell>
  );
}
