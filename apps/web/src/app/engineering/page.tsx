import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, SiteShell } from "@/components/site-shell";
import {
  CtaPanel,
  FlowRail,
  Panel,
  Principles,
  Section,
  StatStrip,
  TwoUp,
} from "@/components/ui/fleet-live-ui";

export const metadata: Metadata = {
  title: "Engineering",
  description: "Explore Fleet Live's real-time architecture: feed ordering, Web Workers, WebGL2 rendering, alert evaluation, replay, and accessibility.",
};

const components = [
  ["Simulator + network chaos", "Seeded vehicle routes and configurable packet delay, loss, duplication, reordering, and disconnects."],
  ["Worker-owned feed", "Decode, deduplicate, order, smooth, and evaluate alert state away from the React render loop."],
  ["WebGL2 vehicle layer", "Interpolate the fleet on the GPU rather than rebuilding a large map source on every update."],
  ["Dispatcher interface", "Map, list, details, alerts, zones, replay, keyboard navigation, and mobile sheet."],
];

const results = [
  { value: "5,000", label: "vehicles rendered in the demo scenario", note: "Stress size can be raised to 20,000." },
  { value: "0", label: "false speeding alerts in evaluation", note: "Against 270 from a naive rule in the same simulated scenario." },
  { value: "1.4 m", label: "p95 replay position difference", note: "Compared with the live estimate in the documented evaluation." },
  { value: "0–1", label: "long tasks per 10 seconds", note: "Recorded in the benchmark run against 20–29 for the stock GeoJSON baseline." },
];

export default function EngineeringPage() {
  return (
    <SiteShell>
      <main id="main-content">
        <PageIntro
          eyebrow="ENGINEERING CASE STUDY"
          title="A real-time systems problem, expressed as a product."
          description="The map is only the visible layer. Fleet Live explores correctness under imperfect data, smooth high-volume rendering, alert quality, replay, and accessible controls."
        />
        <Section tone="paper" edge title="From simulated ping to dispatcher decision.">
          <FlowRail
            label="Data flow"
            stages={components.map(([title, body]) => ({ title, body }))}
          />
        </Section>
        <Section
          tone="mist"
          title="Numbers with their conditions attached."
          lede="These figures come from documented simulations and benchmark runs. They are project evidence—not promises about live fleets."
        >
          <StatStrip
            items={results.map((result) => ({
              value: result.value,
              label: result.label,
              note: result.note,
            }))}
          />
        </Section>
        <Section tone="paper" edge layout="split" title="Keep the result stable when the network is not.">
          <TwoUp
            left={
              <Principles
                items={[
                  { lead: "Order is explicit.", text: "Per-vehicle sequence numbers—not packet arrival order—drive the track." },
                  { lead: "The UI is not the stream processor.", text: "High-frequency data stays in the worker and GPU state." },
                  { lead: "Test the ugly cases.", text: "Seeded chaos makes dropped, duplicated, delayed, and reordered packets repeatable." },
                  { lead: "Accessibility is part of the map.", text: "The list and details provide a keyboard- and screen-reader path to vehicle information." },
                ]}
              />
            }
            right={
              <Panel kicker="Trade-offs and limits" title="What this evidence does—and doesn’t—say.">
                <ul className="m-0 grid list-none gap-3 p-0">
                  <li>Performance has been measured on one laptop; low-end Android and broader device coverage remain to be checked.</li>
                  <li>Alert quality is evaluated against simulator ground truth, not real driving behavior.</li>
                  <li>History and zones are browser-session/local data, not shared or durable organization records.</li>
                  <li>A manual screen-reader pass and real-device pilot remain future validation work.</li>
                </ul>
                <Link href="/product-direction" className="mt-6 inline-flex text-sm font-semibold text-brand-green hover:underline">
                  See what needs validation next →
                </Link>
              </Panel>
            }
          />
        </Section>
        <Section tone="ink" edge>
          <CtaPanel
            title="Walk through the running system"
            body="Open the interactive demo, then use the five-minute walkthrough in the repository README to explore the important engineering decisions."
            action={{ label: "Explore the interactive demo", href: "/app" }}
          />
        </Section>
      </main>
    </SiteShell>
  );
}
