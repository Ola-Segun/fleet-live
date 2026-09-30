"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether single-key shortcuts ("/", "F") are on. WCAG 2.1.4 (Character Key
 * Shortcuts, Level A) requires a way to turn them off: screen readers use
 * single letters for their own navigation, and speech-input users can trigger
 * them by accident.
 *
 * Browser storage is an external store, so it's read with useSyncExternalStore:
 * on by default for the server render, then the stored choice, kept in sync
 * across tabs. Storage can be unavailable (private windows, blocked site data),
 * so every access is guarded.
 */
const KEY = "fleet-live:shortcuts";
const CHANGED = "fleet-live:shortcuts-changed";
/** The choice for this visit, used when storage is unavailable so switching off still works. */
let memory: boolean | undefined;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? (memory ?? true) : stored !== "off";
  } catch {
    return memory ?? true;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange); // another tab
  window.addEventListener(CHANGED, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useShortcutsOn(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setShortcutsOn(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not persisted across visits, but `memory` keeps it for this one.
  }
  window.dispatchEvent(new Event(CHANGED));
}
