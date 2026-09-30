"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept live. Layout that decides *what exists*
 * (one panel, not a visible one plus a CSS-hidden copy with duplicate ids)
 * has to be decided in JavaScript. `serverValue` is used for the prerendered
 * shell and the first hydration pass, so server and client agree.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => serverValue,
  );
}
