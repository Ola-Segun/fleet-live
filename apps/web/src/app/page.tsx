import { Suspense } from "react";
import { FleetApp } from "@/features/live-map/FleetApp";

export default function Home() {
  // FleetApp reads the URL (camera, mode), which needs a Suspense boundary to prerender the shell.
  return (
    <Suspense>
      <FleetApp />
    </Suspense>
  );
}
