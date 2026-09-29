/**
 * The only message a client ever sends: once, as a text frame, right after the
 * socket opens.
 *
 *   { "type": "hello" }                       a fresh client: send a snapshot, then live frames
 *   { "type": "hello", "resumeAfter": 1234 }  a returning client: send every frame after 1234
 *
 * If frame 1234 has already left the server's history, the server sends a
 * snapshot instead. The feed is order- and duplicate-independent (Layer 4),
 * so a snapshot's pings can safely overlap what the client already has.
 */
export interface Hello {
  type: "hello";
  resumeAfter?: number;
}

export function encodeHello(resumeAfter: number | undefined): string {
  return JSON.stringify(resumeAfter === undefined ? { type: "hello" } : { type: "hello", resumeAfter });
}

/** Parses untrusted client input. Returns undefined for anything that isn't a valid hello. */
export function parseHello(text: string): Hello | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "hello") return undefined;
  const resumeAfter = (value as { resumeAfter?: unknown }).resumeAfter;
  if (resumeAfter === undefined) return { type: "hello" };
  if (typeof resumeAfter !== "number" || !Number.isInteger(resumeAfter) || resumeAfter < 0 || resumeAfter > 0xffff_ffff) {
    return undefined;
  }
  return { type: "hello", resumeAfter };
}
