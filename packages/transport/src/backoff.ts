/**
 * Reconnect delay with "full jitter": a random wait between 0 and an
 * exponentially growing ceiling.
 *
 *   delay = random() × min(cap, base × 2^attempt)
 *
 * Without jitter, every client that lost the same server at the same moment
 * retries at the same moments too, and the server is hit by synchronised
 * waves as it comes back. Spreading each retry across the whole window
 * breaks up the waves. AWS's "Exponential Backoff and Jitter" compares the
 * common variants. Full jitter is among the best of them, and the simplest.
 */
export function backoffDelay(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return random() * ceiling;
}
