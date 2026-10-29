import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  searchApprovedExperienceEvidence,
  type ApprovedExperienceSearchClient,
} from "./approvedSearch";

class MockApprovedSearchClient implements ApprovedExperienceSearchClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  error: { code?: string; message?: string } | null = null;

  async rpc(functionName: string, args: Record<string, unknown>) {
    this.calls.push({ functionName, args });
    if (this.error) {
      return { data: null, error: this.error };
    }
    return {
      data: [
        {
          id: "chunk-1",
          parent_id: "parent-1",
          child_text: "Exact citation",
          embedding_text: "Project: Exact citation",
          metadata: {
            logical_chunk_id: "logical-chunk-1",
            source_spans: [{ block_id: "block-1", start: 0, end: 14 }],
          },
          chunk_index: 0,
          similarity: 0.91,
          source_id: "source-1",
          revision_id: "revision-1",
          approved_content_hash: "approved-hash",
          logical_experience_id: "experience-1",
          logical_parent_id: "parent-logical-1",
          logical_chunk_id: "logical-chunk-1",
          parent_source_document_id: "source-1",
          parent_source_file_name: "experience.docx",
          parent_source_file_type: "docx",
          parent_text: "Project parent context",
          parent_metadata: {
            logical_parent_id: "parent-logical-1",
          },
          parent_created_at: "2026-10-29T00:00:00.000Z",
          parent_updated_at: "2026-10-29T00:00:00.000Z",
        },
      ],
      error: null,
    };
  }
}

function vector(fill = 0.5) {
  return Array.from({ length: 1536 }, () => fill);
}

describe("approved experience search", () => {
  it("searches active approved experience evidence and returns parent-expanded lineage", async () => {
    const client = new MockApprovedSearchClient();
    const results = await searchApprovedExperienceEvidence("API integration", {
      client,
      embed: async (input, taskType) => {
        assert.equal(input, "API integration");
        assert.equal(taskType, "RETRIEVAL_QUERY");
        return vector();
      },
    });

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].functionName, "match_approved_experience_chunks");
    assert.equal(client.calls[0].args.source_ids, null);
    assert.equal(client.calls[0].args.match_count, 10);
    assert.equal(results[0].source_id, "source-1");
    assert.equal(results[0].revision_id, "revision-1");
    assert.equal(results[0].logical_experience_id, "experience-1");
    assert.equal(results[0].logical_parent_id, "parent-logical-1");
    assert.equal(results[0].logical_chunk_id, "logical-chunk-1");
    assert.equal(results[0].parent.parent_text, "Project parent context");
    assert.equal(results[0].parent.source_document_id, "source-1");
  });

  it("validates selected sources before retrieval and preserves selected-source filtering", async () => {
    const client = new MockApprovedSearchClient();
    await searchApprovedExperienceEvidence("query", {
      client,
      sourceIds: ["source-1", "source-1", "source-2"],
      matchCount: 3,
      matchThreshold: 0.2,
      embed: async () => vector(),
    });

    assert.deepEqual(client.calls[0].args.source_ids, ["source-1", "source-2"]);
    assert.equal(client.calls[0].args.match_count, 3);
    assert.equal(client.calls[0].args.match_threshold, 0.2);

    await assert.rejects(
      () =>
        searchApprovedExperienceEvidence("query", {
          client,
          sourceIds: ["source-1", " "],
          embed: async () => vector(),
        }),
      /sourceIds must contain only non-empty source IDs/,
    );
  });

  it("treats an explicit empty source selection as no matches without embedding", async () => {
    const client = new MockApprovedSearchClient();
    let embedded = false;
    const results = await searchApprovedExperienceEvidence("query", {
      client,
      sourceIds: [],
      embed: async () => {
        embedded = true;
        return vector();
      },
    });

    assert.deepEqual(results, []);
    assert.equal(embedded, false);
    assert.equal(client.calls.length, 0);
  });

  it("surfaces ineligible selected-source errors without widening search", async () => {
    const client = new MockApprovedSearchClient();
    client.error = { code: "40001", message: "Selected experience source is not eligible for approved search" };

    await assert.rejects(
      () =>
        searchApprovedExperienceEvidence("query", {
          client,
          sourceIds: ["missing-source"],
          embed: async () => vector(),
        }),
      /not eligible/,
    );
    assert.deepEqual(client.calls[0].args.source_ids, ["missing-source"]);
  });

  it("rejects invalid query options and embeddings before calling the RPC", async () => {
    const client = new MockApprovedSearchClient();
    await assert.rejects(
      () => searchApprovedExperienceEvidence("", { client, embed: async () => vector() }),
      /query must be non-empty text/,
    );
    await assert.rejects(
      () => searchApprovedExperienceEvidence("query", { client, matchCount: 0, embed: async () => vector() }),
      /matchCount must be between 1 and 100/,
    );
    await assert.rejects(
      () => searchApprovedExperienceEvidence("query", { client, matchThreshold: 2, embed: async () => vector() }),
      /matchThreshold must be between -1 and 1/,
    );
    await assert.rejects(
      () => searchApprovedExperienceEvidence("query", { client, embed: async () => [1, 2, 3] }),
      /finite 1536-dimensional vector/,
    );
    assert.equal(client.calls.length, 0);
  });
});
