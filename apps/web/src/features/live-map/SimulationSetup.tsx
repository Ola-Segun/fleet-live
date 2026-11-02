"use client";

import { useEffect, useRef } from "react";
import type { DemoConfig } from "@/lib/simulation-settings";
import { SimulationConfigForm } from "./SimulationConfigForm";

export function SimulationSetup({
  config,
  required,
  saveWarning,
  onApply,
  onReset,
  onClose,
}: {
  config: DemoConfig;
  required: boolean;
  saveWarning: boolean;
  onApply: (config: DemoConfig) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="simulation-setup-title"
      aria-describedby="simulation-setup-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!required) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,34rem)] max-w-none overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/55"
    >
      <div className="p-5 sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Fleet Live · Demo setup</p>
            <h2 id="simulation-setup-title" className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
              Choose your simulation
            </h2>
            <p id="simulation-setup-description" className="mt-2 text-sm leading-6 text-muted">
              Set the fleet size and start time. You can change these later; settings stay in this browser.
            </p>
          </div>
          {!required && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close simulation settings"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-control text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>

        <SimulationConfigForm
          config={config}
          submitLabel="Start demo"
          saveWarning={saveWarning}
          onApply={onApply}
          onReset={onReset}
        />
      </div>
    </dialog>
  );
}
