import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignRevisionLogicalIds,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
  type CanonicalExperienceRevision,
  type ExtractionSnapshot,
} from "./contracts";
import {
  documentedCanonicalProjectFixture,
  documentedExtractionSnapshotFixture,
} from "./fixtures";
import {
  type ExperienceIndexStagingRow,
  prepareExperienceEmbeddingBatch,
} from "./embeddingPreparation";
import { freezeApprovedExperienceIndexPlan } from "./parentPlanning";

class MockStagingQuery {
  private filters: Array<{ key: string; value: unknown }> = [];

  constructor(private readonly client: MockStagingClient) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  async upsert(rows: ExperienceIndexStagingRow[]) {
    this.client.upsertCalls.push(rows);
    for (const row of rows) {
      const existingIndex = this.client.rows.findIndex(
        (candidate) =>
          candidate.revision_id === row.revision_id &&
          candidate.logical_chunk_key === row.logical_chunk_key,
      );
      if (existingIndex >= 0) {
        this.client.rows[existingIndex] = row;
      } else {
        this.client.rows.push(row);
      }
    }
    return { data: rows, error: null };
  }

  then(resolve: (value: { data: ExperienceIndexStagingRow[]; error: null }) => void) {
    const data = this.client.rows.filter((row) =>
      this.filters.every((filter) => (row as unknown as Record<string, unknown>)[filter.key] === filter.value),
    );
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}

class MockStagingClient {
  readonly upsertCalls: ExperienceIndexStagingRow[][] = [];

  constructor(readonly rows: ExperienceIndexStagingRow[] = []) {}

  from(table: string) {
    assert.equal(table, "experience_index_staging");
    return new MockStagingQuery(this);
  }
}

function approvedFixture(): { snapshot: ExtractionSnapshot; revision: CanonicalExperienceRevision } {
  const snapshot = parseExtractionSnapshot(documentedExtractionSnapshotFixture);
  const assigned = assignRevisionLogicalIds(parseCanonicalExperienceRevision(documentedCanonicalProjectFixture));
  const approvedContentHash = hashCanonicalRevisionContent(assigned);
  const revision = parseCanonicalExperienceRevision({
    ...assigned,
    revision: {
      ...assigned.revision,
      status: "approved",
      approved_content_hash: approvedContentHash,
    },
  });
  return { snapshot, revision };
}

function vector(fill: number) {
  return Array.from({ length: 1536 }, () => fill);
}

function compatiblePreparedRow(index: number, preparedAt = "2026-10-29T00:00:00.000Z"): ExperienceIndexStagingRow {
  const { snapshot, revision } = approvedFixture();
  const frozen = freezeApprovedExperienceIndexPlan({ snapshot, revision });
  const child = frozen.child_plan.children[index];
  const parent = frozen.parent_plan.parents.find((candidate) => candidate.logical_parent_id === child.logical_parent_id);
  assert.ok(parent);
  return {
    revision_id: frozen.revision_id,
    logical_chunk_key: child.logical_chunk_id,
    plan_hash: frozen.plan_hash,
    approved_content_hash: frozen.approved_content_hash,
    chunking_version: frozen.preparation_config.chunking_version,
    embedding_model: frozen.preparation_config.embedding_model,
    embedding_task_type: frozen.preparation_config.embedding_task_type,
    embedding_dimensions: frozen.preparation_config.embedding_dimensions,
    parent_payload: {
      source_document_id: revision.source.source_id,
      source_file_name: revision.source.original_file_name,
      source_file_type: revision.source.original_file_type,
      parent_text: parent.parent_text,
      metadata: parent.metadata,
    },
    child_payload: {
      child_text: child.child_text,
      embedding_text: child.embedding_text,
      metadata: child.metadata,
      logical_chunk_id: child.logical_chunk_id,
      chunk_index: child.child_index,
    },
    embedding: vector(0.5),
    prepared_at: preparedAt,
  };
}

describe("experience embedding preparation", () => {
  it("prepares only a bounded batch of missing embeddings and writes compatible staging rows", async () => {
    const { snapshot, revision } = approvedFixture();
    const client = new MockStagingClient();
    const embeddingInputs: string[] = [];
    const result = await prepareExperienceEmbeddingBatch({
      snapshot,
      revision,
      client,
      batchSize: 2,
      embed: async (input, taskType) => {
        assert.equal(taskType, "RETRIEVAL_DOCUMENT");
        embeddingInputs.push(input);
        return vector(0.25);
      },
      now: () => new Date("2026-10-29T01:00:00.000Z"),
    });

    assert.equal(result.total_chunks, 3);
    assert.equal(result.newly_prepared_chunks, 2);
    assert.equal(result.prepared_chunks, 2);
    assert.equal(result.remaining_chunks, 1);
    assert.equal(embeddingInputs.length, 2);
    assert.equal(client.upsertCalls.length, 1);
    assert.equal(client.upsertCalls[0].length, 2);
    for (const row of client.upsertCalls[0]) {
      assert.equal(row.plan_hash, result.plan_hash);
      assert.equal(row.approved_content_hash, result.approved_content_hash);
      assert.equal(row.embedding_task_type, "RETRIEVAL_DOCUMENT");
      assert.equal(row.embedding_dimensions, 1536);
      assert.equal((row.embedding as number[]).length, 1536);
      assert.equal(row.prepared_at, "2026-10-29T01:00:00.000Z");
    }
  });

  it("restores progress from compatible prepared checkpoints and embeds only remaining chunks", async () => {
    const { snapshot, revision } = approvedFixture();
    const existing = compatiblePreparedRow(0);
    const client = new MockStagingClient([existing]);
    const result = await prepareExperienceEmbeddingBatch({
      snapshot,
      revision,
      client,
      batchSize: 3,
      embed: async () => vector(0.75),
      now: () => new Date("2026-10-29T02:00:00.000Z"),
    });

    assert.equal(result.previously_prepared_chunks, 1);
    assert.equal(result.newly_prepared_chunks, 2);
    assert.equal(result.prepared_chunks, 3);
    assert.equal(result.remaining_chunks, 0);
    assert.ok(result.prepared_chunk_keys.includes(existing.logical_chunk_key));
    assert.equal(client.upsertCalls[0].length, 2);
    assert.equal(client.rows.length, 3);
  });

  it("does not reuse incompatible checkpoints from another plan or configuration", async () => {
    const { snapshot, revision } = approvedFixture();
    const incompatible = compatiblePreparedRow(0);
    incompatible.plan_hash = "stale-plan";
    const client = new MockStagingClient([incompatible]);

    await assert.rejects(
      () =>
        prepareExperienceEmbeddingBatch({
          snapshot,
          revision,
          client,
          embed: async () => vector(0.1),
        }),
      /incompatible with the frozen plan/,
    );
    assert.equal(client.upsertCalls.length, 0);
  });

  it("rejects invalid embedding dimensions before writing staging rows", async () => {
    const { snapshot, revision } = approvedFixture();
    const client = new MockStagingClient();

    await assert.rejects(
      () =>
        prepareExperienceEmbeddingBatch({
          snapshot,
          revision,
          client,
          batchSize: 1,
          embed: async () => [1, 2, 3],
        }),
      /invalid dimensions: 3\/1536/,
    );
    assert.equal(client.upsertCalls.length, 0);
  });
});
