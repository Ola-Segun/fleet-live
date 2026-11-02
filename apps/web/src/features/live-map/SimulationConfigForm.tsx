"use client";

import { useState, type FormEvent } from "react";
import {
  DEFAULT_DEMO_CONFIG,
  MAX_SEED_LENGTH,
  MAX_VEHICLES,
  MIN_VEHICLES,
  type DemoConfig,
} from "@/lib/simulation-settings";

function toTime(startMinute: number | undefined): string {
  if (startMinute === undefined) return "";
  const hours = Math.floor(startMinute / 60).toString().padStart(2, "0");
  const minutes = (startMinute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function SimulationConfigForm({
  config,
  submitLabel,
  saveWarning = false,
  appearance = "default",
  onApply,
  onReset,
}: {
  config: DemoConfig;
  submitLabel: string;
  saveWarning?: boolean;
  appearance?: "default" | "machined";
  onApply: (config: DemoConfig) => void;
  onReset?: () => void;
}) {
  const [vehicleCount, setVehicleCount] = useState(String(config.vehicleCount));
  const [seed, setSeed] = useState(config.seed);
  const [time, setTime] = useState(toTime(config.startMinute));
  const [error, setError] = useState("");
  const machined = appearance === "machined";

  const reset = () => {
    if (onReset) {
      onReset();
      return;
    }
    setVehicleCount(String(DEFAULT_DEMO_CONFIG.vehicleCount));
    setSeed(DEFAULT_DEMO_CONFIG.seed);
    setTime(toTime(DEFAULT_DEMO_CONFIG.startMinute));
    setError("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(vehicleCount);
    const normalizedSeed = seed.trim() || DEFAULT_DEMO_CONFIG.seed;
    if (!Number.isInteger(count) || count < MIN_VEHICLES || count > MAX_VEHICLES) {
      setError(`Choose between ${MIN_VEHICLES.toLocaleString()} and ${MAX_VEHICLES.toLocaleString()} vehicles.`);
      return;
    }
    if (normalizedSeed.length > MAX_SEED_LENGTH) {
      setError(`Enter a scenario seed of 1–${MAX_SEED_LENGTH} characters.`);
      return;
    }
    if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      setError("Enter a valid start time.");
      return;
    }

    const [hours, minutes] = time ? time.split(":").map(Number) : [];
    onApply({
      mode: "demo",
      vehicleCount: count,
      seed: normalizedSeed,
      ...(hours === undefined || minutes === undefined ? {} : { startMinute: hours * 60 + minutes }),
    });
  };

  return (
    <form noValidate onSubmit={submit} className={machined ? "setupForm" : "grid gap-4"}>
      <div className={machined ? "setupGrid" : "grid gap-4 sm:grid-cols-2"}>
        <label className={machined ? "setupField" : "grid gap-1.5 text-sm font-medium"}>
          Vehicles
          <div className={machined ? "setupControl" : undefined}>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_VEHICLES}
              max={MAX_VEHICLES}
              step="1"
              required
              value={vehicleCount}
              onChange={(event) => {
                setVehicleCount(event.target.value);
                if (error) setError("");
              }}
              className={machined ? "setupInput setupWithUnit" : "min-h-11 w-full rounded-lg border border-control bg-transparent px-3 text-base tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"}
            />
            {machined && <span className="setupUnit" aria-hidden="true">vehicles</span>}
          </div>
          <span className={machined ? "setupHint" : "text-xs font-normal text-muted"}>
            1–20,000 simulated vehicles
          </span>
        </label>

        <label className={machined ? "setupField" : "grid gap-1.5 text-sm font-medium"}>
          Start time
          <div className={machined ? "setupControl" : undefined}>
            <input
              type="time"
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                if (error) setError("");
              }}
              className={machined ? "setupInput setupTime" : "min-h-11 w-full rounded-lg border border-control bg-transparent px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"}
            />
          </div>
          <span className={machined ? "setupHint" : "text-xs font-normal text-muted"}>Blank uses the current Lagos time</span>
        </label>
      </div>

      <details className={machined ? "setupAdv" : "rounded-lg border border-line px-3 py-2.5"}>
        <summary className={machined ? "setupAdvSummary" : "cursor-pointer text-sm font-medium"}>
          {machined && (
            <svg className="setupChev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className={machined ? "setupAdvTitle" : undefined}>Repeatable scenario</span>
          {machined && <span className="setupBadge">Optional</span>}
        </summary>
        <div className={machined ? "setupAdvBody" : undefined}>
          <label className={machined ? "setupField" : "mt-3 grid gap-1.5 text-sm font-medium"}>
            Scenario seed
            <input
              type="text"
              maxLength={MAX_SEED_LENGTH}
              value={seed}
              onChange={(event) => {
                setSeed(event.target.value);
                if (error) setError("");
              }}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={machined ? "setupInput" : "min-h-10 rounded-lg border border-control bg-transparent px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"}
            />
            <span className={machined ? "setupHint" : "text-xs font-normal text-muted"}>Use the same seed to replay the same fleet. Blank uses the default.</span>
          </label>
        </div>
      </details>

      {error && machined && <p role="alert" className="setupFormError">{error}</p>}
      {error && !machined && <p role="alert" className="text-sm text-danger">{error}</p>}
      {saveWarning && (
        <p role="status" className={machined ? "setupWarning" : "text-sm text-warn"}>
          Browser storage is unavailable. These settings will last for this visit only.
        </p>
      )}

      <div className={machined ? "setupActions" : "flex flex-wrap items-center justify-between gap-3"}>
        <button
          type="button"
          onClick={reset}
          className={machined ? "setupLink" : "min-h-10 rounded-lg px-3 text-sm font-medium text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"}
        >
          Use defaults
        </button>
        <button
          type="submit"
          className={machined ? "setupBtn" : "min-h-11 rounded-lg bg-brand-ink px-5 text-sm font-semibold text-white transition hover:bg-brand-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"}
        >
          {submitLabel}
          {machined && (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
