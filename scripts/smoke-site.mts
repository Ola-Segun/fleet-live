import { launchBrowser } from "./browser.mts";
import { getCenteredDialGeometry } from "../apps/web/src/components/ui/fleet-live-hero/scene";

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

const routes = [
  ["/", "Fleet ops"],
  ["/platform", "A control-room view"],
  ["/use-cases", "Designed for the people"],
  ["/engineering", "A real-time systems problem"],
  ["/product-direction", "Earn the next stage"],
] as const;
const pageCompositionHeadings: Record<string, string> = {
  "/platform": "See the fleet, investigate signals, look back.",
  "/use-cases": "A positioning hypothesis, made testable.",
  "/engineering": "From simulated ping to dispatcher decision.",
  "/product-direction": "Four stages, in the order the evidence allows.",
};
const expectedFooterHrefs = ["/", "/app", "/platform", "/use-cases", "/engineering", "/product-direction"];

for (const width of [360, 390, 768, 825, 857, 905]) {
  for (const span of [180, 300, 480, 680]) {
    const dial = getCenteredDialGeometry(width, span);
    const projectedHalfWidth = (dial.laneHalfWidth + dial.edgePadding) * span * 1.1 / 1.6;
    if (Math.abs(projectedHalfWidth - width * 0.47) > 0.01 || projectedHalfWidth * 2 > width * 0.96) {
      throw new Error(`Dial does not remain centered within its safe width at ${width}px / ${span}px scene span`);
    }
  }
}

for (const [route, heading] of routes) {
  await page.goto(new URL(route, process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: new RegExp(heading) }).waitFor();
  const compositionHeading = pageCompositionHeadings[route];
  if (compositionHeading) {
    await page.getByRole("heading", { level: 2, name: compositionHeading }).waitFor();
  }
  const footer = page.getByRole("contentinfo");
  const footerWordmark = footer.getByTestId("fleet-live-footer-wordmark");
  await footerWordmark.waitFor();
  const footerCanvasLayout = await footerWordmark.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Footer wordmark test target is not a canvas");
    const footer = element.parentElement;
    if (!(footer instanceof HTMLElement)) throw new Error("Footer wordmark has no footer parent");
    const canvasBounds = element.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    return {
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      footerWidth: footerBounds.width,
      footerHeight: footerBounds.height,
    };
  });
  if (
    Math.abs(footerCanvasLayout.canvasWidth - footerCanvasLayout.footerWidth) > 1 ||
    Math.abs(footerCanvasLayout.canvasHeight - footerCanvasLayout.footerHeight) > 1
  ) {
    throw new Error(`${route} footer wordmark field should cover the full footer: ${JSON.stringify(footerCanvasLayout)}`);
  }
  const footerHrefs = await footer.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  if (
    footerHrefs.some((href) => !href || !expectedFooterHrefs.includes(href)) ||
    expectedFooterHrefs.some((href) => !footerHrefs.includes(href))
  ) {
    throw new Error(`${route} footer should use real site destinations: ${JSON.stringify(footerHrefs)}`);
  }
  if (route === "/") {
    const heroScene = page.getByTestId("fleet-live-hero-scene");
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="fleet-live-hero-scene"]');
      return canvas !== null && canvas.width > 0 && canvas.height > 0 && canvas.dataset.sceneState === "animated";
    });
    if (!(await heroScene.isVisible())) throw new Error("The homepage signal-dial animation canvas is not visible");
    const heroShaderMask = await page
      .getByTestId("fleet-live-hero")
      .getByTestId("dithered-shader-background")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          maskImage: style.maskImage,
          webkitMaskImage: style.webkitMaskImage,
          zIndex: style.zIndex,
        };
      });
    const computedMask = `${heroShaderMask.maskImage} ${heroShaderMask.webkitMaskImage}`;
    if (
      !computedMask.includes("radial-gradient") ||
      !computedMask.includes("rgba(0, 0, 0, 0)") ||
      heroShaderMask.zIndex !== "1"
    ) {
      throw new Error(`The hero shader should be masked to the edges around a clear center: ${JSON.stringify(heroShaderMask)}`);
    }
    const demoLink = page.getByRole("link", { name: "Explore the live demo" });
    if (!(await demoLink.getAttribute("href"))?.endsWith("/app")) {
      throw new Error("The hero demo CTA should open /app");
    }
    const glitch = await page.getByTestId("fleet-live-hero-noise").evaluate((element) => {
      const before = getComputedStyle(element, "::before");
      return { duration: before.animationDuration, iterations: before.animationIterationCount };
    });
    if (glitch.duration !== "7s" || glitch.iterations !== "infinite") {
      throw new Error(`The hero noise glitch should recur occasionally: ${JSON.stringify(glitch)}`);
    }
  }
  const heroTop = await page.locator("main > section").first().evaluate((element) => element.getBoundingClientRect().top);
  if (Math.abs(heroTop) > 1) throw new Error(`${route} hero should extend behind the navbar; hero top is ${heroTop}px`);
  const heroHeight = await page.locator("main > section").first().evaluate((element) => element.getBoundingClientRect().height);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  if (heroHeight < viewportHeight * 0.7) {
    throw new Error(`${route} hero is shorter than 70% of the desktop viewport: ${heroHeight}px`);
  }
  const heroContentWidth = await page.locator("main > section > div.relative.z-10").first().evaluate((element) => element.getBoundingClientRect().width);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (heroContentWidth < viewportWidth - 80) {
    throw new Error(`${route} hero content is not using the expanded page width: ${heroContentWidth}px`);
  }
  const navbarContrast = await page.getByRole("banner").evaluate((element) => {
    const nav = element.querySelector("nav");
    if (!nav) throw new Error("Primary navigation panel is missing");
    const shell = getComputedStyle(element);
    const panel = getComputedStyle(nav);
    return {
      background: shell.backgroundColor,
      panelBackground: panel.backgroundImage,
      border: panel.borderColor,
      backdropFilter: panel.backdropFilter,
    };
  });
  if (
    navbarContrast.background !== "rgba(0, 0, 0, 0)" ||
    navbarContrast.panelBackground === "none" ||
    navbarContrast.border === "rgba(0, 0, 0, 0)" ||
    navbarContrast.backdropFilter === "none"
  ) {
    throw new Error(`${route} navbar should use the floating glass panel style: ${JSON.stringify(navbarContrast)}`);
  }
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: 400, behavior: "instant" });
  });
  await page.waitForFunction(() => {
    const header = document.querySelector("header");
    const nav = header?.querySelector("nav");
    return nav !== null && nav !== undefined && getComputedStyle(nav).backgroundColor !== "rgba(0, 0, 0, 0)";
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (route !== "/") {
    const currentLink = page.locator('nav[aria-label="Main navigation"] a[aria-current="page"]');
    if ((await currentLink.getAttribute("href")) !== route) {
      throw new Error(`${route} is not marked as the current navigation page`);
    }
  }
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('[data-testid="dithered-shader-canvas"]'));
    if (canvases.length === 0) return false;
    return canvases.every((canvas) => {
      const bounds = canvas.getBoundingClientRect();
      const visible = bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
      const pausesWhenHidden = canvas.parentElement?.getAttribute("data-pause-when-hidden") === "true";
      const expectedState = !pausesWhenHidden || visible ? "rendered" : "paused";
      return canvas.getAttribute("data-shader-state") === expectedState;
    });
  }, undefined, { timeout: 15_000 });
  const overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  if (overflow) throw new Error(`${route} overflows horizontally at desktop width`);
}

await page.goto(new URL("/", process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString(), { waitUntil: "domcontentloaded" });
const shader = page.locator("main").getByTestId("dithered-shader-background").first();
await page.waitForFunction(() => document.querySelector('[data-testid="dithered-shader-canvas"]')?.getAttribute("data-shader-state") === "rendered", undefined, { timeout: 15_000 });
const shaderStyle = await shader.evaluate((element) => {
  const style = getComputedStyle(element);
  return { opacity: style.opacity, pointerEvents: style.pointerEvents, backgroundImage: style.backgroundImage };
});
if (shaderStyle.opacity !== "0.08" || shaderStyle.pointerEvents !== "none" || shaderStyle.backgroundImage === "none") {
  throw new Error(`Shader background should remain subtle and non-interactive: ${JSON.stringify(shaderStyle)}`);
}
const footer = page.getByRole("contentinfo");
const footerWordmark = footer.getByTestId("fleet-live-footer-wordmark");
await footer.scrollIntoViewIfNeeded();
await page.waitForFunction(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="fleet-live-footer-wordmark"]');
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return false;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return pixels.some((value, index) => index % 4 === 3 && value > 0);
}, undefined, { timeout: 5_000 });
await page.getByRole("link", { name: "Open interactive demo" }).first().click();
await page.getByRole("heading", { level: 1, name: /Fleet Live Demo/ }).waitFor();

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(new URL("/", process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString(), { waitUntil: "networkidle" });
const menuButton = page.locator('button[aria-controls="mobile-site-navigation"]');
await page.getByRole("button", { name: "Open navigation menu" }).waitFor();
await menuButton.click();
const menuPanel = page.locator("#mobile-site-navigation");
await menuPanel.waitFor({ state: "visible" });
if ((await menuButton.getAttribute("aria-expanded")) !== "true") {
  throw new Error("Mobile navigation panel opened without updating its expanded state");
}
const menuBounds = await menuPanel.boundingBox();
const viewportHeight = await page.evaluate(() => window.innerHeight);
if (!menuBounds || menuBounds.height < viewportHeight - 80 - 1) {
  throw new Error("Mobile navigation panel does not cover the available viewport");
}
for (const label of ["Platform", "Use cases", "Engineering", "Product direction", "Open interactive demo"]) {
  if (!(await menuPanel.getByRole("link", { name: label }).isVisible())) {
    throw new Error(`Mobile navigation item "${label}" is not visible`);
  }
}
await page.keyboard.press("Escape");
if ((await menuButton.getAttribute("aria-expanded")) !== "false") {
  throw new Error("Escape did not close mobile navigation");
}
await menuButton.click();
await menuPanel.getByRole("link", { name: "Platform" }).click();
await page.getByRole("heading", { level: 1, name: /A control-room view/ }).waitFor();
if (new URL(page.url()).pathname !== "/platform" || (await menuButton.getAttribute("aria-expanded")) !== "false") {
  throw new Error("Mobile navigation did not navigate and close consistently");
}

for (const [route, heading] of routes) {
  await page.goto(new URL(route, process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: new RegExp(heading) }).waitFor();
  const heroTop = await page.locator("main > section").first().evaluate((element) => element.getBoundingClientRect().top);
  if (Math.abs(heroTop) > 1) throw new Error(`${route} mobile hero should extend behind the navbar; hero top is ${heroTop}px`);
  const heroHeight = await page.locator("main > section").first().evaluate((element) => element.getBoundingClientRect().height);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  if (heroHeight < viewportHeight * 0.7) {
    throw new Error(`${route} hero is shorter than 70% of the mobile viewport: ${heroHeight}px`);
  }
  const overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  if (overflow) throw new Error(`${route} overflows horizontally at mobile width`);
  if (route === "/") {
    const mobileActions = page.getByTestId("fleet-live-hero-mobile-actions");
    const desktopActions = page.getByTestId("fleet-live-hero-desktop-actions");
    const counters = page.getByTestId("fleet-live-hero-counters");
    if (!(await mobileActions.isVisible()) || (await desktopActions.isVisible()) || (await counters.isVisible())) {
      throw new Error("Mobile hero should show the bottom actions and hide the desktop actions and signal counters");
    }
    const actionBounds = await mobileActions.boundingBox();
    const heroBounds = await page.getByTestId("fleet-live-hero").boundingBox();
    if (!actionBounds || !heroBounds || actionBounds.y < heroBounds.y + heroBounds.height * 0.65) {
      throw new Error("Mobile hero actions should sit below the dial near the bottom of the hero");
    }
    const copyBounds = await page.getByTestId("fleet-live-hero-copy").boundingBox();
    const horizonY = Number(await page.getByTestId("fleet-live-hero-scene").getAttribute("data-horizon-y"));
    const copyToHorizon = copyBounds ? horizonY - copyBounds.y - copyBounds.height : -1;
    if (!copyBounds || horizonY <= 0 || copyToHorizon < 0 || copyToHorizon > 80 || horizonY >= actionBounds.y) {
      throw new Error("Mobile animation should start close below the hero copy and above the bottom actions");
    }
  }
}

for (const width of [360, 390, 768, 825, 857, 905, 1440, 1920]) {
  await page.setViewportSize({ width, height: width < 820 ? 844 : 1000 });
  await page.goto(new URL("/", process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('[data-testid="fleet-live-hero-scene"]')?.dataset.sceneState === "animated");
  if (width < 820) {
    const copyBounds = await page.getByTestId("fleet-live-hero-copy").boundingBox();
    const actionBounds = await page.getByTestId("fleet-live-hero-mobile-actions").boundingBox();
    const horizonY = Number(await page.getByTestId("fleet-live-hero-scene").getAttribute("data-horizon-y"));
    if (
      !copyBounds ||
      !actionBounds ||
      horizonY <= 0 ||
      horizonY - copyBounds.y - copyBounds.height < 0 ||
      horizonY - copyBounds.y - copyBounds.height > 80 ||
      horizonY >= actionBounds.y
    ) {
      throw new Error(`Mobile hero copy, animation, and actions should be vertically composed at ${width}px`);
    }
    const hero = page.getByTestId("fleet-live-hero");
    await hero.dispatchEvent("pointermove", { pointerType: "touch", clientX: width - 12, clientY: 400 });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
    await page.waitForTimeout(250);
    const bounds = await page.getByTestId("fleet-live-hero-scene").evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error("Hero scene test target is not a canvas");
      return {
        canvasWidth: element.width,
        displayWidth: element.clientWidth,
        state: element.dataset.sceneState,
      };
    });
    if (bounds.state !== "animated" || bounds.canvasWidth === 0 || bounds.displayWidth !== width) {
      throw new Error(`Mobile hero animation did not remain centered at ${width}px after touch/scroll: ${JSON.stringify(bounds)}`);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  const layout = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>('[data-testid="fleet-live-hero"]');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="fleet-live-hero-scene"]');
    const desktopActions = document.querySelector<HTMLElement>('[data-testid="fleet-live-hero-desktop-actions"]');
    const mobileActions = document.querySelector<HTMLElement>('[data-testid="fleet-live-hero-mobile-actions"]');
    const counters = document.querySelector<HTMLElement>('[data-testid="fleet-live-hero-counters"]');
    const activeActions = document.documentElement.clientWidth < 820 ? mobileActions : desktopActions;
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heroWidth: hero?.getBoundingClientRect().width ?? 0,
      canvasWidth: canvas?.width ?? 0,
      canvasDisplayWidth: canvas?.getBoundingClientRect().width ?? 0,
      dialCenterX: Number(canvas?.dataset.dialCenterX),
      dialHalfWidth: Number(canvas?.dataset.dialHalfWidth),
      ctaVisible: (activeActions?.querySelector('a[href="/app"]')?.getBoundingClientRect().width ?? 0) > 0,
      desktopActionsVisible: desktopActions !== null && getComputedStyle(desktopActions).display !== "none",
      mobileActionsVisible: mobileActions !== null && getComputedStyle(mobileActions).display !== "none",
      countersVisible: counters !== null && getComputedStyle(counters).display !== "none",
    };
  });
  if (
    layout.scrollWidth > layout.viewportWidth ||
    layout.heroWidth < layout.viewportWidth - 1 ||
    layout.canvasWidth === 0 ||
    layout.canvasWidth > Math.ceil(layout.heroWidth * 1.5) ||
    !layout.ctaVisible ||
    (width >= 820 && width <= 905 &&
      (!Number.isFinite(layout.dialCenterX) ||
        !Number.isFinite(layout.dialHalfWidth) ||
        Math.abs(layout.dialCenterX - layout.canvasDisplayWidth / 2) > 1 ||
        layout.dialHalfWidth * 2 > layout.canvasDisplayWidth * 0.96)) ||
    (width < 820 && (!layout.mobileActionsVisible || layout.desktopActionsVisible || layout.countersVisible)) ||
    (width >= 820 && (!layout.desktopActionsVisible || layout.mobileActionsVisible || !layout.countersVisible))
  ) {
    throw new Error(`Homepage hero is not composed correctly at ${width}px: ${JSON.stringify(layout)}`);
  }
}

const reducedMotionPage = await browser.newPage({ reducedMotion: "reduce" });
await reducedMotionPage.goto(new URL("/", process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString());
await reducedMotionPage.waitForFunction(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="fleet-live-hero-scene"]');
  return canvas !== null && canvas.width > 0 && canvas.height > 0 && canvas.dataset.sceneState === "static";
});
if (await reducedMotionPage.getByTestId("fleet-live-hero-scene").isVisible() === false) {
  throw new Error("The reduced-motion hero should render a visible static scene");
}
await reducedMotionPage.locator("footer").scrollIntoViewIfNeeded();
await reducedMotionPage.waitForTimeout(500);
const reducedMotionWordmark = await reducedMotionPage.getByTestId("fleet-live-footer-wordmark").evaluate((element) => {
  if (!(element instanceof HTMLCanvasElement)) throw new Error("Footer wordmark test target is not a canvas");
  const context = element.getContext("2d");
  if (!context) return false;
  const pixels = context.getImageData(0, 0, element.width, element.height).data;
  return pixels.some((value, index) => index % 4 === 3 && value > 0);
});
if (!reducedMotionWordmark) {
  throw new Error("The reduced-motion footer should render a static wordmark");
}
if ((await reducedMotionPage.locator('[data-testid="dithered-shader-canvas"][data-shader-state="ready"]').count()) > 0) {
  throw new Error("Animated shader rendered despite prefers-reduced-motion");
}

if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
const firstPaintPage = await browser.newPage({ javaScriptEnabled: false });
await firstPaintPage.goto(new URL("/", process.env.BASE_URL ?? "http://127.0.0.1:3100/").toString());
const firstPaint = await firstPaintPage.locator("main").getByTestId("dithered-shader-background").first().evaluate((element) => ({
  backgroundImage: getComputedStyle(element).backgroundImage,
  canvasPresent: element.querySelector("canvas") !== null,
  canvasState: element.querySelector("canvas")?.getAttribute("data-shader-state"),
}));
if (firstPaint.backgroundImage === "none" || !firstPaint.canvasPresent || firstPaint.canvasState !== null) {
  throw new Error(`The dither fallback must be visible in server-rendered HTML before JavaScript: ${JSON.stringify(firstPaint)}`);
}
console.log(`Passed: ${routes.length} public routes render at desktop and mobile; homepage signal-dial scene fits 360–1920px, demo CTA opens /app, both animation layers respect reduced motion, and shader fallback is present in first-paint HTML.`);
await firstPaintPage.close();
await browser.close();
