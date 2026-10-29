import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExperienceDraftJson,
  persistExperienceDraft,
  recordExperienceParseFailure,
  type ExperienceDraftPersistenceClient,
  type ExperienceRevisionInsertRow,
} from "./draftPersistence";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import {
  EXPERIENCE_STRUCTURED_MAX_OUTPUT_TOKENS,
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  EXPERIENCE_STRUCTURED_SCHEMA_VERSION,
  EXPERIENCE_STRUCTURED_TIMEOUT_MS,
  buildStructuredExperienceDraft,
  type StructuredExperienceGenerationResult,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000002";
const EXECUTION_TOKEN = "00000000-0000-4000-8000-000000000003";
const ACTIVE_REVISION_ID = "00000000-0000-4000-8000-000000000099";

interface MockSourceRow {
  id: string;
  status: string;
  latest_extraction_id: string | null;
  latest_draft_revision_id: string | null;
  active_revision_id: string | null;
  failure: unknown;
}

class MockDraftPersistenceClient implements ExperienceDraftPersistenceClient {
  readonly revisions = new Map<string, ExperienceRevisionInsertRow>();
  readonly rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  readonly source: MockSourceRow = {
    id: SOURCE_ID,
    status: "indexed",
    latest_extraction_id: SNAPSHOT_ID,
    latest_draft_revision_id: null,
    active_revision_id: ACTIVE_REVISION_ID,
    failure: null,
  };

  from(table: "experience_revisions") {
    assert.equal(table, "experience_revisions");
    return {
      insert: (row: ExperienceRevisionInsertRow) => ({
        select: () => ({
          single: async () => {
            if (this.revisions.has(row.id)) {
              return { data: null, error: { message: "duplicate revision" } };
            }
            this.revisions.set(row.id, row);
            return { data: row, error: null };
          },
        }),
      }),
    };
  }

  async rpc(functionName: "complete_experience_source_execution", args: Record<string, unknown>) {
    this.rpcCalls.push({ functionName, args });
    if (functionName !== "complete_experience_source_execution") {
      return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
    }
    if (args.p_source_id !== this.source.id || args.p_execution_token !== EXECUTION_TOKEN || args.p_stage !== "parsing") {
      return { data: null, error: { message: "stale execution token" } };
    }

    this.source.status = String(args.p_next_status);
    if (args.p_latest_extraction_id) {
      this.source.latest_extraction_id = String(args.p_latest_extraction_id);
    }
    if (args.p_latest_draft_revision_id) {
      this.source.latest_draft_revision_id = String(args.p_latest_draft_revision_id);
    }
    this.source.failure = args.p_failure ?? null;
    return { data: this.source, error: null };
  }
}

function snapshotFixture() {
  return buildExperienceExtractionSnapshot({
    sourceId: SOURCE_ID,
    extractionSnapshotId: SNAPSHOT_ID,
    originalFileName: "experience.docx",
    originalFileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSha256: "byte-hash",
    warnings: ["Synthetic warning for reviewer acknowledgement."],
    segments: [
      { text: "Project Atlas shipped. I led API integration." },
      { text: "Unassigned contact details should remain visible but omitted." },
    ],
  });
}

function proposalFixture(): StructuredExperienceModelProposal {
  return {
    schema_version: "1",
    warnings: [],
    experiences: [
      {
        type: "project",
        title: { value: "Project Atlas", source_refs: [{ block_id: "block-0001", quote: "Project Atlas" }] },
        organization: { value: null, source_refs: [] },
        role: { value: null, source_refs: [] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: [], source_refs: [] },
        context_refs: [{ block_id: "block-0001", quote: "Project Atlas shipped." }],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Led API integration.",
            source_refs: [{ block_id: "block-0001", quote: "I led API integration" }],
            attribution: "individual",
            activity_status: "completed",
          },
        ],
      },
    ],
  };
}

function generationResult(proposal = proposalFixture()): StructuredExperienceGenerationResult {
  return {
    json: proposal,
    rawText: JSON.stringify(proposal),
    provenance: {
      model: "gemini-structured-test",
      promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
      schemaVersion: EXPERIENCE_STRUCTURED_SCHEMA_VERSION,
      responseMimeType: "application/json",
      maxOutputTokens: EXPERIENCE_STRUCTURED_MAX_OUTPUT_TOKENS,
      timeoutMs: EXPERIENCE_STRUCTURED_TIMEOUT_MS,
      finishReason: "STOP",
    },
  };
}

function draftFixture(revisionId: string) {
  return buildStructuredExperienceDraft({
    snapshot: snapshotFixture(),
    proposal: proposalFixture(),
    revisionId,
    modelVersion: "gemini-structured-test",
    promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  });
}

describe("experience draft persistence", () => {
  it("persists draft JSON, parsing checkpoints, provenance, warnings, and omitted-block coverage", async () => {
    const snapshot = snapshotFixture();
    const draft = draftFixture("00000000-0000-4000-8000-000000000010");
    const client = new MockDraftPersistenceClient();
    const payload = await persistExperienceDraft(
      {
        sourceId: SOURCE_ID,
        executionToken: EXECUTION_TOKEN,
        snapshot,
        draft,
        generation: generationResult(),
        repairAttempted: true,
      },
      client,
    );

    const row = client.revisions.get(draft.revision.revision_id);
    assert.ok(row);
    assert.equal(row.model_version, "gemini-structured-test");
    assert.equal(row.prompt_version, EXPERIENCE_STRUCTURED_PROMPT_VERSION);
    assert.equal(row.draft_version, 1);
    assert.equal(payload.canonical_revision.revision.revision_id, draft.revision.revision_id);
    assert.deepEqual(payload.source_warnings, ["Synthetic warning for reviewer acknowledgement."]);
    assert.equal(payload.omitted_block_coverage.totalBlocks, 2);
    assert.deepEqual(payload.omitted_block_coverage.unreferencedBlocks, ["block-0002"]);
    assert.deepEqual(
      payload.parsing_checkpoints.map((checkpoint) => checkpoint.stage),
      ["structured-generation", "repair", "canonical-validation"],
    );
    assert.equal(client.source.status, "draft");
    assert.equal(client.source.latest_draft_revision_id, draft.revision.revision_id);
    assert.equal(client.source.active_revision_id, ACTIVE_REVISION_ID);
  });

  it("creates a distinct draft row for each explicit reparse", async () => {
    const snapshot = snapshotFixture();
    const client = new MockDraftPersistenceClient();
    const firstDraft = draftFixture("00000000-0000-4000-8000-000000000011");
    const secondDraft = draftFixture("00000000-0000-4000-8000-000000000012");

    await persistExperienceDraft(
      {
        sourceId: SOURCE_ID,
        executionToken: EXECUTION_TOKEN,
        snapshot,
        draft: firstDraft,
        generation: generationResult(),
        repairAttempted: false,
      },
      client,
    );
    await persistExperienceDraft(
      {
        sourceId: SOURCE_ID,
        executionToken: EXECUTION_TOKEN,
        snapshot,
        draft: secondDraft,
        generation: generationResult(),
        repairAttempted: false,
      },
      client,
    );

    assert.equal(client.revisions.size, 2);
    assert.ok(client.revisions.has(firstDraft.revision.revision_id));
    assert.ok(client.revisions.has(secondDraft.revision.revision_id));
    assert.equal(client.source.latest_draft_revision_id, secondDraft.revision.revision_id);
    assert.notEqual(firstDraft.revision.revision_id, secondDraft.revision.revision_id);
  });

  it("records parse failure without replacing the prior active revision or creating draft evidence", async () => {
    const client = new MockDraftPersistenceClient();
    client.source.latest_draft_revision_id = "00000000-0000-4000-8000-000000000088";

    await recordExperienceParseFailure(
      {
        sourceId: SOURCE_ID,
        executionToken: EXECUTION_TOKEN,
        code: "invalid-structured-response",
        message: "Structured extraction repair did not produce a valid draft.",
        modelVersion: "gemini-structured-test",
        promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
      },
      client,
    );

    assert.equal(client.revisions.size, 0);
    assert.equal(client.source.status, "failed");
    assert.equal(client.source.latest_draft_revision_id, "00000000-0000-4000-8000-000000000088");
    assert.equal(client.source.active_revision_id, ACTIVE_REVISION_ID);
    assert.deepEqual(client.source.failure, {
      stage: "parsing",
      code: "invalid-structured-response",
      message: "Structured extraction repair did not produce a valid draft.",
      recoverable_action: "retry-parse",
      model_version: "gemini-structured-test",
      prompt_version: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
    });
  });

  it("builds deterministic draft payloads before persistence", () => {
    const snapshot = snapshotFixture();
    const draft = draftFixture("00000000-0000-4000-8000-000000000013");
    const payload = buildExperienceDraftJson({
      sourceId: SOURCE_ID,
      executionToken: EXECUTION_TOKEN,
      snapshot,
      draft,
      generation: generationResult(),
      repairAttempted: false,
    });

    assert.equal(payload.canonical_revision.revision.revision_id, draft.revision.revision_id);
    assert.deepEqual(
      payload.parsing_checkpoints.map((checkpoint) => checkpoint.stage),
      ["structured-generation", "canonical-validation"],
    );
  });
});
