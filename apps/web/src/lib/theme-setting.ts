"use client";

import { useSyncExternalStore } from "react";

/**
 * Light or dark. It follows the system's colour scheme until the person picks
 * one with the header button; after that, their choice is kept.
 *
 * The choice is applied as `data-theme` on <html>. An inline script in the
 * root layout sets it before the first paint (THEME_SCRIPT below), so a reload
 * never flashes the wrong colours. The CSS tokens (globals.css) read it.
 */
export type ThemeChoice = "light" | "dark";

export const THEME_KEY = "fleet-live:theme";
const CHANGED = "fleet-live:theme-changed";
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** This visit's choice when storage is unavailable, so the button still works. */
let memory: ThemeChoice | undefined;

/** Runs in <head> before anything paints: the stored choice onto <html>, or nothing (follow the system). */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** Dark or not, from a stored choice (if any) and the system's preference. */
export function resolveDark(choice: string | null | undefined, systemDark: boolean): boolean {
  return choice === "dark" || (choice !== "light" && systemDark);
}

function stored(): ThemeChoice | undefined {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage blocked: fall back to this visit's choice.
  }
  return memory;
}

function read(): boolean {
  return resolveDark(stored(), window.matchMedia(DARK_QUERY).matches);
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange); // the system switched, and no choice overrides it
  window.addEventListener("storage", onChange); // another tab
  window.addEventListener(CHANGED, onChange); // this tab
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Whether the page is dark right now: the choice if there is one, the system otherwise. Light on the server. */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function setTheme(choice: ThemeChoice): void {
  memory = choice;
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Kept in `memory` for this visit.
  }
  document.documentElement.setAttribute("data-theme", choice);
  window.dispatchEvent(new Event(CHANGED));
}
