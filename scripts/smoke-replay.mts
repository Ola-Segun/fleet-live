/**
 * Drives Layer 9 in a real browser, and checks replay against what the live
 * map actually drew.
 *
 * It records where 20 moving trucks are drawn live for 25 s (every animation
 * frame, through the read-only `__fleetPerf.probe`), then replays those same
 * moments and measures how far each replayed truck is from where it was drawn
 * live. Then it pauses, scrubs by keyboard, plays at 60× (checking the speed
 * and the frame rate), catches up with live, and goes back to live.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm smoke:replay
 */
import { chromium, type Page } from "@playwright/test";

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);
const errors: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const page: Page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:3100/");
await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: 40_000 });
await page.waitForSelector('[role="option"]');

const replayButton = page.getByRole("button", { name: "Replay", exact: true });
check("replay waits until there is something to replay", await replayButton.isDisabled());

// 20 moving trucks, by id, from the list sorted by speed (under "Needs attention" the rows on screen
// can all be stale or alerting, and the list only renders what's on screen).
await page.getByRole("combobox", { name: /^Sort/ }).selectOption("speed");
await sleep(1200);
const ids = (await page.locator('[role="option"]', { hasText: /\b[1-9]\d km\/h/ }).evaluateAll((els) => els.slice(0, 20).map((e) => Number(e.id.replace("truck-", ""))))) as number[];

// Their live positions, every frame, for 25 s.
type Probe = { at: number; lat: number; lon: number };
const live = (await page.evaluate(`new Promise((resolve) => {
  const ids = ${JSON.stringify(ids)}; const out = {}; for (const id of ids) out[id] = [];
  const end = performance.now() + 25000;
  const tick = () => {
    for (const id of ids) { const p = window.__fleetPerf.probe(id); if (p && p.mode === 1) out[id].push(p); }
    if (performance.now() < end) requestAnimationFrame(tick); else resolve(out);
  };
  requestAnimationFrame(tick);
})`)) as Record<number, Probe[]>;

await page.waitForFunction(`!document.querySelector('button:disabled')?.textContent?.includes("Replay") && [...document.querySelectorAll("button")].some((b) => b.textContent === "Replay" && !b.disabled)`, undefined, { timeout: 120_000 });
await replayButton.click();
await sleep(1500);
const statusText = async () => (await page.locator("header").innerText()).replace(/\s+/g, " ");
const replayClock = async () => /Replay (\d\d:\d\d:\d\d)/.exec(await statusText())?.[1];
const t1 = await replayClock();
check("Replay enters replay, paused, and the status line says so", t1 !== undefined, (await statusText()).slice(-60));
const replayTrucks = Number(/([\d,]+) trucks/.exec(await statusText())?.[1]?.replace(/,/g, "") ?? 0);
check("the list shows the trucks drawn at the replay time, not an empty fleet", replayTrucks > 1000, `${replayTrucks} trucks`);
await sleep(1500);
check("paused replay stays put", (await replayClock()) === t1, `${t1} → ${await replayClock()}`);

// Replay the recorded moments: the slider steps 5 s from the oldest frame, so land on grid times inside the live recording.
const slider = page.getByRole("slider", { name: "Replay time" });
const distances: number[] = [];
const haversine = (a: Probe, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
};
const liveAt = (probes: Probe[], t: number) => {
  for (let i = 1; i < probes.length; i++) {
    const a = probes[i - 1]!, b = probes[i]!;
    if (a.at <= t && t <= b.at && b.at - a.at < 100) {
      const u = (t - a.at) / (b.at - a.at || 1);
      return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u };
    }
  }
  return undefined;
};
await slider.focus();
await page.keyboard.press("End");
let compared = 0;
for (let step = 0; step < 40 && compared < 4; step++) {
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  const probes = (await page.evaluate(`${JSON.stringify(ids)}.map((id) => window.__fleetPerf.probe(id))`)) as (Probe | undefined)[];
  const at = probes.find(Boolean)?.at;
  if (at === undefined) continue;
  let any = false;
  probes.forEach((p, i) => {
    const l = p && liveAt(live[ids[i]!] ?? [], p.at);
    if (p && l) {
      distances.push(haversine(p, l));
      any = true;
    }
  });
  if (any) compared++;
}
distances.sort((a, b) => a - b);
const p = (q: number) => distances[Math.min(distances.length - 1, Math.floor(q * distances.length))] ?? NaN;
check(
  "replayed trucks are where the live map drew them at that moment",
  distances.length >= 20 && p(0.95) < 10,
  `${distances.length} comparisons at ${compared} moments: p50 ${p(0.5).toFixed(1)} m, p95 ${p(0.95).toFixed(1)} m, max ${distances.at(-1)?.toFixed(1)} m`,
);

// Scrub by keyboard: Home is the oldest frame; the value is announced as a time.
await page.keyboard.press("Home");
await sleep(300);
const valueText = await slider.getAttribute("aria-valuetext");
check("the slider is keyboard-operable and announces a time", /^\d\d:\d\d:\d\d, \d+ (s|min) ago$/.test(valueText ?? ""), valueText ?? "");

// Playback speed, at 10× so it fits in the recording the check has made (under a minute): 2 s should cover 20 s.
// The replay clock is read from whichever tracked truck is drawn (the first might not exist at this time).
const clockNow = async () => (await page.evaluate(`${JSON.stringify(ids)}.map((id) => window.__fleetPerf.probe(id)).find(Boolean)?.at ?? NaN`)) as number;
await page.getByLabel("Playback speed").selectOption("10");
await page.getByRole("button", { name: "Play" }).click();
const w0 = Date.now();
const a0 = await clockNow();
await sleep(2000);
const a1 = await clockNow();
const rate = (a1 - a0) / (Date.now() - w0);
check("10× plays about 10 s of replay per second", rate > 8 && rate < 12, `${rate.toFixed(1)}× measured`);

// The worst case for the Worker and the GPU upload: 60× while jumping back to the oldest frame every
// 400 ms, so every truck is repacked on each jump, for 3 s. The map must stay smooth throughout.
await page.getByLabel("Playback speed").selectOption("60");
const lt0 = (await page.evaluate("window.__fleetPerf.longTasks.length")) as number;
const recording = page.evaluate(`new Promise((resolve) => {
  const d = []; let prev = performance.now(); const end = prev + 3000;
  const tick = (t) => { d.push(t - prev); prev = t; if (t < end) requestAnimationFrame(tick); else resolve(d); };
  requestAnimationFrame(tick);
})`) as Promise<number[]>;
for (let k = 0; k < 7; k++) {
  await slider.focus();
  await page.keyboard.press("Home");
  await sleep(400);
}
const deltas = await recording;
const lt = ((await page.evaluate("window.__fleetPerf.longTasks")) as number[]).slice(lt0);
const sorted = [...deltas].sort((x, y) => x - y);
const p99 = sorted[Math.floor(0.99 * sorted.length)]!;
check(
  "still smooth at 60× while jumping (every truck repacked each jump)",
  deltas.length / 3 > 50 && p99 < 34 && lt.length <= 1,
  `${(deltas.length / 3).toFixed(0)} fps, p99 frame ${p99.toFixed(1)} ms, ${lt.length} long task(s) in 3 s${lt.length ? ` (longest ${Math.max(...lt).toFixed(0)} ms)` : ""}`,
);
await page.screenshot({ path: "scripts/smoke-replay.png" });

// Playing on reaches the newest recorded moment and goes live by itself.
await page.waitForFunction(`/as of/.test(document.querySelector("header").innerText)`, undefined, { timeout: 60_000 }).catch(() => {});
const spoken = (await page.locator("[aria-live]").allInnerTexts()).join(" | ");
check("catching up with live returns to live, and says so", /as of/.test(await statusText()) && /Caught up with live/.test(spoken), (await statusText()).slice(-40));

// Back to live, by the button.
await replayButton.click();
await page.getByRole("button", { name: "Back to live" }).click();
await sleep(1000);
check("Back to live returns to live", /as of/.test(await statusText()) && (await page.getByRole("button", { name: "Back to live" }).count()) === 0);
const frames0 = (await page.evaluate("window.__fleetPerf.layer.frames")) as number;
await sleep(1000);
const modes = (await page.evaluate(`${JSON.stringify(ids)}.map((id) => window.__fleetPerf.probe(id)?.mode ?? -1)`)) as number[];
const drawnLive = modes.filter((m) => m >= 0 && m !== 5).length; // 5 = stale
check("live trucks are drawn again after replay", ((await page.evaluate("window.__fleetPerf.layer.frames")) as number) - frames0 > 50 && drawnLive >= 15, `${drawnLive} of ${ids.length} tracked trucks drawn live and not stale`);

await browser.close();
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
console.log(`\nconsole errors: ${errors.length ? errors.join("\n  ") : "none"}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
