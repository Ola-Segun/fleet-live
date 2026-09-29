/**
 * The map camera in the URL, so a dispatcher can paste a link that opens
 * exactly the view they're looking at: `?c=6.52440,3.37920,11.50`.
 *
 * Latitude and longitude are kept to 5 decimal places (about 1 m), which is
 * as precise as a shared view needs to be and keeps the URL short.
 */
export interface Camera {
  lat: number;
  lng: number;
  zoom: number;
}

/** Lagos, framed to show the ports, the mainland and the island. */
export const DEFAULT_CAMERA: Camera = { lat: 6.52, lng: 3.38, zoom: 10.5 };

export function formatCamera({ lat, lng, zoom }: Camera): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${zoom.toFixed(2)}`;
}

/** Parses untrusted URL input. Anything malformed or out of range gives undefined, never a broken map. */
export function parseCamera(value: string | null | undefined): Camera | undefined {
  if (!value) return undefined;
  const parts = value.split(",");
  if (parts.length !== 3) return undefined;
  const [lat, lng, zoom] = parts.map(Number) as [number, number, number];
  if (![lat, lng, zoom].every(Number.isFinite)) return undefined;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180 || zoom < 0 || zoom > 22) return undefined;
  return { lat, lng, zoom };
}
