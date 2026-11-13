import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("generic search page contract", () => {
  it("keeps the Search page on the existing generic search API", () => {
    const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    const route = readFileSync(join(process.cwd(), "app/api/search/route.ts"), "utf8");

    assert.match(page, /fetch\("\/api\/search"/);
    assert.doesNotMatch(page, /\/api\/experiences/);

    // JD-fit mode lives on the same page but reaches only its own endpoint, never the experiences API.
    const jdFitPanel = readFileSync(join(process.cwd(), "app/components/JdFitPanel.tsx"), "utf8");
    assert.doesNotMatch(jdFitPanel, /\/api\/experiences/);
    assert.doesNotMatch(jdFitPanel, /\/api\/search/);
    assert.match(route, /match_documents/);
    assert.doesNotMatch(route, /approved_experience_search/);
  });
});
