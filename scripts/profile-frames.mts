/**
 * What are the slow frames made of? Records a Chrome performance trace while
 * the app runs with the list, a selection and the detail panel live, then
 * breaks every main-thread task over one frame's budget down by what ran
 * inside it.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm profile:frames [query]
 */
import { BASE_URL, READY_MS, launchBrowser } from "./browser.mts";

const query = process.argv[2] ?? "";
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE_URL + query);
await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: READY_MS });
await page.waitForSelector('[role="option"]');
await page.locator('[role="option"]').nth(3).click(); // a selection and the detail panel, as in the UI check
await page.waitForTimeout(3000);

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { data?: { functionName?: string; url?: string; frame?: string }; name?: string };
}
const client = await page.context().newCDPSession(page);
const events: TraceEvent[] = [];
// The protocol types trace events loosely ({ [key]: string }); they are TraceEvent-shaped in practice.
client.on("Tracing.dataCollected", (e) => events.push(...(e.value as unknown as TraceEvent[])));
const done = new Promise<void>((resolve) => client.once("Tracing.tracingComplete", () => resolve()));
await client.send("Tracing.start", {
  categories: ["devtools.timeline", "v8", "v8.execute", "disabled-by-default-devtools.timeline", "blink.user_timing", "toplevel"].join(","),
  transferMode: "ReportEvents",
});
const frameDeltas = (await page.evaluate(`new Promise((resolve) => {
  const d = []; let prev = performance.now(); const end = prev + 10000;
  const tick = (t) => { d.push(t - prev); prev = t; if (t < end) requestAnimationFrame(tick); else resolve(d); };
  requestAnimationFrame(tick);
})`)) as number[];
await client.send("Tracing.end");
await done;
await browser.close();

// The renderer's main thread is the one that ran our frame loop.
const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" && events.some((x) => x.pid === e.pid && x.name === "FunctionCall"));
if (!main) throw new Error("renderer main thread not found in trace");
const complete = events.filter((e) => e.ph === "X" && e.dur !== undefined);
const onMain = complete.filter((e) => e.pid === main.pid && e.tid === main.tid);
const gpuPids = new Set(events.filter((e) => e.name === "process_name" && /GPU/i.test(e.args?.name ?? "")).map((e) => e.pid));

const WRAPPERS = /^(ThreadControllerImpl::RunTask|RunTask|TimerBase::run|ThreadPool_RunTask|SimpleWatcher::OnHandleReady)$/;
const label = (e: TraceEvent): string => {
  if (e.name === "FunctionCall" || e.name === "EvaluateScript") {
    const url = e.args?.data?.url ?? "";
    const file = url.split("/").pop()?.replace(/[?].*$/, "") || "(inline)";
    return `JS ${e.args?.data?.functionName || "(anonymous)"} @ ${file}`;
  }
  if (/GC|Scavenge|MarkCompact/i.test(e.name)) return `GC ${e.name}`;
  return e.name;
};

// Dropped frames: gaps over 20 ms between consecutive animation-frame callbacks.
const rafs = onMain.filter((e) => e.name === "FireAnimationFrame").sort((a, b) => a.ts - b.ts);
const gaps: [number, number][] = [];
for (let i = 1; i < rafs.length; i++) if (rafs[i]!.ts - rafs[i - 1]!.ts > 20_000) gaps.push([rafs[i - 1]!.ts, rafs[i]!.ts]);

const sorted = [...frameDeltas].sort((a, b) => a - b);
console.log(`${(frameDeltas.length / 10).toFixed(0)} fps · p99 ${sorted[Math.floor(0.99 * sorted.length)]!.toFixed(1)} ms · dropped frames in trace (rAF gap > 20 ms): ${gaps.length}`);

const totals = new Map<string, number>();
for (const [from, to] of gaps) {
  // Leaf-ish work on the main thread inside the gap: skip scheduler wrappers, keep the outermost real event.
  const inGap = onMain.filter((e) => e.ts < to && e.ts + e.dur! > from && !WRAPPERS.test(e.name));
  const outermost = inGap.filter((e) => !inGap.some((p) => p !== e && p.ts <= e.ts && p.ts + p.dur! >= e.ts + e.dur! && p.dur! > e.dur!));
  const parts = outermost.map((e) => [label(e), e.dur! / 1000] as const).sort((a, b) => b[1] - a[1]);
  const gpuTop = complete
    .filter((e) => gpuPids.has(e.pid) && e.ts < to && e.ts + e.dur! > from && e.dur! > 1000 && !WRAPPERS.test(e.name))
    .sort((a, b) => b.dur! - a.dur!)
    .slice(0, 2)
    .map((e) => `${e.name} ${(e.dur! / 1000).toFixed(1)}`)
    .join(" · ");
  console.log(`  gap ${((to - from) / 1000).toFixed(1)} ms · main: ${parts.slice(0, 4).map(([n, d]) => `${n} ${d.toFixed(1)}`).join(" · ") || "(idle)"} · GPU process: ${gpuTop || "(nothing over 1 ms)"}`);
  for (const [n, d] of parts) totals.set(n, (totals.get(n) ?? 0) + d);
}
if (gaps.length) {
  console.log("  main-thread time inside dropped frames, by what ran:");
  for (const [n, d] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${d.toFixed(1).padStart(6)} ms  ${n}`);
}
const gc = onMain.filter((e) => /GC|Scavenge|MarkCompact/i.test(e.name) && !onMain.some((p) => p !== e && /GC|Scavenge|MarkCompact/i.test(p.name) && p.ts <= e.ts && p.ts + p.dur! >= e.ts + e.dur! && p.dur! > e.dur!));
console.log(`garbage collection on the main thread: ${gc.length} collections, ${(gc.reduce((n, e) => n + e.dur!, 0) / 1000).toFixed(1)} ms in 10 s, longest ${(Math.max(0, ...gc.map((e) => e.dur!)) / 1000).toFixed(1)} ms`);
