"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  parseAppearance,
  readStoredAppearance,
  storeAppearance,
  type Appearance,
} from "@/app/lib/experience/workspace/appearance";

const storage = () => window.localStorage;

/** Holds a choice for this page view when the browser refused to store it, so the control and theme still agree. */
let unstoredChoice: Appearance | null = null;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  };
}

const getSnapshot = (): Appearance => unstoredChoice ?? readStoredAppearance(storage);
/** The server cannot know the browser's choice; `null` means "not known yet" until hydration. */
const getServerSnapshot = (): Appearance | null => null;

export function setAppearance(appearance: Appearance): void {
  unstoredChoice = storeAppearance(storage, appearance) ? null : appearance;
  applyAppearance(document.documentElement, appearance);
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

/** The current appearance (`null` before hydration) and a setter that applies it at once. */
export function useAppearance(): [Appearance | null, (appearance: Appearance) => void] {
  const appearance = useSyncExternalStore<Appearance | null>(subscribe, getSnapshot, getServerSnapshot);
  return [appearance, useCallback((next: Appearance) => setAppearance(next), [])];
}

/**
 * Mounted once in the root layout: when another tab changes the appearance, this tab applies it without a reload.
 * The head script covers full page loads; `<html>` keeps its attribute across client-side navigations.
 */
export function AppearanceSync() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return;
      unstoredChoice = null;
      applyAppearance(document.documentElement, parseAppearance(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
