import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_CONFIG,
  demoConfigHref,
  decodeDemoConfig,
  hasSimulationOverrides,
} from "../src/lib/simulation-settings";

describe("simulation settings", () => {
  it("uses the current demo defaults", () => {
    expect(DEFAULT_DEMO_CONFIG).toEqual({
      mode: "demo",
      seed: "fleet-live",
      vehicleCount: 5000,
    });
  });

  it("decodes a saved demo configuration", () => {
    expect(
      decodeDemoConfig(JSON.stringify({
        mode: "demo",
        seed: "repeatable",
        vehicleCount: 1200,
        startMinute: 1350,
      })),
    ).toEqual({
      mode: "demo",
      seed: "repeatable",
      vehicleCount: 1200,
      startMinute: 1350,
    });
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ mode: "network", url: "ws://localhost" }),
    JSON.stringify({ mode: "demo", seed: "", vehicleCount: 5000 }),
    JSON.stringify({ mode: "demo", seed: "ok", vehicleCount: 20_001 }),
    JSON.stringify({ mode: "demo", seed: "ok", vehicleCount: 5000, startMinute: 1440 }),
  ])("rejects invalid saved settings: %s", (raw) => {
    expect(decodeDemoConfig(raw)).toBeNull();
  });

  it("detects explicit URL simulation options", () => {
    expect(hasSimulationOverrides(new URLSearchParams())).toBe(false);
    expect(hasSimulationOverrides(new URLSearchParams("n=1000"))).toBe(true);
    expect(hasSimulationOverrides(new URLSearchParams("at=2230"))).toBe(true);
  });

  it("carries demo settings into the app URL", () => {
    const href = demoConfigHref({
      mode: "demo",
      seed: "repeatable scenario",
      vehicleCount: 1200,
      startMinute: 1350,
    });
    const url = new URL(href, "https://fleet-live.example");

    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("n")).toBe("1200");
    expect(url.searchParams.get("seed")).toBe("repeatable scenario");
    expect(url.searchParams.get("at")).toBe("2230");
  });

  it("leaves start time unset when the user chooses current Lagos time", () => {
    const url = new URL(demoConfigHref(DEFAULT_DEMO_CONFIG), "https://fleet-live.example");
    expect(url.searchParams.has("at")).toBe(false);
  });

  it("preserves unrelated app URL options while replacing setup values", () => {
    const url = new URL(
      demoConfigHref(
        { ...DEFAULT_DEMO_CONFIG, vehicleCount: 1200 },
        "https://fleet-live.example/app?n=300&seed=old&at=2230&mode=demo&view=alerts",
      ),
      "https://fleet-live.example",
    );

    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("n")).toBe("1200");
    expect(url.searchParams.get("seed")).toBe(DEFAULT_DEMO_CONFIG.seed);
    expect(url.searchParams.has("at")).toBe(false);
    expect(url.searchParams.get("view")).toBe("alerts");
  });
});
