import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readReviewClient() {
  return readFileSync(join(process.cwd(), "app/experiences/[id]/ExperienceReviewClient.tsx"), "utf8");
}

describe("experience review UI contracts", () => {
  it("loads source-linked drafts and saves review edits through the draft endpoint", () => {
    const client = readReviewClient();

    assert.match(client, /fetch\(`\/api\/experiences\/\$\{sourceId\}`\)/);
    assert.match(client, /fetch\(`\/api\/experiences\/\$\{sourceId\}\/draft`/);
    assert.match(client, /expected_draft_version: draft\.revision\.draft_version/);
    assert.match(client, /canonical_revision/);
    assert.match(client, /loadDetail\(\)/);
  });

  it("exposes supported field edits, evidence controls, source spans, removals, and acknowledgements", () => {
    const client = readReviewClient();

    for (const token of [
      "title",
      "organization",
      "role",
      "technologies",
      "EVIDENCE_KINDS",
      "ATTRIBUTIONS",
      "ACTIVITY_STATUSES",
      "addEvidenceSpan",
      "removeEvidence",
      "removeEvidenceSpan",
      "review_acknowledgements.warnings",
      "review_acknowledgements.unassigned_blocks",
      "field_errors",
      "no-usable-evidence",
    ]) {
      assert.match(client, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("exposes approval, indexing progress, edit-from-approved, and cleanup retry lifecycle controls", () => {
    const client = readReviewClient();

    for (const token of [
      "/approve",
      "/index",
      "/draft-from-approved",
      "method: \"DELETE\"",
      "indexProgress",
      "Embedding preparation",
      "Ready to index",
      "active_revision_id",
      "retry-index",
      "retry-delete",
      "cleanup_error",
      "Edit Approved",
    ]) {
      assert.match(client, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("exposes accepted JSON inspection and private original download controls", () => {
    const client = readReviewClient();

    for (const token of [
      "/file",
      "/revisions/${exportRevisionId}/export",
      "Download Original",
      "Inspect Accepted JSON",
      "Accepted JSON",
      "Resolved Source References",
      "acceptedExport",
      "min-w-0",
    ]) {
      assert.match(client, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
