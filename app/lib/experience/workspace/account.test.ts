import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIapIdentity } from "./account";

describe("IAP identity for the account menu", () => {
  it("strips the accounts.google.com namespace and derives the initial", () => {
    assert.deepEqual(parseIapIdentity("accounts.google.com:desmond@example.com"), { email: "desmond@example.com", initial: "D" });
  });

  it("accepts a value without the namespace", () => {
    assert.deepEqual(parseIapIdentity("owner@example.com"), { email: "owner@example.com", initial: "O" });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(parseIapIdentity("  accounts.google.com:a.b@example.com "), { email: "a.b@example.com", initial: "A" });
  });

  it("has no identity when the header is missing or empty", () => {
    assert.equal(parseIapIdentity(null), null);
    assert.equal(parseIapIdentity(undefined), null);
    assert.equal(parseIapIdentity(""), null);
    assert.equal(parseIapIdentity("accounts.google.com:"), null);
  });

  it("rejects values that are not one address", () => {
    for (const value of ["not-an-email", "a@b@c", "@example.com", "owner@", "two words@example.com"]) {
      assert.equal(parseIapIdentity(value), null, value);
    }
  });

  it("uses the first letter or digit for the avatar", () => {
    assert.equal(parseIapIdentity("_9lives@example.com")?.initial, "9");
    assert.equal(parseIapIdentity("élan@example.com")?.initial, "É");
  });

  it("has no initial when the address has no letter or digit before or after the @", () => {
    assert.deepEqual(parseIapIdentity("_@_.-"), { email: "_@_.-", initial: null });
  });
});
