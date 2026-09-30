import type { Alert } from "@fleet/alerts";

/**
 * How alerts read, on screen and when announced. One wording for both, so a
 * screen-reader user hears what a sighted user reads.
 */

/** Lagos time, since that's where the fleet is, whatever the viewer's own time zone. */
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const lagosTime = (epochMs: number): string => clock.format(epochMs);

export interface AlertNames {
  plate: (vehicleId: number) => string;
  zone: (zoneId: string | undefined) => string;
}

/** The alert as one sentence, without its state: "KJA-123-XY entered Third Mainland Bridge". */
export function alertText(a: Alert, names: AlertNames): string {
  const plate = names.plate(a.vehicleId);
  switch (a.kind) {
    case "zone-enter":
      return `${plate} entered ${names.zone(a.zoneId)}`;
    case "zone-exit":
      return `${plate} left ${names.zone(a.zoneId)}`;
    case "speeding":
      return `${plate} speeding, up to ${a.detail} km/h`;
    case "offline":
      return `${plate} not reporting since ${lagosTime(a.detail)}`;
  }
}

/** Where the alert stands: whether its condition still holds, how often it's happened, and who has seen it. */
export function alertStatus(a: Alert): string {
  const parts = [a.active ? "Active" : `Ended ${lagosTime(a.clearedAt ?? a.lastRaisedAt)}`, `raised ${lagosTime(a.lastRaisedAt)}`];
  if (a.occurrences > 1) parts.push(`${a.occurrences} times`);
  if (a.acknowledgedAt !== undefined) parts.push("acknowledged");
  return parts.join(", ");
}

/**
 * What to say when alerts are raised. Several at once become one sentence with
 * the count and the latest, so a screen reader isn't made to read ten in a row.
 */
export function announcement(raised: readonly Alert[], names: AlertNames): string {
  if (raised.length === 0) return "";
  const latest = raised.reduce((a, b) => (b.lastRaisedAt >= a.lastRaisedAt ? b : a));
  if (raised.length === 1) return `Alert: ${alertText(latest, names)}.`;
  return `${raised.length} new alerts. Latest: ${alertText(latest, names)}.`;
}
