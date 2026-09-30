/**
 * Contrast of every visible text element in the header, each tab of the side
 * panel (trucks, alerts, zones) and the detail panel, measured against the real background the browser paints, on desktop
 * and phone. It also checks the borders that show where controls are, against
 * WCAG 1.4.11's 3:1 for non-text contrast, which axe doesn't test.
 *
 * axe leaves most of these as "needs review" because they sit partly over the
 * map canvas, where it can't determine the background. This decides them.
 *
 *   pnpm a11y:contrast   (with the built app on port 3100)
 */
import { chromium } from "@playwright/test";

const MEASURE = `(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] >= 0.99) return c; } return [255, 255, 255, 1]; };
    const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const ratio = (fg, bg) => { const [a, b] = [lum(over(fg, bg)), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
    const out = [];
    const roots = [...document.querySelectorAll("header, aside, section, [role=tabpanel], [aria-controls=fleet-sheet], #fleet-sheet, [data-replay-bar]")];
    const seen = new Set();
    for (const root of roots) for (const el of [root, ...root.querySelectorAll("*")]) {
      if (seen.has(el)) continue; seen.add(el);
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el); const size = parseFloat(cs.fontSize); const large = size >= 24 || (+cs.fontWeight >= 700 && size >= 18.66);
      out.push({ text: el.textContent.trim().slice(0, 30), color: cs.color, ratio: ratio(rgba(cs.color), bgOf(el)), need: large ? 3 : 4.5 });
    }
    // Non-text contrast (WCAG 1.4.11): a control identified by its border needs 3:1 against its surroundings.
    for (const el of document.querySelectorAll("input, select, button[aria-pressed]")) {
      const cs = getComputedStyle(el);
      if (!el.getClientRects().length || parseFloat(cs.borderTopWidth) === 0) continue;
      const border = rgba(cs.borderTopColor);
      if (border[3] === 0) continue;
      const pressedFill = rgba(cs.backgroundColor);
      if (pressedFill[3] >= 0.99 && ratio(pressedFill, bgOf(el.parentElement)) >= 3) continue; // a filled control is identified by its fill
      out.push({ text: "(border of " + (el.getAttribute("aria-label") || el.id || el.textContent.trim().slice(0, 16) || el.tagName) + ")", color: cs.borderTopColor, ratio: ratio(border, bgOf(el.parentElement)), need: 3 });
    }
    for (const input of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
      if (!input.getClientRects().length) continue;
      const colour = getComputedStyle(input, "::placeholder").color;
      out.push({ text: "(placeholder of " + (input.id || input.tagName) + ")", color: colour, ratio: ratio(rgba(colour), bgOf(input)), need: 4.5 });
    }
    return out;
  })()`;

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
// Both colour schemes: the dark-mode bug (near-white text on white panels) got past light-only checks.
const combos = (["light", "dark"] as const).flatMap((scheme) =>
  ([["desktop", { width: 1440, height: 900 }, false], ["phone", { width: 390, height: 844 }, true]] as const).map(([name, viewport, mobile]) => [`${name}, ${scheme}`, viewport, mobile, scheme] as const),
);
for (const [label, viewport, mobile, colorScheme] of combos) {
  const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme })).newPage();
  await page.goto("http://127.0.0.1:3100/?at=2230");
  await page.waitForFunction("window.__fleetPerf?.layer?.frames > 30", undefined, { timeout: 40_000 });
  if (mobile) await page.getByRole("button", { name: /^Show trucks/ }).tap();
  await page.waitForSelector('[role="option"]');
  await page.locator('[role="option"]').nth(2).click();
  await page.waitForTimeout(800);
  const rows: { text: string; color: string; ratio: number; need: number }[] = [];
  // Each tab of the panel in turn. The demo runs from 22:30 (?at=2230) so the Alerts tab has alerts to measure.
  for (const tab of ["Trucks", "Alerts", "Zones"]) {
    if (tab !== "Trucks") {
      if (tab === "Alerts") await page.waitForFunction(`[...document.querySelectorAll('[role="tab"]')].some((t) => /Alerts\\s*\\d+/.test(t.textContent))`, undefined, { timeout: 120_000 });
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await page.waitForTimeout(500);
    }
    rows.push(...((await page.evaluate(MEASURE)) as typeof rows).map((r) => ({ ...r, text: `${tab}: ${r.text}` })));
  }
  // Replaying: the replay bar's controls and the status line's replay badge.
  await page.waitForFunction(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Replay" && !b.disabled)`, undefined, { timeout: 120_000 });
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await page.waitForTimeout(800);
  rows.push(...((await page.evaluate(MEASURE)) as typeof rows).map((r) => ({ ...r, text: `Replay: ${r.text}` })));
  const failing = rows.filter((r) => r.ratio < r.need);
  const byColour = new Map<string, { ratio: number; need: number; text: string; n: number }>();
  for (const r of rows) { const k = `${r.color}|${r.need}`; const e = byColour.get(k); if (!e || r.ratio < e.ratio) byColour.set(k, { ...r, n: (e?.n ?? 0) + 1 }); else e.n++; }
  console.log(`\n${label}: ${rows.length} text elements checked, ${failing.length} below the WCAG AA ratio`);
  for (const [k, v] of [...byColour].sort((a, b) => a[1].ratio - b[1].ratio)) console.log(`  ${v.ratio >= v.need ? "ok  " : "FAIL"} ${v.ratio.toFixed(2)}:1 (needs ${v.need}:1) ×${v.n}  e.g. "${v.text}"`);
}
await browser.close();
