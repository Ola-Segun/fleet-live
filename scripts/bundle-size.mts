/**
 * What the page makes a visitor download, gzipped, against a budget.
 *
 *   pnpm --filter @fleet/web build && pnpm bundle:size
 *
 * - **Up front:** the JavaScript and CSS the page's HTML asks for, before
 *   anything else can happen. This is what a slow phone waits for.
 * - **Later:** chunks loaded on demand. The map library loads with the map,
 *   and the route data only in demo mode, inside the Worker (network mode
 *   never downloads it).
 *
 * Budgets are the sizes measured when they were set (Layer 10) plus about 15%.
 * The point is to notice growth, not to hit a round number. Raise one on
 * purpose, in the same commit as the change that needs it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const NEXT = "apps/web/.next";
const BUDGET_KB = {
  upFront: 230, // measured 200: React, the Next.js runtime and the app shell
  largestLater: 430, // measured 372: the committed route data, 600 routes
  total: 1030, // measured 892
};

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length / 1024;
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const html = readFileSync(join(NEXT, "server/app/index.html"), "utf8");
const referenced = new Set([...html.matchAll(/(?:src|href)="\/_next\/(static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!));
const assets = walk(join(NEXT, "static")).filter((f) => /\.(js|css)$/.test(f));
const rel = (f: string) => f.slice(NEXT.length + 1).replace(/\\/g, "/");

const label = (file: string) => {
  const text = readFileSync(file, "utf8");
  if (text.includes('"attribution":"') && text.includes("OSRM")) return "route data (demo mode, in the Worker)";
  if (file.endsWith(".js") && text.includes("maplibregl")) return "map library (MapLibre GL)";
  if (file.endsWith(".css") && text.includes("maplibregl")) return "map library styles";
  return "";
};

const upFront = assets.filter((f) => referenced.has(rel(f)));
const later = assets.filter((f) => !referenced.has(rel(f))).map((f) => ({ f, kb: gz(f) })).sort((a, b) => b.kb - a.kb);
const upFrontKb = upFront.reduce((s, f) => s + gz(f), 0);
const laterKb = later.reduce((s, x) => s + x.kb, 0);
const largest = later[0];

console.log(`up front: ${upFrontKb.toFixed(0)} KB gz in ${upFront.length} files (budget ${BUDGET_KB.upFront})`);
console.log(`later:    ${laterKb.toFixed(0)} KB gz in ${later.length} files; largest:`);
for (const { f, kb } of later.slice(0, 4)) console.log(`  ${kb.toFixed(0).padStart(4)} KB  ${rel(f)}  ${label(f)}`);
console.log(`total:    ${(upFrontKb + laterKb).toFixed(0)} KB gz (budget ${BUDGET_KB.total})`);

const over = [
  ...(upFrontKb > BUDGET_KB.upFront ? [`up front ${upFrontKb.toFixed(0)} > ${BUDGET_KB.upFront} KB`] : []),
  ...(largest && largest.kb > BUDGET_KB.largestLater ? [`largest later chunk ${largest.kb.toFixed(0)} > ${BUDGET_KB.largestLater} KB`] : []),
  ...(upFrontKb + laterKb > BUDGET_KB.total ? [`total ${(upFrontKb + laterKb).toFixed(0)} > ${BUDGET_KB.total} KB`] : []),
];
if (upFront.length === 0) over.push("found no scripts in the page's HTML: the build output has changed shape");
console.log(over.length ? `\nOVER BUDGET: ${over.join("; ")}` : "\nwithin budget");
if (over.length) process.exitCode = 1;
