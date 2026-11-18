import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOW_IT_WORKS, STAGE_NAMES } from "./copy";
import { HELP_SECTIONS, type HelpBlock } from "./help";

function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
}

function allText(blocks: readonly HelpBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === "paragraph"
        ? block.text
        : block.kind === "steps"
          ? block.items.join(" ")
          : block.items.map((item) => `${item.term} ${item.description}`).join(" "),
    )
    .join(" ");
}

const section = (id: string) => {
  const found = HELP_SECTIONS.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
};

describe("Help content", () => {
  it("has the three feature sections in page order with stable anchors", () => {
    assert.deepEqual(
      HELP_SECTIONS.map(({ id, title }) => [id, title]),
      [
        ["fit-check", "Fit Check"],
        ["experience", "Experience"],
        ["settings", "Settings"],
      ],
    );
  });

  it("lists the six stages in pipeline order with one sentence each, from the shared copy", () => {
    const stages = section("experience").blocks.find((block) => block.kind === "terms");
    assert.ok(stages && stages.kind === "terms");
    assert.deepEqual(stages.items.map((item) => item.term), [...STAGE_NAMES]);
    for (const [index, item] of stages.items.entries()) {
      assert.equal(item.description, HOW_IT_WORKS[index].description);
      assert.equal(sentenceCount(item.description), 1, item.term);
    }
  });

  it("covers the four fit groups, filtering and opening a citation", () => {
    const text = allText(section("fit-check").blocks);
    for (const phrase of ["Strong", "Partial", "Weak", "Missing", "Evaluate fit", "count tile", "Open in source"]) {
      assert.ok(text.includes(phrase), phrase);
    }
  });

  it("explains the three appearance options, where they live and that they are saved per browser", () => {
    const text = allText(section("settings").blocks);
    for (const phrase of ["Auto", "Light", "Dark", "account menu", "this browser"]) assert.ok(text.includes(phrase), phrase);
    assert.match(text, /device's light or dark setting/);
  });

  it("never mentions signing out, which the application does not offer", () => {
    for (const { blocks } of HELP_SECTIONS) assert.doesNotMatch(allText(blocks), /sign(ing)? ?out|log ?out/i);
  });
});
