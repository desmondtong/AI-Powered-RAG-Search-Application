import { createHash } from "node:crypto";
import { z } from "zod";

export const STRUCTURED_EXPERIENCE_SCHEMA_VERSION = "1";

export const ExperienceTypeSchema = z.enum(["project", "general-experience"]);
export const EvidenceKindSchema = z.enum([
  "background",
  "responsibility",
  "contribution",
  "challenge",
  "decision",
  "outcome",
]);
export const AttributionSchema = z.enum(["individual", "team", "unspecified"]);
export const ActivityStatusSchema = z.enum(["completed", "ongoing", "planned", "unspecified"]);
export const RevisionStatusSchema = z.enum(["draft", "approved", "indexing", "indexed", "failed"]);
export const SourceWorkflowStatusSchema = z.enum([
  "uploaded",
  "extracting",
  "extracted",
  "parsing",
  "draft",
  "approved",
  "indexing",
  "indexed",
  "failed",
  "deleted",
  "cleanup-pending",
]);

const LogicalIdSchema = z.string().min(1);
const NonEmptyStringSchema = z.string().min(1);
const NonNegativeIntegerSchema = z.number().int().min(0);

export const SourceSpanSchema = z
  .object({
    block_id: NonEmptyStringSchema,
    start: NonNegativeIntegerSchema,
    end: NonNegativeIntegerSchema,
  })
  .superRefine((span, context) => {
    if (span.end <= span.start) {
      context.addIssue({
        code: "custom",
        message: "source span end must be greater than start",
        path: ["end"],
      });
    }
  });

export const ProposedSourceQuoteSchema = z.object({
  source_id: NonEmptyStringSchema.optional(),
  extraction_snapshot_id: NonEmptyStringSchema.optional(),
  block_id: NonEmptyStringSchema,
  quote: NonEmptyStringSchema,
});

export const SourceBlockLocatorSchema = z.object({
  kind: z.enum(["pdf-page", "docx-paragraph", "text-line", "unknown"]),
  label: NonEmptyStringSchema.optional(),
  page: z.number().int().positive().optional(),
  paragraph: z.number().int().positive().optional(),
});

export const SourceBlockSchema = z
  .object({
    block_id: NonEmptyStringSchema,
    order: NonNegativeIntegerSchema,
    text: z.string(),
    text_start: NonNegativeIntegerSchema,
    text_end: NonNegativeIntegerSchema,
    locator: SourceBlockLocatorSchema.optional(),
  })
  .superRefine((block, context) => {
    if (block.text_end - block.text_start !== block.text.length) {
      context.addIssue({
        code: "custom",
        message: "source block offsets must match UTF-16 text length",
        path: ["text_end"],
      });
    }
  });

export const ExtractionSnapshotSchema = z.object({
  source_id: NonEmptyStringSchema,
  extraction_snapshot_id: NonEmptyStringSchema,
  original_file_name: NonEmptyStringSchema,
  original_file_type: NonEmptyStringSchema,
  byte_sha256: NonEmptyStringSchema,
  text_sha256: NonEmptyStringSchema,
  parser_version: NonEmptyStringSchema,
  normalization_version: NonEmptyStringSchema,
  blocks: z.array(SourceBlockSchema).min(1),
  warnings: z.array(z.string()).default([]),
});

function hasPopulatedValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.values(value).some(hasPopulatedValue);
  }
  return true;
}

function sourceBackedField<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({
      value: valueSchema,
      source_refs: z.array(SourceSpanSchema).default([]),
    })
    .superRefine((field, context) => {
      const typedField = field as { value: unknown; source_refs: unknown[] };
      if (hasPopulatedValue(typedField.value) && typedField.source_refs.length === 0) {
        context.addIssue({
          code: "custom",
          message: "populated source-backed fields require at least one source reference",
          path: ["source_refs"],
        });
      }
    });
}

export const SourceBackedStringSchema = sourceBackedField(z.string().min(1).nullable());
export const SourceBackedStringArraySchema = sourceBackedField(z.array(NonEmptyStringSchema).default([]));

export const PeriodSchema = z.object({
  start: SourceBackedStringSchema.default({ value: null, source_refs: [] }),
  end: SourceBackedStringSchema.default({ value: null, source_refs: [] }),
  precision: z.enum(["year", "month", "quarter", "label", "unknown"]).default("unknown"),
});

export const EvidenceItemSchema = z.object({
  logical_id: LogicalIdSchema.optional(),
  kind: EvidenceKindSchema,
  summary: NonEmptyStringSchema,
  source_refs: z.array(SourceSpanSchema).min(1),
  attribution: AttributionSchema,
  activity_status: ActivityStatusSchema,
});

export const ExperienceSchema = z.object({
  logical_id: LogicalIdSchema.optional(),
  type: ExperienceTypeSchema,
  title: SourceBackedStringSchema.default({ value: null, source_refs: [] }),
  organization: SourceBackedStringSchema.default({ value: null, source_refs: [] }),
  role: SourceBackedStringSchema.default({ value: null, source_refs: [] }),
  period: PeriodSchema.default({
    start: { value: null, source_refs: [] },
    end: { value: null, source_refs: [] },
    precision: "unknown",
  }),
  technologies: SourceBackedStringArraySchema.default({ value: [], source_refs: [] }),
  context_refs: z.array(SourceSpanSchema).default([]),
  evidence_items: z.array(EvidenceItemSchema).default([]),
});

export const CanonicalExperienceRevisionSchema = z.object({
  schema_version: z.literal(STRUCTURED_EXPERIENCE_SCHEMA_VERSION),
  source: z.object({
    source_id: NonEmptyStringSchema,
    original_file_name: NonEmptyStringSchema,
    original_file_type: NonEmptyStringSchema,
    byte_sha256: NonEmptyStringSchema,
  }),
  extraction: z.object({
    extraction_snapshot_id: NonEmptyStringSchema,
    text_sha256: NonEmptyStringSchema,
    parser_version: NonEmptyStringSchema,
    normalization_version: NonEmptyStringSchema,
  }),
  revision: z.object({
    revision_id: NonEmptyStringSchema,
    status: RevisionStatusSchema,
    draft_version: z.number().int().positive(),
    approved_content_hash: NonEmptyStringSchema.nullable().default(null),
    model_version: NonEmptyStringSchema.nullable().default(null),
    prompt_version: NonEmptyStringSchema.nullable().default(null),
  }),
  experiences: z.array(ExperienceSchema).min(1).max(16),
  review_acknowledgements: z
    .object({
      warnings: z.boolean().default(false),
      unassigned_blocks: z.boolean().default(false),
    })
    .default({ warnings: false, unassigned_blocks: false }),
});

export const StructuredExperienceExportSchema = z.object({
  revision: CanonicalExperienceRevisionSchema,
  source_blocks: z.array(SourceBlockSchema).min(1),
  content_hash: NonEmptyStringSchema,
  exported_at: NonEmptyStringSchema,
  resolved_source_refs: z
    .array(
      z.object({
        logical_experience_id: NonEmptyStringSchema,
        logical_evidence_id: NonEmptyStringSchema.nullable().default(null),
        field_path: NonEmptyStringSchema,
        source_refs: z
          .array(
            z.object({
              block_id: NonEmptyStringSchema,
              start: NonNegativeIntegerSchema,
              end: NonNegativeIntegerSchema,
              text: z.string(),
              locator: SourceBlockLocatorSchema.optional(),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
  configuration_versions: z.object({
    schema: z.literal(STRUCTURED_EXPERIENCE_SCHEMA_VERSION),
    parser: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema.nullable(),
    model: NonEmptyStringSchema.nullable(),
    chunking: NonEmptyStringSchema.nullable(),
    embedding: NonEmptyStringSchema.nullable(),
  }),
});

export type ExperienceType = z.infer<typeof ExperienceTypeSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type Attribution = z.infer<typeof AttributionSchema>;
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;
export type SourceWorkflowStatus = z.infer<typeof SourceWorkflowStatusSchema>;
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
export type ProposedSourceQuote = z.infer<typeof ProposedSourceQuoteSchema>;
export type SourceBlock = z.infer<typeof SourceBlockSchema>;
export type ExtractionSnapshot = z.infer<typeof ExtractionSnapshotSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type CanonicalExperienceRevision = z.infer<typeof CanonicalExperienceRevisionSchema>;
export type StructuredExperienceExport = z.infer<typeof StructuredExperienceExportSchema>;
export type ResolvedSourceReference = StructuredExperienceExport["resolved_source_refs"][number];

export interface CoverageReport {
  totalBlocks: number;
  referencedBlocks: number;
  unreferencedBlocks: string[];
  totalUtf16Units: number;
  referencedUtf16Units: number;
  coverageRatio: number;
}

export function parseCanonicalExperienceRevision(value: unknown): CanonicalExperienceRevision {
  return CanonicalExperienceRevisionSchema.parse(value);
}

export function parseExtractionSnapshot(value: unknown): ExtractionSnapshot {
  return ExtractionSnapshotSchema.parse(value);
}

export function resolveQuoteReferences(snapshotInput: unknown, quoteInputs: unknown[]): SourceSpan[] {
  const snapshot = parseExtractionSnapshot(snapshotInput);
  const blocks = new Map(snapshot.blocks.map((block) => [block.block_id, block]));

  return quoteInputs.map((quoteInput) => {
    const reference = ProposedSourceQuoteSchema.parse(quoteInput);
    if (reference.source_id && reference.source_id !== snapshot.source_id) {
      throw new Error("Quote reference belongs to a different source.");
    }
    if (reference.extraction_snapshot_id && reference.extraction_snapshot_id !== snapshot.extraction_snapshot_id) {
      throw new Error("Quote reference belongs to a different extraction snapshot.");
    }

    const block = blocks.get(reference.block_id);
    if (!block) {
      throw new Error(`Unknown source block: ${reference.block_id}`);
    }

    const start = block.text.indexOf(reference.quote);
    if (start < 0) {
      throw new Error(`Quote was not found in source block: ${reference.block_id}`);
    }
    if (block.text.indexOf(reference.quote, start + reference.quote.length) >= 0) {
      throw new Error(`Quote is ambiguous in source block: ${reference.block_id}`);
    }

    return {
      block_id: reference.block_id,
      start,
      end: start + reference.quote.length,
    };
  });
}

export function assertSpanInSnapshot(snapshotInput: unknown, spanInput: unknown): string {
  const snapshot = parseExtractionSnapshot(snapshotInput);
  const span = SourceSpanSchema.parse(spanInput);
  const block = snapshot.blocks.find((candidate) => candidate.block_id === span.block_id);
  if (!block) {
    throw new Error(`Unknown source block: ${span.block_id}`);
  }
  if (span.end > block.text.length) {
    throw new Error(`Source span exceeds source block bounds: ${span.block_id}`);
  }
  return block.text.slice(span.start, span.end);
}

function collectExperienceSpans(experience: Experience): SourceSpan[] {
  return [
    ...experience.title.source_refs,
    ...experience.organization.source_refs,
    ...experience.role.source_refs,
    ...experience.period.start.source_refs,
    ...experience.period.end.source_refs,
    ...experience.technologies.source_refs,
    ...experience.context_refs,
    ...experience.evidence_items.flatMap((item) => item.source_refs),
  ];
}

function resolveSpansForExport(snapshot: ExtractionSnapshot, spans: SourceSpan[]) {
  const blocks = new Map(snapshot.blocks.map((block) => [block.block_id, block]));
  return spans.map((span) => {
    const block = blocks.get(span.block_id);
    if (!block) {
      throw new Error(`Unknown source block: ${span.block_id}`);
    }
    if (span.end > block.text.length) {
      throw new Error(`Source span exceeds source block bounds: ${span.block_id}`);
    }
    return {
      ...span,
      text: block.text.slice(span.start, span.end),
      locator: block.locator,
    };
  });
}

function pushResolvedReference(
  output: ResolvedSourceReference[],
  snapshot: ExtractionSnapshot,
  logicalExperienceId: string,
  logicalEvidenceId: string | null,
  fieldPath: string,
  spans: SourceSpan[],
) {
  if (spans.length === 0) {
    return;
  }
  output.push({
    logical_experience_id: logicalExperienceId,
    logical_evidence_id: logicalEvidenceId,
    field_path: fieldPath,
    source_refs: resolveSpansForExport(snapshot, spans),
  });
}

export function resolveRevisionSourceReferences(snapshotInput: unknown, revisionInput: unknown): ResolvedSourceReference[] {
  const snapshot = parseExtractionSnapshot(snapshotInput);
  const revision = parseCanonicalExperienceRevision(revisionInput);
  const output: ResolvedSourceReference[] = [];

  revision.experiences.forEach((experience, experienceIndex) => {
    const logicalExperienceId = experience.logical_id ?? `experience-${experienceIndex + 1}`;
    const experiencePath = `experiences.${experienceIndex}`;
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.title`, experience.title.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.organization`, experience.organization.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.role`, experience.role.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.period.start`, experience.period.start.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.period.end`, experience.period.end.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.technologies`, experience.technologies.source_refs);
    pushResolvedReference(output, snapshot, logicalExperienceId, null, `${experiencePath}.context_refs`, experience.context_refs);

    experience.evidence_items.forEach((item, itemIndex) => {
      pushResolvedReference(
        output,
        snapshot,
        logicalExperienceId,
        item.logical_id ?? null,
        `${experiencePath}.evidence_items.${itemIndex}.source_refs`,
        item.source_refs,
      );
    });
  });

  return output;
}

export function collectRevisionSpans(revisionInput: unknown): SourceSpan[] {
  const revision = parseCanonicalExperienceRevision(revisionInput);
  return revision.experiences.flatMap(collectExperienceSpans);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const ordered = [...ranges].sort(([leftStart], [rightStart]) => leftStart - rightStart);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ordered) {
    const previous = merged.at(-1);
    if (!previous || start > previous[1]) {
      merged.push([start, end]);
    } else {
      previous[1] = Math.max(previous[1], end);
    }
  }
  return merged;
}

export function buildCoverageReport(snapshotInput: unknown, revisionInput: unknown): CoverageReport {
  const snapshot = parseExtractionSnapshot(snapshotInput);
  const spans = collectRevisionSpans(revisionInput);
  const rangesByBlock = new Map<string, Array<[number, number]>>();

  for (const span of spans) {
    assertSpanInSnapshot(snapshot, span);
    const ranges = rangesByBlock.get(span.block_id) ?? [];
    ranges.push([span.start, span.end]);
    rangesByBlock.set(span.block_id, ranges);
  }

  const totalUtf16Units = snapshot.blocks.reduce((total, block) => total + block.text.length, 0);
  const referencedUtf16Units = [...rangesByBlock.values()]
    .flatMap(mergeRanges)
    .reduce((total, [start, end]) => total + end - start, 0);

  return {
    totalBlocks: snapshot.blocks.length,
    referencedBlocks: rangesByBlock.size,
    unreferencedBlocks: snapshot.blocks
      .filter((block) => !rangesByBlock.has(block.block_id))
      .map((block) => block.block_id),
    totalUtf16Units,
    referencedUtf16Units,
    coverageRatio: totalUtf16Units === 0 ? 0 : referencedUtf16Units / totalUtf16Units,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
  );
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalStringify(value));
}

function revisionContentEnvelope(revision: CanonicalExperienceRevision) {
  return {
    schema_version: revision.schema_version,
    source: revision.source,
    extraction: revision.extraction,
    experiences: revision.experiences,
    review_acknowledgements: revision.review_acknowledgements,
  };
}

export function hashCanonicalRevisionContent(revisionInput: unknown): string {
  return hashCanonicalJson(revisionContentEnvelope(parseCanonicalExperienceRevision(revisionInput)));
}

function safeLogicalSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "revision";
}

function padOrdinal(index: number): string {
  return String(index + 1).padStart(4, "0");
}

export function assignRevisionLogicalIds(revisionInput: unknown): CanonicalExperienceRevision {
  const revision = parseCanonicalExperienceRevision(revisionInput);
  const revisionPrefix = safeLogicalSegment(revision.revision.revision_id);

  return {
    ...revision,
    experiences: revision.experiences.map((experience, experienceIndex) => {
      const experienceId = experience.logical_id ?? `${revisionPrefix}_experience_${padOrdinal(experienceIndex)}`;
      return {
        ...experience,
        logical_id: experienceId,
        evidence_items: experience.evidence_items.map((item, itemIndex) => ({
          ...item,
          logical_id: item.logical_id ?? `${experienceId}_evidence_${padOrdinal(itemIndex)}`,
        })),
      };
    }),
  };
}

export function assertApprovedRevisionImmutable(beforeInput: unknown, afterInput: unknown): void {
  const before = parseCanonicalExperienceRevision(beforeInput);
  const after = parseCanonicalExperienceRevision(afterInput);
  const frozenStatuses: RevisionStatus[] = ["approved", "indexing", "indexed"];
  if (!frozenStatuses.includes(before.revision.status)) {
    return;
  }

  const beforeContentHash = hashCanonicalRevisionContent(before);
  const afterContentHash = hashCanonicalRevisionContent(after);
  if (beforeContentHash !== afterContentHash) {
    throw new Error("Approved revision content is immutable.");
  }
  if (before.revision.approved_content_hash !== after.revision.approved_content_hash) {
    throw new Error("Approved revision hash is immutable.");
  }
}
