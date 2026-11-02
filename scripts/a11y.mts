/**
 * Automated accessibility checks in a real browser: axe-core against WCAG 2.2
 * AA in the states a person actually uses, plus the accessibility tree a
 * screen reader is given, written to docs/a11y/ for review.
 *
 * Automated tools find only part of what's wrong. docs/a11y/NVDA-CHECKLIST.md
 * is the manual pass that has to be done by a person with a screen reader.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm a11y
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO_URL, EVENT_MS, READY_MS, launchBrowser } from "./browser.mts";
import { mkdirSync, writeFileSync } from "node:fs";

const base = DEMO_URL;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const browser = await launchBrowser();
mkdirSync("docs/a11y", { recursive: true });

let failed = false;
async function scan(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`\n${state}: ${result.violations.length} violation type(s), ${result.passes.length} rules passed, ${result.incomplete.length} need review`);
  for (const v of result.violations) {
    failed = true;
    console.log(`  ✗ [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
  for (const v of result.incomplete) console.log(`  ? ${v.id}: ${v.help} (${v.nodes.length}), axe couldn't decide, so check by hand`);
}

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction("window.__fleetPerf?.layer?.frames > 30", undefined, { timeout: READY_MS });
  await page.waitForSelector('[role="option"]', { timeout: READY_MS }).catch(() => {});
}

// axe needs pages from an explicit context, not browser.newPage().
const desktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await ready(desktop, base);
await scan(desktop, "desktop, default view");
writeFileSync("docs/a11y/aria-tree-desktop.txt", await desktop.locator("body").ariaSnapshot());

await desktop.locator('[role="option"]').nth(2).click();
await desktop.getByRole("heading", { level: 2 }).waitFor();
await scan(desktop, "desktop, a truck selected (detail panel open)");
writeFileSync("docs/a11y/aria-tree-selected.txt", await desktop.locator("body").ariaSnapshot());

// A live region that keeps changing makes a screen reader talk over the person. With a filter on
// (the case that used to chatter twice a second), count changes to any live region over 10 s.
await desktop.getByRole("button", { name: /^Parked/ }).click(); // show only moving and stale
await desktop.waitForTimeout(2000); // let the one intended announcement ("N trucks shown") settle
const liveChanges = (await desktop.evaluate(`new Promise((resolve) => {
  const changes = [];
  const observer = new MutationObserver((list) => { for (const m of list) { const r = m.target.nodeType === 3 ? m.target.parentElement : m.target; const live = r.closest("[aria-live]"); if (live) changes.push(live.textContent); } });
  for (const el of document.querySelectorAll("[aria-live]")) observer.observe(el, { childList: true, characterData: true, subtree: true });
  setTimeout(() => { observer.disconnect(); resolve(changes); }, 10000);
})`)) as string[];
console.log(`
live regions with a filter on: ${liveChanges.length} change(s) in 10 s${liveChanges.length ? ` (${[...new Set(liveChanges)].slice(0, 3).join(" | ")})` : ""}`);
if (liveChanges.length > 0) failed = true;

// A moving truck's status is shown by an icon (decorative) and its speed; a screen reader needs the words.
const names = await desktop.getByRole("option").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
const moving = names.filter((n) => /km\/h/.test(n));
const withStatus = moving.filter((n) => /Moving|No recent report/.test(n));
console.log(`moving trucks' list options that say their status in words: ${withStatus.length} of ${moving.length}`);
if (withStatus.length !== moving.length || moving.length === 0) failed = true;
await desktop.getByRole("button", { name: /^Parked/ }).click();
// Each page runs its own 5,000-truck simulation: close pages when done, or later ones starve.
await desktop.context().close();

const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await ready(phone, base);
await phone.getByRole("button", { name: /^Show trucks/ }).tap();
await phone.waitForSelector('[role="option"]');
await scan(phone, "phone, sheet open");
await phone.context().close();

// The same states in dark mode. Checks that only ran in light mode missed near-white text on white panels.
const darkDesktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })).newPage();
await ready(darkDesktop, base);
await darkDesktop.locator('[role="option"]').nth(2).click();
await darkDesktop.getByRole("heading", { level: 2 }).waitFor();
await scan(darkDesktop, "desktop, dark mode, a truck selected");
const darkPhone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" })).newPage();
await ready(darkPhone, base);
await darkPhone.getByRole("button", { name: /^Show trucks/ }).tap();
await darkPhone.waitForSelector('[role="option"]');
await scan(darkPhone, "phone, dark mode, sheet open");
await darkDesktop.screenshot({ path: "scripts/a11y-dark-desktop.png" });
await darkDesktop.context().close();
await darkPhone.context().close();

// Layer 8b: the Alerts and Zones tabs, with real alerts in them (the demo from 22:30, when speeders speed).
for (const scheme of ["light", "dark"] as const) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
  await ready(p, `${base}?at=2230`);
  await p.waitForFunction(`[...document.querySelectorAll('[role="tab"]')].some((t) => /Alerts\\s*\\d+/.test(t.textContent))`, undefined, { timeout: EVENT_MS });
  await p.getByRole("tab", { name: /^Alerts/ }).click();
  await p.getByRole("list", { name: "Open alerts" }).waitFor();
  await scan(p, `desktop, ${scheme}, Alerts tab with alerts`);
  if (scheme === "light") writeFileSync("docs/a11y/aria-tree-alerts.txt", await p.locator("[role=tabpanel]").ariaSnapshot());
  await p.getByRole("tab", { name: /^Zones/ }).click();
  await p.getByRole("button", { name: "Draw a zone" }).click();
  await scan(p, `desktop, ${scheme}, Zones tab while drawing`);
  // Layer 9: replaying, with the replay bar's controls.
  await p.getByRole("button", { name: "Cancel" }).click();
  await p.waitForFunction(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Replay" && !b.disabled)`, undefined, { timeout: EVENT_MS });
  await p.getByRole("button", { name: "Replay", exact: true }).click();
  await p.getByRole("slider", { name: "Replay time" }).waitFor();
  await scan(p, `desktop, ${scheme}, replaying`);
  if (scheme === "light") writeFileSync("docs/a11y/aria-tree-replay.txt", await p.getByRole("group", { name: "Replay" }).ariaSnapshot());
  if (scheme === "light") await p.screenshot({ path: "scripts/a11y-zones.png" });
  await p.context().close();
}

await browser.close();
console.log(failed ? "\nviolations found" : "\nno violations");
process.exit(failed ? 1 : 0);
