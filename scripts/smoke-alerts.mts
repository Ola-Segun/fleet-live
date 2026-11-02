/**
 * Drives Layer 8b in a real browser: alerts arrive, can be acknowledged,
 * resolved and followed to the truck; alerting trucks are drawn as diamonds;
 * new alerts are announced; zones can be drawn, imported, named and deleted,
 * and count the trucks inside.
 *
 * Runs the demo from 22:30 Lagos time (?at=2230), when roads are light enough
 * for the simulator's speeders to break the limit, so alerts come quickly.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm smoke:alerts
 */
import type { Page } from "@playwright/test";
import { DEMO_URL, EVENT_MS, READY_MS, launchBrowser } from "./browser.mts";

const base = `${DEMO_URL}?at=2230`;
const browser = await launchBrowser();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);
const errors: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const page: Page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
// Start from the demo zones, whatever an earlier run stored.
await page.addInitScript(() => {
  if (!sessionStorage.getItem("smoke-started")) {
    localStorage.removeItem("fleet-live:zones");
    sessionStorage.setItem("smoke-started", "1");
  }
});
await page.goto(base);
await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: READY_MS });

// Every announcement made, in order, with its time. A region counts only when *its own* text changes:
// the first recorder re-read every live region on any change, so two regions alternating re-recorded
// the same alert sentence moments later, which looked like announcements 0.1 s apart.
await page.evaluate(`(() => {
  window.__spoken = [];
  const last = new WeakMap();
  const observer = new MutationObserver(() => {
    for (const el of document.querySelectorAll("[aria-live]")) {
      const text = el.textContent?.trim();
      if (text && last.get(el) !== text) window.__spoken.push({ text, at: performance.now() });
      last.set(el, text);
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
})()`);

// ─── Zones ──────────────────────────────────────────────────────────────────
await page.getByRole("tab", { name: /Zones/ }).click();
const zoneNames = await page.getByRole("list", { name: "Zones" }).locator("h3").allInnerTexts();
check("the demo zones are listed", zoneNames.includes("Third Mainland Bridge") && zoneNames.includes("Apapa Port"), zoneNames.join(", "));
await sleep(3000);
const apapa = page.getByRole("list", { name: "Zones" }).locator("li", { hasText: "Apapa Port" });
const inside = Number((await apapa.getByText(/inside/).innerText()).replace(/[^\d]/g, ""));
check("a zone counts the trucks inside it", inside > 0, `${inside} at Apapa Port`);

// Draw a square around the map centre by clicking, name it, save it.
await page.getByRole("button", { name: "Draw a zone" }).click();
const canvas = await page.locator(".maplibregl-canvas").boundingBox();
const cx = canvas!.x + canvas!.width / 2;
const cy = canvas!.y + canvas!.height / 2;
for (const [dx, dy] of [[-120, -90], [120, -90], [120, 90], [-120, 90]] as const) {
  await page.mouse.click(cx + dx, cy + dy);
  await sleep(150);
}
const help = await page.locator("#draw-help").innerText();
check("clicking the map adds corners while drawing", /4 corners/.test(help), help);
// Keyboard route: add one at the centre, then undo it with Backspace.
await page.getByRole("button", { name: "Add corner at map centre" }).click();
await page.locator("body").press("Backspace");
check("a corner can be added at the centre and removed with Backspace", /4 corners/.test(await page.locator("#draw-help").innerText()));
await page.getByRole("button", { name: "Finish shape" }).click();
await page.getByLabel("Zone name").fill("Smoke yard");
await page.getByLabel("Kind").selectOption("depot");
await page.getByRole("button", { name: "Save zone" }).click();
await sleep(1500);
const smoke = page.getByRole("list", { name: "Zones" }).locator("li", { hasText: "Smoke yard" });
check("a drawn zone is saved, as a depot watched for exits", (await smoke.count()) === 1 && (await smoke.getByLabel("Alert on exit").isChecked()) && !(await smoke.getByLabel("Alert on entry").isChecked()));
check("the drawn zone survives a reload's storage", (await page.evaluate(`localStorage.getItem("fleet-live:zones") ?? ""`) as string).includes("Smoke yard"));
await page.getByRole("button", { name: "Delete Smoke yard" }).click();
check("a zone can be deleted", (await smoke.count()) === 0);

// Import: bad input is explained; good input is added.
await page.getByLabel("Import GeoJSON").fill("{nope");
await page.getByRole("button", { name: "Import pasted" }).click();
check("invalid JSON is rejected with a message", (await page.getByRole("status").innerText()).includes("isn't valid JSON"));
await page.getByLabel("Import GeoJSON").fill(JSON.stringify({ type: "Feature", properties: { name: "Imported yard", kind: "depot" }, geometry: { type: "Polygon", coordinates: [[[3.39, 6.6], [3.4, 6.6], [3.4, 6.61], [3.39, 6.6]]] } }));
await page.getByRole("button", { name: "Import pasted" }).click();
check("a GeoJSON polygon is imported", (await page.getByRole("status").innerText()).includes("Imported 1 zone") && (await page.getByRole("list", { name: "Zones" }).locator("h3", { hasText: "Imported yard" }).count()) === 1);
await page.getByRole("button", { name: "Delete Imported yard" }).click();

// ─── Alerts ─────────────────────────────────────────────────────────────────
const alertsTab = page.getByRole("tab", { name: /Alerts/ });
await page.waitForFunction(`[...document.querySelectorAll('[role="tab"]')].some((t) => /Alerts\\s*\\d+/.test(t.textContent))`, undefined, { timeout: EVENT_MS }).catch(() => {});
const badge = (await alertsTab.innerText()).replace(/\s+/g, " ");
check("new alerts show as a count on the Alerts tab", /Alerts \d+/.test(badge), badge);
await alertsTab.click();
const items = page.getByRole("list", { name: "Open alerts" }).locator("li");
const count = await items.count();
const firstText = count ? await items.first().locator("p").first().innerText() : "";
// One alert, pinned by its id: "the first row" is re-found on every action, and new alerts can arrive in between.
const firstId = count ? await items.first().locator("p").first().getAttribute("id") : null;
const target = page.locator("li", { has: page.locator(`[id="${firstId}"]`) });
check("alerts are listed with what happened", count > 0 && /speeding|entered|left|not reporting/.test(firstText), `${count}: "${firstText}"`);

const drawn = (await page.evaluate("window.__fleetPerf.layer.alerting")) as number;
check("alerting trucks are drawn as diamonds on the map", drawn > 0, `${drawn} drawn`);

// Acknowledge: the button goes, the status says so.
await target.getByRole("button", { name: "Acknowledge" }).click();
await sleep(500);
const status = await target.locator("p").nth(1).innerText();
check("acknowledging marks it acknowledged", /acknowledged/.test(status) && (await target.getByRole("button", { name: "Acknowledge" }).count()) === 0, status);

// Show truck: the detail panel opens on the alert's truck, with the alert in it.
const plate = firstText.split(" ")[0]!;
await target.getByRole("button", { name: "Show truck" }).click();
await page.getByRole("heading", { level: 2 }).waitFor({ timeout: 5000 });
// Compare what happened, not the whole sentence: a speeding alert's peak can rise between the two reads.
const drawer = await page.locator("section[aria-labelledby=drawer-title]").innerText();
const what = firstText.replace(/\d+ km\/h|\d\d:\d\d:\d\d/g, "").trim();
check("Show truck opens that truck, with its alert", (await page.getByRole("heading", { level: 2 }).innerText()).trim() === plate && drawer.replace(/\d+ km\/h|\d\d:\d\d:\d\d/g, "").includes(what), `${plate}; panel: "${drawer.replace(/\s+/g, " ").slice(0, 160)}"`);

// Resolve from the list: the row goes and focus moves on, not to the top of the page.
const before = await items.count();
const resolvedText = await items.first().locator("p").first().innerText();
await items.first().getByRole("button", { name: "Resolve" }).focus();
await page.keyboard.press("Enter");
await sleep(700);
const texts = await items.locator("p:first-of-type").allInnerTexts();
const focus = (await page.evaluate("document.activeElement?.textContent?.trim() ?? ''")) as string;
check("resolving removes the alert", !texts.includes(resolvedText) || (await items.count()) < before, `${before} → ${await items.count()}`);
check("after resolving, focus moves to the next alert (or the summary)", /Show truck|open|No open alerts/.test(focus), `focus on "${focus.slice(0, 40)}"`);

// Listen for 25 s: alerts keep arriving, so announcements must keep coming, gathered, never closer than 5 s.
// (The first version of the announcer went silent after its first sentence; a short run can't tell.)
const listenFrom = (await page.evaluate("performance.now()")) as number;
await sleep(25_000);
const spoken = (await page.evaluate("window.__spoken")) as { text: string; at: number }[];
const alertsSpoken = spoken.filter((s) => /^Alert:|new alerts\./.test(s.text));
// The rule: at most one alert announcement every 5 s, however many alerts land. Checked as the gaps
// between them, so it holds however long the run takes (a fixed maximum count failed under software WebGL).
const gaps = alertsSpoken.slice(1).map((s, i) => s.at - alertsSpoken[i]!.at);
const shortest = gaps.length ? Math.min(...gaps) : Infinity;
check(
  "new alerts keep being announced, gathered, at most once every 5 s",
  alertsSpoken.filter((s) => s.at >= listenFrom).length >= 2 && shortest >= 4900,
  `${alertsSpoken.filter((s) => s.at >= listenFrom).length} in the last 25 s, ${alertsSpoken.length} in all, shortest gap ${Number.isFinite(shortest) ? (shortest / 1000).toFixed(1) + " s" : "n/a"}: "${alertsSpoken[0]?.text ?? ""}"`,
);

await page.screenshot({ path: "scripts/smoke-alerts.png" });
await browser.close();

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
console.log(`\nconsole errors: ${errors.length ? errors.join("\n  ") : "none"}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
