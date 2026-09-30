"use client";

import { useEffect, useState } from "react";
import type { FleetStatus, SnapshotListener } from "./use-fleet";

interface Props {
  status: FleetStatus | null;
  error: string | null;
  subscribe: (listener: SnapshotListener) => () => void;
}

const STATE_LABEL = {
  connecting: "Connecting…",
  open: "Live",
  waiting: "Reconnecting",
  stopped: "Stopped",
} as const;

const number = new Intl.NumberFormat("en-NG");

/**
 * One honest line: where the data comes from, whether it's flowing, how many
 * trucks, and how far behind real time the map is drawing. The lag is shown
 * rather than hidden, because the map deliberately renders in the past.
 */
export function StatusBar({ status, error, subscribe }: Props) {
  const [trucks, setTrucks] = useState(0);
  // Only the count is taken from the snapshot, as state, at 2 Hz. One number, not 5,000 trucks.
  useEffect(() => subscribe((s) => setTrucks(s.count)), [subscribe]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!status) return <p className="text-sm text-muted">Starting the fleet…</p>;

  const { connection, feed, delayMs, mode } = status;
  const live = connection.state === "open";
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span className="font-medium">{mode === "demo" ? "Demo fleet" : "Network"}</span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${live ? "bg-live" : "bg-warn"}`} />
        {STATE_LABEL[connection.state]}
      </span>
      {/* Only a change of connection state is worth interrupting a screen reader for. The counts and
          the delay shift constantly, so the whole line as a live region would never stop talking. */}
      <span className="sr-only" aria-live="polite">
        {`Connection ${STATE_LABEL[connection.state].toLowerCase()}`}
      </span>
      <span>{number.format(trucks)} trucks</span>
      <span>as of {(delayMs / 1000).toFixed(1)} s ago</span>
      {connection.reconnects > 0 && <span>{connection.reconnects} reconnects</span>}
      {feed.framesMissed > 0 && <span>{number.format(feed.framesMissed)} frames missed</span>}
    </p>
  );
}
