import type { LatLon } from "./geo";

export type PlaceKind = "port" | "industrial" | "market" | "district";

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Approximate. OSRM snaps it to the nearest road, and the generator rejects a snap over 500 m. */
  at: LatLon;
}

/*
 * 25 places: where freight actually starts and ends in Lagos. The ports
 * (Apapa and Tin Can are notorious for truck queues), the industrial estates on
 * the Ogun border, the big markets, and the districts deliveries go to. All
 * 300 unordered pairs become routes.
 */
export const PLACES: readonly Place[] = [
  { id: "apapa-port", name: "Apapa Port", kind: "port", at: [6.443, 3.364] },
  { id: "tincan-port", name: "Tin Can Island Port", kind: "port", at: [6.439, 3.345] },
  { id: "lekki-port", name: "Lekki Deep Sea Port", kind: "port", at: [6.429, 4.012] },
  { id: "ikeja-industrial", name: "Ikeja Industrial Estate", kind: "industrial", at: [6.603, 3.35] },
  { id: "agbara", name: "Agbara Industrial Estate", kind: "industrial", at: [6.51, 3.105] },
  { id: "ota", name: "Ota Industrial Area", kind: "industrial", at: [6.68, 3.23] },
  { id: "ikorodu", name: "Ikorodu Industrial", kind: "industrial", at: [6.615, 3.505] },
  { id: "amuwo-odofin", name: "Amuwo Odofin Industrial", kind: "industrial", at: [6.463, 3.295] },
  { id: "mile-12", name: "Mile 12 Market", kind: "market", at: [6.609, 3.399] },
  { id: "alaba", name: "Alaba International Market", kind: "market", at: [6.46, 3.19] },
  { id: "trade-fair", name: "Trade Fair Complex", kind: "market", at: [6.467, 3.257] },
  { id: "idumota", name: "Idumota Market", kind: "market", at: [6.455, 3.388] },
  { id: "oshodi", name: "Oshodi", kind: "district", at: [6.555, 3.343] },
  { id: "ojota", name: "Ojota", kind: "district", at: [6.585, 3.379] },
  { id: "berger", name: "Berger", kind: "district", at: [6.64, 3.369] },
  { id: "ikotun", name: "Ikotun", kind: "district", at: [6.55, 3.264] },
  { id: "surulere", name: "Surulere", kind: "district", at: [6.499, 3.353] },
  { id: "yaba", name: "Yaba", kind: "district", at: [6.509, 3.378] },
  { id: "victoria-island", name: "Victoria Island", kind: "district", at: [6.429, 3.421] },
  { id: "lekki-phase-1", name: "Lekki Phase 1", kind: "district", at: [6.448, 3.472] },
  { id: "ajah", name: "Ajah", kind: "district", at: [6.468, 3.57] },
  { id: "festac", name: "Festac Town", kind: "district", at: [6.467, 3.283] },
  { id: "ogba", name: "Ogba", kind: "district", at: [6.626, 3.342] },
  { id: "epe", name: "Epe", kind: "district", at: [6.584, 3.983] },
  { id: "badagry", name: "Badagry", kind: "district", at: [6.42, 2.885] },
];

/** Every unordered pair, in a fixed order, so regenerating produces the same file. */
export function placePairs(places: readonly Place[] = PLACES): [Place, Place][] {
  const pairs: [Place, Place][] = [];
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) pairs.push([places[i]!, places[j]!]);
  }
  return pairs;
}
