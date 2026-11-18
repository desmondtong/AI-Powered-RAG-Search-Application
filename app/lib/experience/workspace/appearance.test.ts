import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPEARANCE_HEAD_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  parseAppearance,
  readStoredAppearance,
  storeAppearance,
  themeAttribute,
} from "./appearance";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

class FakeRoot {
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

const throwing = () => {
  throw new Error("SecurityError: storage is blocked");
};

/** Runs the head script against stubbed `window` and `document`, as the browser would before first paint. */
function runHeadScript(storage: unknown): FakeRoot {
  const root = new FakeRoot();
  const run = new Function("window", "document", APPEARANCE_HEAD_SCRIPT);
  run({ get localStorage() { return typeof storage === "function" ? (storage as () => never)() : storage; } }, { documentElement: root });
  return root;
}

describe("appearance preference", () => {
  it("only a stored light or dark leaves Auto", () => {
    assert.equal(parseAppearance("light"), "light");
    assert.equal(parseAppearance("dark"), "dark");
    for (const raw of [null, undefined, "", "auto", "Dark", "system", 1, {}]) {
      assert.equal(parseAppearance(raw), "auto", String(raw));
    }
  });

  it("Auto has no theme attribute", () => {
    assert.equal(themeAttribute("auto"), null);
    assert.equal(themeAttribute("light"), "light");
    assert.equal(themeAttribute("dark"), "dark");
  });

  it("stores light and dark, and Auto removes the key", () => {
    const storage = new MemoryStorage();
    assert.equal(storeAppearance(() => storage, "dark"), true);
    assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "dark");
    assert.equal(readStoredAppearance(() => storage), "dark");
    assert.equal(storeAppearance(() => storage, "auto"), true);
    assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), null);
    assert.equal(readStoredAppearance(() => storage), "auto");
  });

  it("blocked storage reads as Auto and reports a failed write", () => {
    assert.equal(readStoredAppearance(throwing), "auto");
    assert.equal(storeAppearance(throwing, "dark"), false);
  });

  it("applies and clears the data-theme attribute", () => {
    const root = new FakeRoot();
    applyAppearance(root, "light");
    assert.equal(root.attributes.get("data-theme"), "light");
    applyAppearance(root, "auto");
    assert.equal(root.attributes.has("data-theme"), false);
  });

  it("the head script applies a stored theme before paint", () => {
    for (const value of ["light", "dark"]) {
      const storage = new MemoryStorage();
      storage.setItem(APPEARANCE_STORAGE_KEY, value);
      assert.equal(runHeadScript(storage).attributes.get("data-theme"), value);
    }
  });

  it("the head script leaves Auto and unknown values alone", () => {
    const storage = new MemoryStorage();
    assert.equal(runHeadScript(storage).attributes.size, 0);
    storage.setItem(APPEARANCE_STORAGE_KEY, "<script>");
    assert.equal(runHeadScript(storage).attributes.size, 0);
  });

  it("the head script never throws when storage is blocked", () => {
    assert.doesNotThrow(() => runHeadScript(throwing));
    assert.equal(runHeadScript(throwing).attributes.size, 0);
  });

  it("the head script reads the same key the helpers write", () => {
    assert.ok(APPEARANCE_HEAD_SCRIPT.includes(JSON.stringify(APPEARANCE_STORAGE_KEY)));
  });
});
