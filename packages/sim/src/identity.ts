import type { Rng } from "./random";

/*
 * Nigerian plates read like "KJA-482XR": a three-letter local-government code,
 * three digits, two letters. These are real Lagos LGA codes. The plates
 * themselves are invented.
 */
const LGA_CODES = ["KJA", "APP", "EPE", "IKD", "BDG", "LND", "EKY", "MUS", "KTU", "AGL", "SMK", "FKJ"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, which read as 1 and 0

const FIRST_NAMES = [
  "Adebayo", "Chinedu", "Musa", "Emeka", "Tunde", "Ibrahim", "Segun", "Obinna", "Yusuf", "Kunle",
  "Ifeanyi", "Abdullahi", "Femi", "Uche", "Sani", "Bola", "Nnamdi", "Aliyu", "Gbenga", "Chukwuma",
];
const SURNAMES = [
  "Okafor", "Adeyemi", "Bello", "Nwosu", "Balogun", "Abubakar", "Eze", "Ogunleye", "Danjuma", "Okonkwo",
  "Afolabi", "Mohammed", "Chukwu", "Adebisi", "Garba", "Onyeka", "Olawale", "Yakubu", "Nwankwo", "Ajayi",
];

export function makePlate(rng: Rng): string {
  const letters = () => LETTERS[rng.int(0, LETTERS.length - 1)]!;
  return `${rng.pick(LGA_CODES)}-${rng.int(100, 999)}${letters()}${letters()}`;
}

export function makeDriverName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
}
