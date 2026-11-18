/**
 * The appearance preference (add-account-settings-and-help, design Decisions 3 and 4).
 *
 * "light" and "dark" are stored in this browser's localStorage and applied as `data-theme` on `<html>`; "auto"
 * removes both, so CSS follows the operating system through `color-scheme: light dark`. Every storage access may
 * throw (blocked storage, private windows), and a failure always degrades to "auto".
 */

export const APPEARANCE_STORAGE_KEY = "jdfit:appearance";

/** Dispatched on `window` after a same-tab change; other tabs hear the `storage` event instead. */
export const APPEARANCE_CHANGE_EVENT = "jdfit:appearance-change";

export const APPEARANCES = ["auto", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** Anything other than a stored "light" or "dark" means Auto. */
export function parseAppearance(raw: unknown): Appearance {
  return raw === "light" || raw === "dark" ? raw : "auto";
}

/** The `data-theme` value for an appearance; Auto has none. */
export function themeAttribute(appearance: Appearance): "light" | "dark" | null {
  return appearance === "auto" ? null : appearance;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RootLike {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function readStoredAppearance(getStorage: () => StorageLike): Appearance {
  try {
    return parseAppearance(getStorage().getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

/** Stores the choice (Auto removes the key). Returns false when storage refused the write. */
export function storeAppearance(getStorage: () => StorageLike, appearance: Appearance): boolean {
  try {
    const storage = getStorage();
    if (appearance === "auto") storage.removeItem(APPEARANCE_STORAGE_KEY);
    else storage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    return true;
  } catch {
    return false;
  }
}

export function applyAppearance(root: RootLike, appearance: Appearance): void {
  const value = themeAttribute(appearance);
  if (value) root.setAttribute("data-theme", value);
  else root.removeAttribute("data-theme");
}

/**
 * Runs in `<head>` before first paint on every full page load: applies a stored "light" or "dark" and otherwise
 * leaves `<html>` untouched. Kept dependency-free and wrapped in try/catch so it can never break the page.
 */
export const APPEARANCE_HEAD_SCRIPT =
  "(function(){try{" +
  `var v=window.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});` +
  'if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}' +
  "}catch(e){}})();";
