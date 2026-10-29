import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { assertSpanInSnapshot, parseExtractionSnapshot } from "./contracts";
import {
  buildExperienceExtractionSnapshot,
  persistExperienceExtractionSnapshot,
  reconstructExtractionSnapshotText,
  snapshotFromExperienceExtractionRow,
  toExperienceExtractionInsertRow,
  type ExperienceExtractionInsertRow,
  type ExperienceExtractionSnapshotClient,
} from "./extractionSnapshot";

const sourceMetadata = {
  sourceId: "source-1",
  originalFileName: "experience.docx",
  originalFileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byteSha256: "source-byte-hash",
};

function sha256(text: string) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

class MockExtractionClient implements ExperienceExtractionSnapshotClient {
  readonly rows: ExperienceExtractionInsertRow[] = [];

  from(table: "experience_extractions") {
    assert.equal(table, "experience_extractions");
    return {
      insert: async (row: ExperienceExtractionInsertRow) => {
        this.rows.push(row);
        return { data: row, error: null };
      },
    };
  }
}

describe("experience extraction snapshots", () => {
  it("builds ordered mechanically normalized blocks with hashes, warnings, and available locators", () => {
    const snapshot = buildExperienceExtractionSnapshot({
      ...sourceMetadata,
      extractionSnapshotId: "snapshot-1",
      parserVersion: "parser-test-v1",
      normalizationVersion: "normalize-test-v1",
      segments: [
        {
          text: "Project Atlas\r\nshipped search.\u0000\t \n\n\nSecond paragraph.",
          locator: { kind: "docx-paragraph", paragraph: 3, label: "Paragraph 3" },
        },
        {
          text: "Flattened PDF fallback text.",
        },
      ],
      warnings: [" retained warning ", "retained warning", ""],
    });
    const reconstructedText = reconstructExtractionSnapshotText(snapshot);

    assert.equal(reconstructedText, "Project Atlas\nshipped search.\n\nSecond paragraph.\n\nFlattened PDF fallback text.");
    assert.equal(snapshot.text_sha256, sha256(reconstructedText));
    assert.deepEqual(snapshot.warnings, ["retained warning"]);
    assert.equal(snapshot.blocks.length, 3);
    assert.deepEqual(snapshot.blocks[0].locator, { kind: "docx-paragraph", paragraph: 3, label: "Paragraph 3" });
    assert.deepEqual(snapshot.blocks[1].locator, { kind: "docx-paragraph", paragraph: 3, label: "Paragraph 3" });
    assert.equal(snapshot.blocks[2].locator, undefined);
    assert.equal(snapshot.blocks[0].text_start, 0);
    assert.equal(snapshot.blocks[1].text_start, snapshot.blocks[0].text_end + 2);
    assert.equal(snapshot.blocks[2].text_start, snapshot.blocks[1].text_end + 2);
  });

  it("persists extraction rows and reloads citations without changing retained text", async () => {
    const snapshot = buildExperienceExtractionSnapshot({
      ...sourceMetadata,
      extractionSnapshotId: "snapshot-2",
      segments: [{ text: "Project Atlas shipped search evidence." }],
    });
    const client = new MockExtractionClient();
    await persistExperienceExtractionSnapshot(snapshot, client);

    assert.equal(client.rows.length, 1);
    assert.deepEqual(client.rows[0], toExperienceExtractionInsertRow(snapshot));

    const reloaded = snapshotFromExperienceExtractionRow(client.rows[0], sourceMetadata);
    const span = {
      block_id: "block-0001",
      start: snapshot.blocks[0].text.indexOf("search"),
      end: snapshot.blocks[0].text.indexOf("search") + "search".length,
    };

    assert.deepEqual(reloaded, snapshot);
    assert.equal(assertSpanInSnapshot(reloaded, span), "search");
    assert.deepEqual(parseExtractionSnapshot(JSON.parse(JSON.stringify(reloaded))), snapshot);
  });

  it("splits long source blocks within the configured bound while preserving offset invariants", () => {
    const longParagraph = Array.from({ length: 32 }, (_, index) => `word${index}`).join(" ");
    const snapshot = buildExperienceExtractionSnapshot({
      ...sourceMetadata,
      extractionSnapshotId: "snapshot-3",
      maxBlockUtf16Units: 48,
      segments: [{ text: longParagraph, locator: { kind: "text-line", label: "Line 1" } }],
    });

    assert.ok(snapshot.blocks.length > 1);
    snapshot.blocks.forEach((block, index) => {
      assert.equal(block.order, index);
      assert.equal(block.block_id, `block-${String(index + 1).padStart(4, "0")}`);
      assert.ok(block.text.length <= 48);
      assert.equal(block.text_end - block.text_start, block.text.length);
      assert.deepEqual(block.locator, { kind: "text-line", label: "Line 1" });
      if (index > 0) {
        assert.equal(block.text_start, snapshot.blocks[index - 1].text_end + 2);
      }
    });
  });

  it("does not invent file coordinates when extraction provides no reliable locator", () => {
    const snapshot = buildExperienceExtractionSnapshot({
      ...sourceMetadata,
      extractionSnapshotId: "snapshot-4",
      segments: [{ text: "Selectable PDF text flattened by fallback extraction." }],
    });

    assert.equal(snapshot.blocks.length, 1);
    assert.equal("locator" in snapshot.blocks[0], false);
  });
});
