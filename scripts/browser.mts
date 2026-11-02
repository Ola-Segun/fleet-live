/**
 * What every browser check shares: where the app is, which browser to drive,
 * and whether timing can be trusted.
 *
 * - Locally (the dev laptop): the installed Chrome, which renders on the real
 *   GPU. Frame-time thresholds are meaningful and they gate.
 * - In CI (a GitHub runner, no GPU): Playwright's Chromium, with WebGL in
 *   software (SwiftShader). Everything functional and every accessibility
 *   check gates exactly as locally. Frame times are measured and printed but
 *   never fail the run, because software rendering says nothing about a real
 *   device.
 *
 * `SOFTWARE_GL=1` forces the CI rendering path locally, to check the suite
 * passes without a GPU before pushing.
 */
import { existsSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";

/** The built app, started with `pnpm --filter @fleet/web start -p 3100`. */
export const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100/";

/** The interactive fleet console is served separately from the public product site. */
export const DEMO_URL = new URL("/app", BASE_URL).toString();

/** Timing isn't gated: CI, or software WebGL forced locally. */
export const SOFTWARE_TIMING = Boolean(process.env.CI || process.env.SOFTWARE_GL);

/**
 * How long to wait for the app to be ready. Software WebGL draws the fleet at
 * about 5 fps on the dev laptop (against 60 on its GPU), so every wait that
 * counts frames needs longer there.
 */
export const READY_MS = SOFTWARE_TIMING ? 150_000 : 40_000;

/** How long to wait for something the simulation has to produce: the first alerts, 30 s of replayable history. */
export const EVENT_MS = SOFTWARE_TIMING ? 360_000 : 120_000;

const INSTALLED_CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

export function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH ?? (existsSync(INSTALLED_CHROME) ? INSTALLED_CHROME : undefined);
  // Current Chrome only falls back to SwiftShader for WebGL when explicitly allowed.
  const args = SOFTWARE_TIMING ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [];
  return chromium.launch({ executablePath, headless: true, args });
}

/**
 * A timing check's verdict: its own result on a real GPU; always a pass under
 * software rendering, with the measurement kept and the reason stated.
 */
export function timing(ok: boolean, detail: string): [ok: boolean, detail: string] {
  return SOFTWARE_TIMING ? [true, `${detail}; software WebGL, measured but not gated`] : [ok, detail];
}
