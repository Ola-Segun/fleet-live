/**
 * The README's screenshots, taken from the running app so they can be
 * regenerated whenever the UI changes.
 *
 *   pnpm --filter @fleet/web build && pnpm --filter @fleet/web start -p 3100
 *   pnpm screenshots
 *
 * Written to docs/images/. Run on a real GPU: software WebGL draws the map, but
 * slowly enough that tiles may still be loading when the picture is taken.
 */
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { BASE_URL, EVENT_MS, READY_MS, launchBrowser } from "./browser.mts";

const OUT = "docs/images";
mkdirSync(OUT, { recursive: true });
const browser = await launchBrowser();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(query: string, options: { dark?: boolean; phone?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: options.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: options.phone ? 2 : 1,
    isMobile: options.phone,
    hasTouch: options.phone,
    colorScheme: options.dark ? "dark" : "light",
  });
  const page = await context.newPage();
  await page.goto(BASE_URL + query);
  await page.waitForFunction("window.__fleetPerf?.layer?.frames > 60", undefined, { timeout: READY_MS });
  await page.waitForSelector('[role="option"], [aria-controls="fleet-sheet"]');
  return page;
}

/** Time for the base map's tiles and labels to load before the picture. */
const settle = (page: Page) => page.waitForTimeout(4000);

// Overview, light: central Lagos, a moving truck selected.
{
  const page = await open("?c=6.49800,3.37500,12.60");
  await page.getByRole("combobox", { name: /^Sort/ }).selectOption("speed");
  await sleep(800);
  await page.locator('[role="option"]').nth(4).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/overview-light.png` });
  await page.context().close();
}

// Alerts, dark: from 22:30, when speeders speed, with the alert list open.
{
  const page = await open("?at=2230&c=6.52000,3.39000,12.20", { dark: true });
  await page.waitForFunction(`[...document.querySelectorAll('[role="tab"]')].some((t) => /Alerts\\s*\\d+/.test(t.textContent))`, undefined, { timeout: EVENT_MS });
  await sleep(20_000); // a few more alerts
  await page.getByRole("tab", { name: /^Alerts/ }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/alerts-dark.png` });
  await page.context().close();
}

// Replay: two minutes back, paused.
{
  const page = await open("?c=6.46500,3.36000,13.40");
  await page.waitForFunction(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Replay" && !b.disabled)`, undefined, { timeout: EVENT_MS });
  await sleep(90_000); // more history to scrub through
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/replay.png` });
  await page.context().close();
}

// Phone: the sheet open over the map.
{
  const page = await open("?c=6.50000,3.37000,12.00", { phone: true });
  await page.getByRole("button", { name: /^Show trucks/ }).tap();
  await page.waitForSelector('[role="option"]');
  await settle(page);
  await page.screenshot({ path: `${OUT}/phone.png` });
  await page.context().close();
}

await browser.close();
console.log(`screenshots written to ${OUT}/`);
