import { ALL_GROUPS, type StatusGroup } from "@fleet/gl";

/**
 * The dispatcher's view in the URL, so a copied link reopens exactly what they
 * see: which truck, whether the camera follows it, which statuses are shown,
 * and the search text. (The camera itself is `c=`, see camera-url.ts.)
 *
 *   ?v=1042&f=1&s=moving,stale&q=KJA
 */
export interface UiState {
  vehicle: number | undefined;
  follow: boolean;
  groups: StatusGroup[];
  query: string;
}

const isGroup = (value: string): value is StatusGroup => (ALL_GROUPS as readonly string[]).includes(value);

/** Parses untrusted URL input. Anything malformed falls back to the default view. */
export function parseUi(params: URLSearchParams): UiState {
  const v = Number(params.get("v"));
  const vehicle = params.has("v") && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff ? v : undefined;
  const listed = (params.get("s") ?? "").split(",").filter(isGroup);
  return {
    vehicle,
    follow: vehicle !== undefined && params.get("f") === "1",
    groups: params.has("s") ? [...new Set(listed)] : [...ALL_GROUPS],
    query: (params.get("q") ?? "").slice(0, 64),
  };
}

/** Writes the view into `url`, leaving other parameters (camera, mode, hud) alone. Defaults are omitted. */
export function writeUi(url: URL, ui: UiState): URL {
  const p = url.searchParams;
  const set = (key: string, value: string | undefined) => (value === undefined ? p.delete(key) : p.set(key, value));
  set("v", ui.vehicle === undefined ? undefined : String(ui.vehicle));
  set("f", ui.follow && ui.vehicle !== undefined ? "1" : undefined);
  const all = ui.groups.length === ALL_GROUPS.length;
  set("s", all ? undefined : ALL_GROUPS.filter((g) => ui.groups.includes(g)).join(","));
  set("q", ui.query ? ui.query : undefined);
  return url;
}
