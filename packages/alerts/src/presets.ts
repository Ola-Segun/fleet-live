import type { ZoneDraft } from "./geojson";

/**
 * Zones the demo starts with, so alerts appear without drawing anything first.
 *
 * The bridge corridor was built from the committed routes' own centreline
 * (17 of the 600 routes cross it), 70 m either side, so it covers exactly
 * where simulated trucks drive. The port box is approximate: a few hundred
 * metres around the point the routes start and end at.
 */
export const PRESET_ZONES: readonly (ZoneDraft & { presetId: string })[] = [
  {
    presetId: "third-mainland-bridge",
    name: "Third Mainland Bridge",
    kind: "restricted",
    alertOnEnter: true,
    alertOnExit: false,
    coordinates: [[[
      [3.40432, 6.505], [3.40497, 6.5075], [3.40549, 6.51], [3.4059, 6.5125], [3.40606, 6.515], [3.40602, 6.5175],
      [3.40582, 6.52], [3.40519, 6.5225], [3.40499, 6.525], [3.40132, 6.535], [3.40083, 6.5375], [3.40041, 6.54],
      [3.3998, 6.5425], [3.39935, 6.545], [3.39808, 6.545], [3.39853, 6.5425], [3.39914, 6.54], [3.39957, 6.5375],
      [3.40006, 6.535], [3.40372, 6.525], [3.40392, 6.5225], [3.40456, 6.52], [3.40475, 6.5175], [3.40479, 6.515],
      [3.40463, 6.5125], [3.40423, 6.51], [3.4037, 6.5075], [3.40305, 6.505], [3.40432, 6.505],
    ]]],
  },
  {
    presetId: "apapa-port",
    name: "Apapa Port",
    kind: "depot",
    alertOnEnter: false,
    alertOnExit: false,
    coordinates: [[[[3.3595, 6.4395], [3.3685, 6.4395], [3.3685, 6.4465], [3.3595, 6.4465], [3.3595, 6.4395]]]],
  },
];
