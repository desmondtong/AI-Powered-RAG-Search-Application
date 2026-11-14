import { createHash } from "node:crypto";
import {
  STRUCTURED_EXPERIENCE_SCHEMA_VERSION,
  StructuredExperienceExportSchema,
  assignRevisionLogicalIds,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  resolveRevisionSourceReferences,
  type CanonicalExperienceRevision,
  type ExtractionSnapshot,
  type StructuredExperienceExport,
} from "../experience/contracts";
import { buildExperienceExtractionSnapshot } from "../experience/extractionSnapshot";
import { fixtureExperienceText, type RagEvalFixture } from "./fixtureSchema";
import { RAG_EVAL_FILE_PREFIX } from "./versions";

export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const OFFLINE_EXPORTED_AT = "2026-01-01T00:00:00.000Z";
export const OFFLINE_CONFIGURATION_LABEL = "offline-synthesized";

/** Deterministic UUID-shaped ID derived from a seed string. */
export function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fixtureFileName(fixture: RagEvalFixture) {
  return `${RAG_EVAL_FILE_PREFIX}${fixture.fixture_id}__${fixture.experience.file_stem}.docx`;
}

/** The snapshot the real extractor builds for the fixture DOCX: the same function, over the same joined text. */
export function synthesizeFixtureSnapshot(fixture: RagEvalFixture, sourceId: string): ExtractionSnapshot {
  const text = fixtureExperienceText(fixture);
  return buildExperienceExtractionSnapshot({
    sourceId,
    extractionSnapshotId: deterministicUuid(`${fixture.fixture_id}:extraction`),
    originalFileName: fixtureFileName(fixture),
    originalFileType: DOCX_MIME_TYPE,
    byteSha256: createHash("sha256").update(text).digest("hex"),
    segments: [{ text, locator: { kind: "unknown" } }],
  });
}

function revisionWithHash(revision: CanonicalExperienceRevision, status: "indexed" | "approved") {
  const draft = parseCanonicalExperienceRevision({ ...revision, revision: { ...revision.revision, status: "draft", approved_content_hash: null } });
  const hash = hashCanonicalRevisionContent(draft);
  return parseCanonicalExperienceRevision({ ...draft, revision: { ...draft.revision, status, approved_content_hash: hash } });
}

function exportFor(snapshot: ExtractionSnapshot, revision: CanonicalExperienceRevision): StructuredExperienceExport {
  return StructuredExperienceExportSchema.parse({
    revision,
    source_blocks: snapshot.blocks,
    content_hash: revision.revision.approved_content_hash,
    exported_at: OFFLINE_EXPORTED_AT,
    resolved_source_refs: resolveRevisionSourceReferences(snapshot, revision),
    configuration_versions: {
      schema: revision.schema_version,
      parser: snapshot.parser_version,
      prompt: revision.revision.prompt_version,
      model: revision.revision.model_version,
      chunking: null,
      embedding: null,
    },
  });
}

export interface OfflineCorpusEntry {
  fixture_id: string;
  file_name: string;
  /** Export of the active, indexed revision (R1). */
  active: StructuredExperienceExport;
  /** Export of the later approved, never-indexed revision (R2), for the active-vs-latest plan only. */
  latest_unindexed: StructuredExperienceExport | null;
}

/**
 * Offline stand-in for a seeded fixture source: one retained block per paragraph, one evidence item per block, and
 * deterministic IDs and hashes. R2, when planned, is cloned from R1 the way ingestion creates a draft from an approved revision,
 * so it shares R1's logical IDs and blocks and differs only in revision identity and the grounded edit.
 */
export function synthesizeOfflineCorpusEntry(fixture: RagEvalFixture): OfflineCorpusEntry {
  const sourceId = deterministicUuid(`${fixture.fixture_id}:source`);
  const snapshot = synthesizeFixtureSnapshot(fixture, sourceId);
  const r1Draft = assignRevisionLogicalIds({
    schema_version: STRUCTURED_EXPERIENCE_SCHEMA_VERSION,
    source: {
      source_id: sourceId,
      original_file_name: snapshot.original_file_name,
      original_file_type: snapshot.original_file_type,
      byte_sha256: snapshot.byte_sha256,
    },
    extraction: {
      extraction_snapshot_id: snapshot.extraction_snapshot_id,
      text_sha256: snapshot.text_sha256,
      parser_version: snapshot.parser_version,
      normalization_version: snapshot.normalization_version,
    },
    revision: {
      revision_id: deterministicUuid(`${fixture.fixture_id}:r1`),
      status: "draft",
      draft_version: 1,
      approved_content_hash: null,
      model_version: OFFLINE_CONFIGURATION_LABEL,
      prompt_version: OFFLINE_CONFIGURATION_LABEL,
    },
    experiences: [
      {
        type: "project",
        evidence_items: snapshot.blocks.map((block) => ({
          kind: "contribution",
          summary: block.text,
          source_refs: [{ block_id: block.block_id, start: 0, end: block.text.length }],
          attribution: "individual",
          activity_status: "completed",
        })),
      },
    ],
    review_acknowledgements: { warnings: false, unassigned_blocks: false },
  });
  const r1 = revisionWithHash(r1Draft, "indexed");

  let latestUnindexed: StructuredExperienceExport | null = null;
  if (fixture.revision_plan.kind === "active-r1-latest-r2-unindexed") {
    const suffix = fixture.revision_plan.r2_evidence_summary_suffix;
    const [first, ...rest] = r1.experiences;
    const [firstItem, ...otherItems] = first.evidence_items;
    const r2 = revisionWithHash(
      {
        ...r1,
        revision: { ...r1.revision, revision_id: deterministicUuid(`${fixture.fixture_id}:r2`), draft_version: 2 },
        experiences: [{ ...first, evidence_items: [{ ...firstItem, summary: `${firstItem.summary}${suffix}` }, ...otherItems] }, ...rest],
      },
      "approved",
    );
    latestUnindexed = exportFor(snapshot, r2);
  }

  return {
    fixture_id: fixture.fixture_id,
    file_name: snapshot.original_file_name,
    active: exportFor(snapshot, r1),
    latest_unindexed: latestUnindexed,
  };
}
