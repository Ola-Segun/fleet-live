"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  DEFAULT_DEMO_CONFIG,
  decodeDemoConfig,
  demoConfigHref,
  readDemoConfig,
  type DemoConfig,
} from "@/lib/simulation-settings";
import { configFromSearch } from "@/lib/worker-messages";
import { SimulationConfigForm } from "@/features/live-map/SimulationConfigForm";
import styles from "./site-demo-setup.module.css";

export function SiteDemoLaunchFlow({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<DemoConfig>(DEFAULT_DEMO_CONFIG);
  const [saveWarning, setSaveWarning] = useState(false);
  const [targetHref, setTargetHref] = useState("/app");
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const interceptDemoLink = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname !== "/app") return;
    if (destination.searchParams.get("mode") === "network") return;

    event.preventDefault();
    const saved = readDemoConfig();
    const hasOverrides =
      destination.searchParams.has("n") ||
      destination.searchParams.has("seed") ||
      destination.searchParams.has("at");
    const requestedConfig = hasOverrides
      ? decodeDemoConfig(JSON.stringify(configFromSearch(destination.searchParams)))
      : null;
    setConfig(
      requestedConfig?.mode === "demo"
        ? requestedConfig
        : saved.config ?? DEFAULT_DEMO_CONFIG,
    );
    setSaveWarning(!saved.available);
    setTargetHref(`${destination.pathname}${destination.search}${destination.hash}`);
    setFormKey((key) => key + 1);
    setOpen(true);
  };

  const launch = (next: DemoConfig) => {
    const target = new URL(targetHref, window.location.origin);
    const href = demoConfigHref(next, target);
    window.location.assign(href);
  };

  return (
    <div
      className="min-h-screen bg-brand-paper text-brand-ink"
      onClickCapture={interceptDemoLink}
    >
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby="site-simulation-setup-title"
        aria-describedby="site-simulation-setup-description"
        onClose={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className={styles.dialog}
      >
        <div className={styles.panel}>
          <div className={styles.texture} aria-hidden="true" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close simulation setup"
            className={styles.close}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <header className={styles.head}>
            <p className={styles.eyebrow}>
              <i className={styles.led} aria-hidden="true" />
              Fleet Live · Demo setup
            </p>
            <h2 id="site-simulation-setup-title" className={styles.title}>
              Choose your simulation
            </h2>
            <p id="site-simulation-setup-description" className={styles.lede}>
              Set the fleet size and start time. You can change them later in the app.
            </p>
          </header>
          {open && (
            <SimulationConfigForm
              key={formKey}
              config={config}
              submitLabel="Continue to the demo"
              saveWarning={saveWarning}
              appearance="machined"
              onApply={launch}
            />
          )}
          <footer className={styles.foot}>
            <i className={styles.footDot} aria-hidden="true" />
            Settings are saved in this browser and can be changed from the app.
          </footer>
        </div>
      </dialog>
    </div>
  );
}
