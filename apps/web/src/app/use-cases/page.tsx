import type { Metadata } from "next";
import { PageIntro, SiteShell } from "@/components/site-shell";
import { CtaPanel, Section, SpecSheet } from "@/components/ui/fleet-live-ui";

export const metadata: Metadata = {
  title: "Use cases",
  description: "Who Fleet Live is designed to serve: fleet operations teams, telematics partners, and teams exploring real-time systems.",
};

const audiences = [
  {
    label: "01 / FLEET OPERATIONS",
    title: "A clearer view for dispatch teams",
    problem: "Dispatchers need to scan many vehicles, find a specific truck quickly, and understand whether a location signal needs attention.",
    demo: "The demo brings the map, searchable list, vehicle details, zones, alerts, and session replay into one responsive control-room view.",
    next: "A real deployment would need real tracker data, shared fleet configuration, durable history, and alert escalation beyond the browser.",
  },
  {
    label: "02 / TELEMATICS PARTNERS",
    title: "A potential intelligence layer for existing devices",
    problem: "Installers and telematics providers already operate hardware and field support; an additional software layer could help customers interpret their signals.",
    demo: "The feed and rendering pipeline demonstrate how unreliable updates can be processed without tying high-frequency tracking state to UI rendering.",
    next: "Partner integrations, tenant boundaries, device provisioning, and pilot validation would be required before this could serve partner fleets.",
  },
  {
    label: "03 / PRODUCT & ENGINEERING",
    title: "A practical case study in real-time interfaces",
    problem: "Live dashboards have to balance data correctness, rendering performance, accessibility, and recovery from network issues.",
    demo: "Fleet Live exposes the architecture and trade-offs through a working demo, deterministic tests, evaluations, and a guided technical walkthrough.",
    next: "Results should be retested against real device behavior and a wider range of hardware before being generalized.",
  },
];

export default function UseCasesPage() {
  return (
    <SiteShell>
      <main id="main-content">
        <PageIntro
          eyebrow="WHO IT IS FOR · A POSITIONING HYPOTHESIS"
          title="Designed for the people who need to understand a moving fleet."
          description="Fleet Live is currently a product and engineering demonstration. These are the audiences and operational problems the product direction is designed around—not customer deployments or validated case studies."
        />
        <Section
          tone="paper"
          edge
          title="A positioning hypothesis, made testable."
          lede="Each audience has a specific operational need, a concrete demo capability, and a clear list of what validation still has to prove."
        >
          <SpecSheet
            items={audiences.map((item) => ({
              kicker: item.label.split(" / ")[1] ?? item.label,
              title: item.title,
              need: item.problem,
              shows: item.demo,
              missing: item.next,
            }))}
            labels={["The need", "What the demo shows", "What still needs validation"]}
          />
        </Section>
        <Section
          tone="teal"
          edge
          title="Do teams trust their alerts enough to act on them?"
          lede="A focused pilot should measure actual device behavior, false alerts, time to acknowledgement, and whether the information changes an operational decision."
          action={{ label: "Explore the engineering case study", href: "/engineering" }}
        >
          <CtaPanel
            status="Validation before expansion"
            title="See the product direction"
            body="The next stage is validation with real devices and operators—not adding features before the problem is confirmed."
            action={{ label: "View the roadmap", href: "/product-direction" }}
          />
        </Section>
      </main>
    </SiteShell>
  );
}
