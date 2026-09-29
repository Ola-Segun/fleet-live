/**
 * Loads the running app in a real browser (your installed Chrome) and reports what a person would see,
 * plus the baseline truck layer's main-thread cost.
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm smoke:web [url]    (add ?trucks=off to measure the map without the truck layer)
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://127.0.0.1:3100/";
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url);
await page.getByText("Live").waitFor({ timeout: 30_000 });
await page.waitForTimeout(5_000); // start-up: style, fonts, first tiles
const longTasksAtStart = ((await page.evaluate("window.__fleetPerf?.longTasks.length")) as number) ?? 0;
await page.waitForTimeout(10_000); // steady state: ~20 refreshes of the baseline layer

const status = await page.locator("header p").innerText();
// Not just "a canvas exists": a map collapsed to 0 px tall still has one. Check it fills the space.
const mapBox = await page.locator(".maplibregl-map").boundingBox();
const mainBox = await page.locator("main").boundingBox();
const canvas = mapBox && mainBox && mapBox.height >= mainBox.height - 1 ? 1 : 0;
// A string, not a function: tsx wraps named functions in a `__name` helper that doesn't exist in the page.
const fps = (await page.evaluate(`new Promise((resolve) => {
  let frames = 0; const start = performance.now();
  const tick = () => { frames++; if (performance.now() - start < 3000) requestAnimationFrame(tick); else resolve(frames / 3); };
  requestAnimationFrame(tick);
})`)) as number;
const perf = (await page.evaluate("window.__fleetPerf")) as { refreshes: { build: number; hand: number; count: number }[]; longTasks: number[] } | undefined;
await page.screenshot({ path: "scripts/smoke-web.png" });
// Zoom in with the wheel; the camera should land in the URL once the move ends.
await page.mouse.move(720, 480);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(1500);
const cameraInUrl = new URL(page.url()).searchParams.get("c");
await browser.close();

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN; };
const r = perf?.refreshes.slice(4) ?? []; // skip the first few while the map warms up
console.log(`status line: ${status.replace(/\s+/g, " ")}`);
console.log(`map fills its area: ${canvas === 1 ? "yes" : `NO (${mapBox?.height} of ${mainBox?.height} px)`} · camera in URL after a wheel zoom: ${cameraInUrl ?? "NOT WRITTEN"}`);
console.log(`refreshes measured: ${r.length} · trucks per refresh: ${r.at(-1)?.count}`);
console.log(`build GeoJSON: p50 ${q(r.map((x) => x.build), 0.5).toFixed(1)} ms, p95 ${q(r.map((x) => x.build), 0.95).toFixed(1)} ms`);
console.log(`setData:       p50 ${q(r.map((x) => x.hand), 0.5).toFixed(1)} ms, p95 ${q(r.map((x) => x.hand), 0.95).toFixed(1)} ms`);
const steady = (perf?.longTasks ?? []).slice(longTasksAtStart);
console.log(`long tasks (>50 ms): ${longTasksAtStart} during start-up, ${steady.length} in 10 s of steady state${steady.length ? ` (longest ${Math.max(...steady).toFixed(0)} ms)` : ""}`);
console.log(`frames per second (headless, software WebGL): ${fps.toFixed(0)}`);
console.log(`console errors: ${errors.length ? errors.join(" | ") : "none"}`);
