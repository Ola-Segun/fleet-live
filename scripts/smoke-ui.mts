/**
 * Drives the dispatcher tools in a real browser, as a person would: keyboard
 * search, selection, follow, filters, list navigation, map picking, a deep
 * link, and the phone layout. Then re-measures smoothness with the list open,
 * because the UI must not undo Layer 7.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm smoke:ui
 */
import { chromium, type Page } from "@playwright/test";

const base = "http://127.0.0.1:3100/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);
const errors: string[] = [];
const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ready(page: Page, url: string) {
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: 40_000 });
  await page.waitForSelector('[role="option"]', { timeout: 20_000 });
}

// ─── Desktop ────────────────────────────────────────────────────────────────
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await ready(page, base);

check("one search box and one list exist (no hidden duplicates)", (await page.locator("#fleet-search").count()) === 1 && (await page.locator('[role="listbox"]').count()) === 1);

await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus the page, not an input
await page.keyboard.press("/");
check('"/" focuses search', await page.evaluate("document.activeElement?.id === 'fleet-search'"));

// A moving truck, so the follow check below has a camera that should move. Which truck is first
// depends on the simulated time of day; a parked one made that check fail by chance.
const movingRow = page.locator('[role="option"]', { hasText: /\b[1-9]\d km\/h/ }).first();
const firstPlate = (await movingRow.locator(".font-mono").innerText()).trim();
const partial = firstPlate.slice(0, 6).toLowerCase().replace("-", ""); // e.g. "kja48", however it's typed
await page.keyboard.type(partial);
await sleep(700);
const matches = await page.locator('[role="option"]').count();
const shown = await page.locator('[role="option"] .font-mono').allInnerTexts();
check(`typing "${partial}" narrows the list to matching plates`, matches >= 1 && shown.every((p) => p.toLowerCase().replace("-", "").includes(partial)), `${matches} match(es)`);

await page.keyboard.press("Enter");
await page.getByRole("heading", { level: 2 }).waitFor({ timeout: 5000 });
const drawerPlate = (await page.getByRole("heading", { level: 2 }).innerText()).trim();
const selectedId = param(page, "v");
check("Enter selects the first match and opens its details", shown.includes(drawerPlate) && selectedId !== null, `${drawerPlate}, v=${selectedId}`);

// The detail panel must not cover the map's own controls.
const zoomIn = await page.getByRole("button", { name: "Zoom in" }).boundingBox();
const panelBox = await page.locator("section[aria-labelledby=drawer-title]").boundingBox();
const overlaps = !!zoomIn && !!panelBox && zoomIn.x < panelBox.x + panelBox.width && zoomIn.x + zoomIn.width > panelBox.x && zoomIn.y < panelBox.y + panelBox.height && zoomIn.y + zoomIn.height > panelBox.y;
check("the detail panel leaves the zoom controls uncovered", !overlaps);

// Follow: the camera tracks the truck, so the URL's camera changes on its own.
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("f");
await sleep(1500);
const followOn = (await page.getByRole("button", { name: /Following/ }).getAttribute("aria-pressed")) === "true";
const c1 = param(page, "c");
await sleep(4000);
const c2 = param(page, "c");
const followedStatus = (await page.locator("section[aria-labelledby=drawer-title] dd").first().innerText()).trim();
check("F turns on follow, and the camera moves with the truck", followOn && param(page, "f") === "1" && c1 !== c2, `${c1} → ${c2}, truck ${followedStatus}`);
await page.screenshot({ path: "scripts/smoke-ui-follow.png" });

// A drag by the person hands control back.
const map = page.locator(".maplibregl-canvas");
const box = (await map.boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
await page.mouse.up();
await sleep(500);
check("dragging the map stops following", (await page.getByRole("button", { name: /Follow on map/ }).getAttribute("aria-pressed")) === "false" && param(page, "f") === null);

// Click where the selected truck is drawn: picking finds a truck, and says how long it took.
await page.keyboard.press("f"); // re-centre on it
await sleep(1200);
await page.keyboard.press("f"); // and stop, so the camera holds still for the click
await sleep(150);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(300);
const pickMs = (await page.evaluate("window.__fleetPerf.lastPickMs")) as number;
check("clicking a truck on the map selects a truck", param(page, "v") !== null, `pick took ${pickMs.toFixed(1)} ms over ~5,000 trucks`);

// Closing the panel with its button returns focus to the list, not to the top of the page.
await page.getByRole("button", { name: "Close truck details" }).click();
await sleep(300);
check("closing the details panel puts keyboard focus back on the list", (await page.evaluate("document.activeElement?.getAttribute('role')")) === "listbox" && param(page, "v") === null);

await page.locator('[role="option"]').first().click();
await page.getByRole("heading", { level: 2 }).waitFor({ timeout: 5000 });
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Escape");
await sleep(300);
check("Escape clears the selection", param(page, "v") === null && (await page.getByRole("heading", { level: 2 }).count()) === 0);

// Single-key shortcuts can be turned off (WCAG 2.1.4), and the choice survives a reload.
await page.getByRole("button", { name: /Single-key shortcuts/ }).click();
await page.locator('[role="option"]').first().click();
await page.getByRole("heading", { level: 2 }).waitFor({ timeout: 5000 });
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("f");
await sleep(400);
const stillOff = param(page, "f") === null;
await page.reload();
await page.waitForSelector('[role="option"]', { timeout: 30_000 });
const persisted = (await page.getByRole("button", { name: /Single-key shortcuts/ }).innerText()).includes("off");
check("single-key shortcuts can be switched off, and stay off after a reload", stillOff && persisted);
await page.getByRole("button", { name: /Single-key shortcuts/ }).click(); // back on for the rest
await page.keyboard.press("Escape");

// Filters: turn Parked off.
await page.locator("#fleet-search").fill("");
await sleep(600);
// The visible "N of M trucks" line (the live region now speaks only when the person changes the search or filters).
const countText = () => page.getByText(/^[\d,]+ of [\d,]+ trucks$/).innerText();
const before = await countText();
await page.getByRole("button", { name: /^Parked/ }).click();
await sleep(800);
const after = await countText();
const labels = await page.locator('[role="option"]').allInnerTexts();
check("turning Parked off hides parked trucks from the list and the URL records it", param(page, "s") === "moving,stale" && !labels.some((t) => t.includes("Parked")) && before !== after, `${before} → ${after}`);
await page.getByRole("button", { name: /^Parked/ }).click();

// Keyboard through the list.
await page.locator('[role="listbox"]').focus();
for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
await sleep(1200); // two snapshot refreshes: the live sort reorders the list meanwhile
const activeId = await page.locator('[role="listbox"]').getAttribute("aria-activedescendant");
const activePlate = (await page.locator(`#${activeId} .font-mono`).innerText()).trim();
await page.keyboard.press("Enter");
await page.getByRole("heading", { level: 2 }).waitFor({ timeout: 5000 });
const opened = (await page.getByRole("heading", { level: 2 }).innerText()).trim();
check("arrow keys and Enter open the truck that was highlighted, even as the live sort reorders", opened === activePlate, `${activePlate} highlighted, ${opened} opened`);

// Smoothness with the list and a selection live.
const lt0 = ((await page.evaluate("window.__fleetPerf.longTasks.length")) as number) ?? 0;
const deltas = (await page.evaluate(`new Promise((resolve) => {
  const d = []; let prev = performance.now(); const end = prev + 10000;
  const tick = (t) => { d.push(t - prev); prev = t; if (t < end) requestAnimationFrame(tick); else resolve(d); };
  requestAnimationFrame(tick);
})`)) as number[];
const lt = ((await page.evaluate("window.__fleetPerf.longTasks")) as number[]).slice(lt0);
const sorted = [...deltas].sort((a, b) => a - b);
const p99 = sorted[Math.floor(0.99 * sorted.length)]!;
check("still smooth with the list and a selection live", lt.length <= 2 && p99 < 34, `${(deltas.length / 10).toFixed(0)} fps, p99 frame ${p99.toFixed(1)} ms, ${lt.length} long task(s) in 10 s${lt.length ? ` (longest ${Math.max(...lt).toFixed(0)} ms)` : ""}`);
await page.screenshot({ path: "scripts/smoke-ui-desktop.png" });

// The theme button: dark on a light system, the map along with it, kept across a reload with no flash.
const bg = () => page.evaluate("getComputedStyle(document.body).backgroundColor") as Promise<string>;
const themeButton = page.getByRole("button", { name: "Dark mode" });
const lightBg = await bg();
const layers0 = (await page.evaluate("window.__fleetPerf.layer.layersAdded")) as number;
await themeButton.click();
await sleep(3000);
const darkBg = await bg();
const layers1 = (await page.evaluate("window.__fleetPerf.layer.layersAdded")) as number;
const framesA = (await page.evaluate("window.__fleetPerf.layer.frames")) as number;
await sleep(1000);
const framesB = (await page.evaluate("window.__fleetPerf.layer.frames")) as number;
check(
  "the Dark mode button darkens the page and the map, and the trucks keep drawing",
  lightBg !== darkBg && darkBg === "rgb(9, 9, 11)" && (await themeButton.getAttribute("aria-pressed")) === "true" && layers1 > layers0 && framesB - framesA > 30,
  `${lightBg} → ${darkBg}, truck layer re-added ${layers1 - layers0}×, ${framesB - framesA} frames/s after`,
);
await page.reload();
const firstPaintTheme = await page.evaluate("document.documentElement.getAttribute('data-theme')");
check("the choice survives a reload, applied before the first paint", firstPaintTheme === "dark" && (await bg()) === "rgb(9, 9, 11)", `data-theme=${firstPaintTheme}`);
await page.waitForFunction("window.__fleetPerf?.layer?.frames > 30", undefined, { timeout: 40_000 });
await page.getByRole("button", { name: "Dark mode" }).click();
await sleep(500);
check("pressing it again returns to light", (await bg()) === lightBg);

// A deep link reopens a truck, following.
const id = param(page, "v");
const deep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await ready(deep, `${base}?v=${id}&f=1`);
await deep.getByRole("heading", { level: 2 }).waitFor({ timeout: 10_000 });
check("a deep link reopens the truck and follows it", (await deep.getByRole("button", { name: /Following/ }).count()) === 1, `?v=${id}&f=1`);
await deep.close();

// ─── Phone ──────────────────────────────────────────────────────────────────
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => errors.push(String(e)));
await phone.goto(base);
await phone.waitForFunction("window.__fleetPerf?.layer?.frames > 30", undefined, { timeout: 40_000 });
const mapBox = await phone.locator(".maplibregl-map").boundingBox();
check("phone: the map fills the width", mapBox !== null && mapBox.width >= 389);
await phone.getByRole("button", { name: /^Show trucks/ }).tap();
await phone.waitForSelector('[role="option"]', { timeout: 10_000 });
check("phone: the sheet opens with search and the list, and only one of each exists", (await phone.locator("#fleet-search").count()) === 1 && (await phone.locator('[role="listbox"]').count()) === 1);
const target = await phone.getByRole("button", { name: "Hide panel" }).boundingBox();
check("phone: the sheet toggle is a comfortable tap target", target !== null && target.height >= 44, `${target?.height} px tall`);
await phone.screenshot({ path: "scripts/smoke-ui-phone.png" });

await browser.close();

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
console.log(`console errors: ${errors.length ? errors.join(" | ") : "none"}`);
process.exit(results.every(([, ok]) => ok) && errors.length === 0 ? 0 : 1);
