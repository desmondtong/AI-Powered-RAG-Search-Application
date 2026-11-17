import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSameOriginMutation, assertTrustedReadBoundary, ExperienceApiError, publicRequestOrigin } from "./apiRoutes";

// What Cloud Run's front end hands the container: plain HTTP on the listen address, the public host in `Host`,
// and the public scheme in `X-Forwarded-Proto`.
const HOSTED = "jd-fit-check-abc123-ts.a.run.app";

function post(url: string, headers: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}

function rejected(run: () => void) {
  assert.throws(run, (error: unknown) => error instanceof ExperienceApiError && error.code === "cross-origin-rejected" && error.status === 403);
}

describe("origin guards behind a TLS-terminating front end", () => {
  it("accepts a hosted same-origin mutation that reaches the server as plain HTTP", () => {
    const req = post("http://0.0.0.0:8080/api/experiences/s1/draft", {
      host: HOSTED,
      "x-forwarded-proto": "https",
      origin: `https://${HOSTED}`,
    });
    assert.equal(publicRequestOrigin(req), `https://${HOSTED}`);
    assert.doesNotThrow(() => assertSameOriginMutation(req));
  });

  it("uses the first value of a comma-joined forwarded header and prefers X-Forwarded-Host", () => {
    const req = post("http://0.0.0.0:8080/api/experiences/s1/draft", {
      host: "internal:8080",
      "x-forwarded-host": `${HOSTED}, proxy.internal`,
      "x-forwarded-proto": "https, http",
      origin: `https://${HOSTED}`,
    });
    assert.equal(publicRequestOrigin(req), `https://${HOSTED}`);
    assert.doesNotThrow(() => assertSameOriginMutation(req));
  });

  it("still rejects a foreign origin when the forwarded scheme is https", () => {
    rejected(() =>
      assertSameOriginMutation(
        post("http://0.0.0.0:8080/api/experiences/s1/draft", {
          host: HOSTED,
          "x-forwarded-proto": "https",
          origin: "https://evil.example",
        }),
      ),
    );
  });

  it("rejects an https origin when the front end reports plain http", () => {
    rejected(() =>
      assertSameOriginMutation(
        post("http://0.0.0.0:8080/api/experiences/s1/draft", {
          host: HOSTED,
          "x-forwarded-proto": "http",
          origin: `https://${HOSTED}`,
        }),
      ),
    );
  });

  it("ignores a forwarded scheme other than http or https", () => {
    const req = post(`http://${HOSTED}/api/experiences/s1/draft`, { host: HOSTED, "x-forwarded-proto": "javascript" });
    assert.equal(publicRequestOrigin(req), `http://${HOSTED}`);
  });

  it("keeps local behavior when no forwarded headers are present", () => {
    const local = post("http://localhost:3000/api/experiences", { origin: "http://localhost:3000" });
    assert.equal(publicRequestOrigin(local), "http://localhost:3000");
    assert.doesNotThrow(() => assertSameOriginMutation(local));
    rejected(() => assertSameOriginMutation(post("http://localhost:3000/api/experiences", { origin: "https://example.invalid" })));
    // Requests without an Origin header (same-origin GET navigations, server-to-server) are not mutations to judge.
    assert.doesNotThrow(() => assertSameOriginMutation(post("http://localhost:3000/api/experiences", {})));
  });

  it("applies the same public origin to the private file read boundary", () => {
    const read = new Request("http://0.0.0.0:8080/api/experiences/s1/file", {
      headers: { host: HOSTED, "x-forwarded-proto": "https", origin: `https://${HOSTED}`, "sec-fetch-site": "same-origin" },
    });
    assert.doesNotThrow(() => assertTrustedReadBoundary(read));
    rejected(() =>
      assertTrustedReadBoundary(
        new Request("http://0.0.0.0:8080/api/experiences/s1/file", {
          headers: { host: HOSTED, "x-forwarded-proto": "https", origin: "https://evil.example" },
        }),
      ),
    );
  });
});
