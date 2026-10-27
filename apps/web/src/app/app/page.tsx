import { Suspense } from "react";
import type { Metadata } from "next";
import { FleetApp } from "@/features/live-map/FleetApp";

export const metadata: Metadata = {
  title: "Interactive fleet demo",
  description:
    "Explore the Fleet Live dispatcher console with simulated vehicles, alerts, geofences, and replay.",
};

export default function DemoPage() {
  // FleetApp reads URL state with useSearchParams, so it needs a Suspense boundary.
  return (
    <Suspense>
      <FleetApp />
    </Suspense>
  );
}
