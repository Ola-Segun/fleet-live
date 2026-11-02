/**
 * Loads the running app in a real browser (your installed Chrome) and reports
 * what a person would see, plus the truck layer's main-thread cost.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm smoke:web [query]
 *
 * Queries: (none) = WebGL layer · ?layer=baseline = Layer 6's GeoJSON layer ·
 * ?trucks=off = the map alone. Comparing the three measures each layer by difference.
 *
 * Headless Chrome here renders on the laptop's Intel UHD GPU (ANGLE/Direct3D 11,
 * checked via WEBGL_debug_renderer_info). The comparison is fair because only
 * the layer changes.
 */
import { DEMO_URL, READY_MS, launchBrowser, timing } from "./browser.mts";

const query = process.argv[2] ?? "";
const base = DEMO_URL;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

// Strings, not functions: tsx wraps named functions in a `__name` helper that doesn't exist in the page.
const frameTimes = (ms: number) =>
  page.evaluate(`new Promise((resolve) => {
    const deltas = []; let prev = performance.now(); const end = prev + ${ms};
    const tick = (t) => { deltas.push(t - prev); prev = t; if (t < end) requestAnimationFrame(tick); else resolve(deltas); };
    requestAnimationFrame(tick);
  })`) as Promise<number[]>;
const perf = () => page.evaluate("window.__fleetPerf") as Promise<{ longTasks: number[]; layer?: { frames: number; renderMs: number; uploads: number; contextRestores: number } } | undefined>;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
};

await page.goto(base + query);
await page.getByText("Live").waitFor({ timeout: READY_MS });
await page.waitForTimeout(5000); // start-up: style, fonts, first tiles
// "Live" appears before the map has loaded. For the WebGL layer, wait until it is actually drawing.
if (!query) await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: READY_MS });
const longTasksAtStart = (await perf())?.longTasks.length ?? 0;

// Sample the WebGL layer's per-frame CPU time while measuring frame intervals.
const renderMs: number[] = [];
const sampler = setInterval(async () => {
  const p = await perf().catch(() => undefined);
  if (p?.layer) renderMs.push(p.layer.renderMs);
}, 100);
const deltas = await frameTimes(10_000);
clearInterval(sampler);
const afterSteady = await perf();
const steady = (afterSteady?.longTasks ?? []).slice(longTasksAtStart);

const status = (await page.locator("header p").innerText()).replace(/\s+/g, " ");
const mapBox = await page.locator(".maplibregl-map").boundingBox();
const mainBox = await page.locator("main").boundingBox();
await page.screenshot({ path: `scripts/smoke-web${query ? "-" + query.replace(/\W+/g, "") : ""}.png` });

// Lose the WebGL context on purpose and give it back: the trucks must return.
let contextCheck = "skipped (no WebGL layer)";
if (afterSteady?.layer) {
  await page.evaluate(`(() => {
    const gl = document.querySelector("canvas.maplibregl-canvas").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_lose_context");
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 500);
  })()`);
  await page.waitForTimeout(3000);
  const before = afterSteady.layer.frames;
  const after = (await perf())!.layer!;
  const framesSince = after.frames - before;
  await page.waitForTimeout(1000);
  const framesLater = (await perf())!.layer!.frames - after.frames;
  contextCheck = `${after.contextRestores} restore(s); drawing again: ${framesLater > 0 ? `yes (${framesLater} frames in the next second)` : "NO"} (${framesSince} frames across the loss)`;
}

console.log(`status line: ${status}`);
console.log(`map fills its area: ${mapBox && mainBox && mapBox.height >= mainBox.height - 1 ? "yes" : "NO"}`);
console.log(`frame interval: p50 ${q(deltas, 0.5).toFixed(1)} ms, p95 ${q(deltas, 0.95).toFixed(1)} ms, p99 ${q(deltas, 0.99).toFixed(1)} ms (${(deltas.length / 10).toFixed(0)} fps)`);
console.log(`long tasks (>50 ms): ${longTasksAtStart} during start-up, ${steady.length} in 10 s of steady state${steady.length ? ` (longest ${Math.max(...steady).toFixed(0)} ms)` : ""}`);
if (renderMs.length) console.log(`WebGL layer CPU per frame: p50 ${q(renderMs, 0.5).toFixed(2)} ms, p95 ${q(renderMs, 0.95).toFixed(2)} ms`);
console.log(`WebGL context lost and restored: ${contextCheck}`);
console.log(`console errors: ${errors.length ? errors.join(" | ") : "none"}`);

const fills = !!mapBox && !!mainBox && mapBox.height >= mainBox.height - 1;
const restored = contextCheck.startsWith("skipped") || contextCheck.includes("drawing again: yes");
const [smooth, smoothDetail] = timing(q(deltas, 0.99) < 34 && steady.length <= 2, `p99 ${q(deltas, 0.99).toFixed(1)} ms, ${steady.length} long task(s)`);
const failures = [
  ...(fills ? [] : ["the map doesn't fill its area"]),
  ...(restored ? [] : ["drawing didn't resume after a lost WebGL context"]),
  ...(errors.length ? ["console errors"] : []),
  ...(smooth ? [] : [`not smooth (${smoothDetail})`]),
];
console.log(failures.length ? `\nFAILED: ${failures.join("; ")}` : `\npassed (${smoothDetail})`);
if (failures.length) process.exitCode = 1;

if (!query) {
  // A close-up where the shapes are visible: Apapa, the port approach.
  await page.goto(`${base}?c=6.44800,3.36000,14.50&hud=1`);
  await page.getByText("Live").waitFor({ timeout: READY_MS });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "scripts/smoke-web-zoom.png" });
}
await browser.close();
