import {
  EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
} from "../gemini";
import {
  hashCanonicalRevisionContent,
  hashCanonicalJson,
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
  type CanonicalExperienceRevision,
  type EvidenceItem,
  type Experience,
  type ExtractionSnapshot,
  type SourceBlock,
  type SourceSpan,
} from "./contracts";

export const EXPERIENCE_PARENT_PLANNING_VERSION = "experience-parent-planning-v1";
export const EXPERIENCE_PARENT_MAX_UTF16_UNITS = readPositiveInt("EXPERIENCE_PARENT_MAX_UTF16_UNITS", 12_000);
export const EXPERIENCE_CHILD_PLANNING_VERSION = "experience-child-planning-v1";
export const EXPERIENCE_CHILD_TARGET_UTF16_UNITS = readPositiveInt("EXPERIENCE_CHILD_TARGET_UTF16_UNITS", 1_200);
export const EXPERIENCE_CHILD_MAX_UTF16_UNITS = readPositiveInt("EXPERIENCE_CHILD_MAX_UTF16_UNITS", 1_600);
export const EXPERIENCE_EMBEDDING_CONTEXT_VERSION = "experience-embedding-context-v1";
export const EXPERIENCE_EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT";
export const EXPERIENCE_INDEX_PLAN_VERSION = "experience-index-plan-v1";
export const EXPERIENCE_MAX_CHILD_CHUNKS_PER_REVISION = readPositiveInt("EXPERIENCE_MAX_CHILD_CHUNKS_PER_REVISION", 300);

export interface ExperienceEmbeddingConfiguration {
  context_version: typeof EXPERIENCE_EMBEDDING_CONTEXT_VERSION;
  model: string;
  task_type: typeof EXPERIENCE_EMBEDDING_TASK_TYPE;
  dimensions: typeof EMBEDDING_DIMENSIONS;
}

export interface PlannedParentSourceSpan extends SourceSpan {
  text: string;
  parent_start: number;
  parent_end: number;
  evidence_logical_ids: string[];
}

export interface ExperienceParentPlanEntry {
  logical_parent_id: string;
  logical_experience_id: string;
  parent_index: number;
  parent_text: string;
  source_spans: PlannedParentSourceSpan[];
  evidence_logical_ids: string[];
  metadata: {
    schema_version: "1";
    planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
    source_id: string;
    revision_id: string;
    revision_content_hash: string;
    extraction_snapshot_id: string;
    logical_experience_id: string;
    logical_parent_id: string;
    parent_index: number;
    source_spans: PlannedParentSourceSpan[];
    evidence_logical_ids: string[];
  };
}

export interface ExperienceParentPlan {
  source_id: string;
  revision_id: string;
  revision_content_hash: string;
  extraction_snapshot_id: string;
  planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
  max_parent_utf16_units: number;
  parents: ExperienceParentPlanEntry[];
}

export interface ExperienceChildPlanEntry {
  logical_chunk_id: string;
  logical_parent_id: string;
  logical_experience_id: string;
  child_index: number;
  child_text: string;
  embedding_text: string;
  source_span: SourceSpan & { text: string };
  evidence_logical_ids: string[];
  embedding_config: ExperienceEmbeddingConfiguration;
  metadata: {
    schema_version: "1";
    planning_version: typeof EXPERIENCE_CHILD_PLANNING_VERSION;
    parent_planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
    embedding_context_version: typeof EXPERIENCE_EMBEDDING_CONTEXT_VERSION;
    source_id: string;
    revision_id: string;
    revision_content_hash: string;
    extraction_snapshot_id: string;
    logical_experience_id: string;
    logical_parent_id: string;
    logical_chunk_id: string;
    child_index: number;
    source_span: SourceSpan & { text: string };
    evidence_logical_ids: string[];
    evidence_kinds: EvidenceItem["kind"][];
    evidence_attributions: EvidenceItem["attribution"][];
    evidence_activity_statuses: EvidenceItem["activity_status"][];
    contextual_headers: string[];
    embedding_config: ExperienceEmbeddingConfiguration;
    chunking_config: {
      parent_planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
      child_planning_version: typeof EXPERIENCE_CHILD_PLANNING_VERSION;
      child_target_utf16_units: number;
      child_max_utf16_units: number;
    };
  };
}

export interface ExperienceChildPlan {
  source_id: string;
  revision_id: string;
  revision_content_hash: string;
  extraction_snapshot_id: string;
  planning_version: typeof EXPERIENCE_CHILD_PLANNING_VERSION;
  parent_planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
  child_target_utf16_units: number;
  child_max_utf16_units: number;
  embedding_config: ExperienceEmbeddingConfiguration;
  children: ExperienceChildPlanEntry[];
}

export interface ExperienceIndexPreparationConfiguration {
  plan_version: typeof EXPERIENCE_INDEX_PLAN_VERSION;
  parent_planning_version: typeof EXPERIENCE_PARENT_PLANNING_VERSION;
  child_planning_version: typeof EXPERIENCE_CHILD_PLANNING_VERSION;
  embedding_context_version: typeof EXPERIENCE_EMBEDDING_CONTEXT_VERSION;
  chunking_version: string;
  max_parent_utf16_units: number;
  child_target_utf16_units: number;
  child_max_utf16_units: number;
  max_child_chunks_per_revision: number;
  embedding_model: string;
  embedding_task_type: typeof EXPERIENCE_EMBEDDING_TASK_TYPE;
  embedding_dimensions: typeof EMBEDDING_DIMENSIONS;
}

export interface FrozenExperienceIndexPlan {
  source_id: string;
  revision_id: string;
  extraction_snapshot_id: string;
  approved_content_hash: string;
  plan_version: typeof EXPERIENCE_INDEX_PLAN_VERSION;
  plan_hash: string;
  expected_parent_count: number;
  expected_child_count: number;
  expected_evidence_count: number;
  preparation_config: ExperienceIndexPreparationConfiguration;
  parent_plan: ExperienceParentPlan;
  child_plan: ExperienceChildPlan;
}

interface BuildParentPlanInput {
  snapshot: unknown;
  revision: unknown;
  maxParentUtf16Units?: number;
}

interface BuildChildPlanInput {
  snapshot: unknown;
  revision: unknown;
  parentPlan: ExperienceParentPlan;
  childTargetUtf16Units?: number;
  childMaxUtf16Units?: number;
}

interface FreezeApprovedIndexPlanInput {
  snapshot: unknown;
  revision: unknown;
  parentPlan?: ExperienceParentPlan;
  childPlan?: ExperienceChildPlan;
  maxParentUtf16Units?: number;
  childTargetUtf16Units?: number;
  childMaxUtf16Units?: number;
  maxChildChunksPerRevision?: number;
}

interface RawSourceRange {
  block: SourceBlock;
  start: number;
  end: number;
  evidenceIds: Set<string>;
}

function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function padOrdinal(index: number) {
  return String(index + 1).padStart(4, "0");
}

function requireLogicalId(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} requires persisted logical IDs before parent planning.`);
  }
  return value;
}

function snapshotBlockMap(snapshot: ExtractionSnapshot) {
  return new Map(snapshot.blocks.map((block) => [block.block_id, block]));
}

function assertRevisionMatchesSnapshot(snapshot: ExtractionSnapshot, revision: CanonicalExperienceRevision) {
  if (snapshot.source_id !== revision.source.source_id) {
    throw new Error("Revision source does not match extraction snapshot.");
  }
  if (snapshot.extraction_snapshot_id !== revision.extraction.extraction_snapshot_id) {
    throw new Error("Revision extraction snapshot does not match retained source.");
  }
  if (snapshot.text_sha256 !== revision.extraction.text_sha256) {
    throw new Error("Revision text hash does not match retained source.");
  }
}

function validateSpan(blocks: Map<string, SourceBlock>, span: SourceSpan) {
  const block = blocks.get(span.block_id);
  if (!block) {
    throw new Error(`Unknown source block: ${span.block_id}`);
  }
  if (span.end <= span.start || span.end > block.text.length) {
    throw new Error(`Source span is outside retained block bounds: ${span.block_id}`);
  }
  return block;
}

function addRange(output: RawSourceRange[], blocks: Map<string, SourceBlock>, span: SourceSpan, evidenceId?: string) {
  const block = validateSpan(blocks, span);
  output.push({
    block,
    start: span.start,
    end: span.end,
    evidenceIds: new Set(evidenceId ? [evidenceId] : []),
  });
}

function compareRanges(left: RawSourceRange, right: RawSourceRange) {
  return left.block.order - right.block.order || left.start - right.start || left.end - right.end;
}

function mergeOverlappingRanges(ranges: RawSourceRange[]): RawSourceRange[] {
  const merged: RawSourceRange[] = [];
  for (const range of [...ranges].sort(compareRanges)) {
    const previous = merged.at(-1);
    if (!previous || previous.block.block_id !== range.block.block_id || range.start > previous.end) {
      merged.push({
        block: range.block,
        start: range.start,
        end: range.end,
        evidenceIds: new Set(range.evidenceIds),
      });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
    for (const evidenceId of range.evidenceIds) {
      previous.evidenceIds.add(evidenceId);
    }
  }
  return merged;
}

function splitRangeToBound(range: RawSourceRange, maxUtf16Units: number): RawSourceRange[] {
  const parts: RawSourceRange[] = [];
  let start = range.start;
  while (start < range.end) {
    let end = Math.min(range.end, start + maxUtf16Units);
    if (end < range.end) {
      const slice = range.block.text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(" "));
      if (lastBreak > Math.floor(maxUtf16Units / 2)) {
        end = start + lastBreak + 1;
      }
    }
    parts.push({
      block: range.block,
      start,
      end,
      evidenceIds: new Set(range.evidenceIds),
    });
    start = end;
  }
  return parts;
}

function chooseSplitEnd(text: string, absoluteStart: number, absoluteEnd: number, targetUnits: number, maxUnits: number) {
  const hardEnd = Math.min(absoluteEnd, absoluteStart + maxUnits);
  if (hardEnd >= absoluteEnd) {
    return absoluteEnd;
  }

  const targetEnd = Math.min(hardEnd, absoluteStart + targetUnits);
  const slice = text.slice(absoluteStart, targetEnd);
  const breakpoints = ["\n\n", "\n", ". ", "; ", ", ", " "];
  let bestBreak = -1;
  let bestBreakLength = 0;
  for (const breakpoint of breakpoints) {
    const candidate = slice.lastIndexOf(breakpoint);
    if (candidate > bestBreak) {
      bestBreak = candidate;
      bestBreakLength = breakpoint.length;
    }
  }
  if (bestBreak > Math.floor(targetUnits / 2)) {
    return absoluteStart + bestBreak + bestBreakLength;
  }
  return hardEnd;
}

function splitSourceSpan(block: SourceBlock, span: SourceSpan, targetUnits: number, maxUnits: number): SourceSpan[] {
  const parts: SourceSpan[] = [];
  let start = span.start;
  while (start < span.end) {
    const end = chooseSplitEnd(block.text, start, span.end, targetUnits, maxUnits);
    parts.push({
      block_id: span.block_id,
      start,
      end,
    });
    start = end;
  }
  return parts;
}

function parentTextLengthWith(range: RawSourceRange, currentLength: number) {
  const separatorLength = currentLength > 0 ? 2 : 0;
  return currentLength + separatorLength + range.end - range.start;
}

function buildParent(
  sourceId: string,
  revision: CanonicalExperienceRevision,
  revisionHash: string,
  snapshot: ExtractionSnapshot,
  logicalExperienceId: string,
  parentIndex: number,
  ranges: RawSourceRange[],
): ExperienceParentPlanEntry {
  let parentText = "";
  const spans: PlannedParentSourceSpan[] = [];
  const evidenceIds = new Set<string>();

  for (const range of ranges) {
    if (parentText.length > 0) {
      parentText += "\n\n";
    }
    const text = range.block.text.slice(range.start, range.end);
    const parentStart = parentText.length;
    parentText += text;
    const parentEnd = parentText.length;
    const rangeEvidenceIds = [...range.evidenceIds].sort();
    for (const evidenceId of rangeEvidenceIds) {
      evidenceIds.add(evidenceId);
    }
    spans.push({
      block_id: range.block.block_id,
      start: range.start,
      end: range.end,
      text,
      parent_start: parentStart,
      parent_end: parentEnd,
      evidence_logical_ids: rangeEvidenceIds,
    });
  }

  const logicalParentId = `${logicalExperienceId}_parent_${padOrdinal(parentIndex)}`;
  const evidence_logical_ids = [...evidenceIds].sort();
  const metadata: ExperienceParentPlanEntry["metadata"] = {
    schema_version: revision.schema_version,
    planning_version: EXPERIENCE_PARENT_PLANNING_VERSION,
    source_id: sourceId,
    revision_id: revision.revision.revision_id,
    revision_content_hash: revisionHash,
    extraction_snapshot_id: snapshot.extraction_snapshot_id,
    logical_experience_id: logicalExperienceId,
    logical_parent_id: logicalParentId,
    parent_index: parentIndex,
    source_spans: spans,
    evidence_logical_ids,
  };

  return {
    logical_parent_id: logicalParentId,
    logical_experience_id: logicalExperienceId,
    parent_index: parentIndex,
    parent_text: parentText,
    source_spans: spans,
    evidence_logical_ids,
    metadata,
  };
}

export function buildExperienceParentPlan(input: BuildParentPlanInput): ExperienceParentPlan {
  const snapshot = parseExtractionSnapshot(input.snapshot);
  const revision = parseCanonicalExperienceRevision(input.revision);
  const maxParentUtf16Units = input.maxParentUtf16Units ?? EXPERIENCE_PARENT_MAX_UTF16_UNITS;
  if (!Number.isInteger(maxParentUtf16Units) || maxParentUtf16Units < 1) {
    throw new Error("maxParentUtf16Units must be a positive integer.");
  }

  assertRevisionMatchesSnapshot(snapshot, revision);
  const blocks = snapshotBlockMap(snapshot);
  const revisionHash = hashCanonicalRevisionContent(revision);
  const parents: ExperienceParentPlanEntry[] = [];

  revision.experiences.forEach((experience) => {
    const logicalExperienceId = requireLogicalId(experience.logical_id, "Experience parent planning");
    const ranges: RawSourceRange[] = [];
    for (const span of experience.context_refs) {
      addRange(ranges, blocks, span);
    }
    for (const item of experience.evidence_items) {
      const evidenceId = requireLogicalId(item.logical_id, "Evidence parent planning");
      for (const span of item.source_refs) {
        addRange(ranges, blocks, span, evidenceId);
      }
    }

    const boundedRanges = mergeOverlappingRanges(ranges).flatMap((range) =>
      splitRangeToBound(range, maxParentUtf16Units),
    );
    let currentRanges: RawSourceRange[] = [];
    let currentLength = 0;
    let parentIndex = 0;

    const flush = () => {
      if (currentRanges.length === 0) {
        return;
      }
      parents.push(
        buildParent(sourceIdForRevision(revision), revision, revisionHash, snapshot, logicalExperienceId, parentIndex, currentRanges),
      );
      parentIndex += 1;
      currentRanges = [];
      currentLength = 0;
    };

    for (const range of boundedRanges) {
      const nextLength = parentTextLengthWith(range, currentLength);
      if (currentRanges.length > 0 && nextLength > maxParentUtf16Units) {
        flush();
      }
      currentRanges.push(range);
      currentLength = parentTextLengthWith(range, currentLength);
    }
    flush();

    const representedEvidenceIds = new Set(
      parents
        .filter((parent) => parent.logical_experience_id === logicalExperienceId)
        .flatMap((parent) => parent.evidence_logical_ids),
    );
    for (const item of experience.evidence_items) {
      const evidenceId = requireLogicalId(item.logical_id, "Evidence parent planning");
      if (!representedEvidenceIds.has(evidenceId)) {
        throw new Error(`Evidence item is not represented by any parent context: ${evidenceId}`);
      }
    }
  });

  return {
    source_id: revision.source.source_id,
    revision_id: revision.revision.revision_id,
    revision_content_hash: revisionHash,
    extraction_snapshot_id: snapshot.extraction_snapshot_id,
    planning_version: EXPERIENCE_PARENT_PLANNING_VERSION,
    max_parent_utf16_units: maxParentUtf16Units,
    parents,
  };
}

function sourceIdForRevision(revision: CanonicalExperienceRevision) {
  return revision.source.source_id;
}

function findParentForSpan(parentPlan: ExperienceParentPlan, logicalExperienceId: string, span: SourceSpan) {
  return parentPlan.parents.find(
    (parent) =>
      parent.logical_experience_id === logicalExperienceId &&
      parent.source_spans.some(
        (parentSpan) =>
          parentSpan.block_id === span.block_id &&
          span.start >= parentSpan.start &&
          span.end <= parentSpan.end,
      ),
  );
}

function compactHeaderValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sourceBackedStringValue(field: Experience["title"]) {
  const value = field.value ? compactHeaderValue(field.value) : "";
  return value && field.source_refs.length > 0 ? value : null;
}

function sourceBackedStringArrayValue(field: Experience["technologies"]) {
  if (field.source_refs.length === 0) {
    return [];
  }
  return field.value.map(compactHeaderValue).filter(Boolean);
}

function uniqueInOrder<T>(values: T[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function buildEmbeddingConfiguration(): ExperienceEmbeddingConfiguration {
  return {
    context_version: EXPERIENCE_EMBEDDING_CONTEXT_VERSION,
    model: GEMINI_EMBEDDING_MODEL,
    task_type: EXPERIENCE_EMBEDDING_TASK_TYPE,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

function chunkingVersion() {
  return `${EXPERIENCE_PARENT_PLANNING_VERSION}+${EXPERIENCE_CHILD_PLANNING_VERSION}+${EXPERIENCE_EMBEDDING_CONTEXT_VERSION}`;
}

function buildContextualHeaders(experience: Experience, evidenceItems: EvidenceItem[]) {
  const headers: string[] = [];
  const title = sourceBackedStringValue(experience.title);
  if (title) {
    headers.push(`${experience.type === "project" ? "Project" : "Experience"}: ${title}`);
  }

  const role = sourceBackedStringValue(experience.role);
  if (role) {
    headers.push(`Role: ${role}`);
  }

  const technologies = sourceBackedStringArrayValue(experience.technologies);
  if (technologies.length > 0) {
    headers.push(`Technologies mentioned: ${technologies.join(", ")}`);
  }

  const evidenceKinds = uniqueInOrder(evidenceItems.map((item) => item.kind));
  if (evidenceKinds.length === 1) {
    headers.push(`Evidence kind: ${evidenceKinds[0]}`);
  } else if (evidenceKinds.length > 1) {
    headers.push(`Evidence kinds: ${evidenceKinds.join(", ")}`);
  }
  return headers;
}

function buildEmbeddingText(headers: string[], childText: string) {
  return headers.length > 0 ? `${headers.join("\n")}\n\n${childText}` : childText;
}

function buildChildEntry(
  revision: CanonicalExperienceRevision,
  revisionHash: string,
  snapshot: ExtractionSnapshot,
  parentPlan: ExperienceParentPlan,
  parent: ExperienceParentPlanEntry,
  childIndex: number,
  span: SourceSpan,
  text: string,
  evidenceIds: string[],
  experience: Experience,
  evidenceItems: EvidenceItem[],
  embeddingConfig: ExperienceEmbeddingConfiguration,
  childTargetUtf16Units: number,
  childMaxUtf16Units: number,
): ExperienceChildPlanEntry {
  const logicalChunkId = `${parent.logical_parent_id}_chunk_${padOrdinal(childIndex)}`;
  const source_span = {
    ...span,
    text,
  };
  const contextualHeaders = buildContextualHeaders(experience, evidenceItems);
  const evidenceKinds = uniqueInOrder(evidenceItems.map((item) => item.kind));
  const evidenceAttributions = uniqueInOrder(evidenceItems.map((item) => item.attribution));
  const evidenceActivityStatuses = uniqueInOrder(evidenceItems.map((item) => item.activity_status));
  const embeddingText = buildEmbeddingText(contextualHeaders, text);
  const metadata: ExperienceChildPlanEntry["metadata"] = {
    schema_version: revision.schema_version,
    planning_version: EXPERIENCE_CHILD_PLANNING_VERSION,
    parent_planning_version: parentPlan.planning_version,
    embedding_context_version: EXPERIENCE_EMBEDDING_CONTEXT_VERSION,
    source_id: revision.source.source_id,
    revision_id: revision.revision.revision_id,
    revision_content_hash: revisionHash,
    extraction_snapshot_id: snapshot.extraction_snapshot_id,
    logical_experience_id: parent.logical_experience_id,
    logical_parent_id: parent.logical_parent_id,
    logical_chunk_id: logicalChunkId,
    child_index: childIndex,
    source_span,
    evidence_logical_ids: evidenceIds,
    evidence_kinds: evidenceKinds,
    evidence_attributions: evidenceAttributions,
    evidence_activity_statuses: evidenceActivityStatuses,
    contextual_headers: contextualHeaders,
    embedding_config: embeddingConfig,
    chunking_config: {
      parent_planning_version: parentPlan.planning_version,
      child_planning_version: EXPERIENCE_CHILD_PLANNING_VERSION,
      child_target_utf16_units: childTargetUtf16Units,
      child_max_utf16_units: childMaxUtf16Units,
    },
  };
  return {
    logical_chunk_id: logicalChunkId,
    logical_parent_id: parent.logical_parent_id,
    logical_experience_id: parent.logical_experience_id,
    child_index: childIndex,
    child_text: text,
    embedding_text: embeddingText,
    source_span,
    evidence_logical_ids: evidenceIds,
    embedding_config: embeddingConfig,
    metadata,
  };
}

export function buildExperienceChildPlan(input: BuildChildPlanInput): ExperienceChildPlan {
  const snapshot = parseExtractionSnapshot(input.snapshot);
  const revision = parseCanonicalExperienceRevision(input.revision);
  assertRevisionMatchesSnapshot(snapshot, revision);
  if (
    input.parentPlan.source_id !== revision.source.source_id ||
    input.parentPlan.revision_id !== revision.revision.revision_id ||
    input.parentPlan.extraction_snapshot_id !== snapshot.extraction_snapshot_id
  ) {
    throw new Error("Parent plan does not belong to the supplied revision and snapshot.");
  }

  const targetUnits = input.childTargetUtf16Units ?? EXPERIENCE_CHILD_TARGET_UTF16_UNITS;
  const maxUnits = input.childMaxUtf16Units ?? EXPERIENCE_CHILD_MAX_UTF16_UNITS;
  if (!Number.isInteger(targetUnits) || targetUnits < 1 || !Number.isInteger(maxUnits) || maxUnits < targetUnits) {
    throw new Error("Child split bounds must be positive integers with max >= target.");
  }

  const blocks = snapshotBlockMap(snapshot);
  const revisionHash = hashCanonicalRevisionContent(revision);
  const embeddingConfig = buildEmbeddingConfiguration();
  const childCandidates = new Map<
    string,
    {
      parent: ExperienceParentPlanEntry;
      span: SourceSpan;
      evidenceIds: Set<string>;
      blockOrder: number;
      experience: Experience;
    }
  >();

  for (const experience of revision.experiences) {
    const logicalExperienceId = requireLogicalId(experience.logical_id, "Child planning");
    for (const item of experience.evidence_items) {
      const evidenceId = requireLogicalId(item.logical_id, "Child planning");
      for (const sourceRef of item.source_refs) {
        const block = validateSpan(blocks, sourceRef);
        for (const part of splitSourceSpan(block, sourceRef, targetUnits, maxUnits)) {
          const parent = findParentForSpan(input.parentPlan, logicalExperienceId, part);
          if (!parent) {
            throw new Error(`No parent context contains child source span for evidence: ${evidenceId}`);
          }
          const key = `${parent.logical_parent_id}:${part.block_id}:${part.start}:${part.end}`;
          const existing = childCandidates.get(key);
          if (existing) {
            existing.evidenceIds.add(evidenceId);
          } else {
            childCandidates.set(key, {
              parent,
              span: part,
              evidenceIds: new Set([evidenceId]),
              blockOrder: block.order,
              experience,
            });
          }
        }
      }
    }
  }

  const orderedCandidates = [...childCandidates.values()].sort(
    (left, right) =>
      left.parent.parent_index - right.parent.parent_index ||
      left.blockOrder - right.blockOrder ||
      left.span.start - right.span.start ||
      left.span.end - right.span.end,
  );
  const childIndexByParent = new Map<string, number>();
  const children = orderedCandidates.map((candidate) => {
    const childIndex = childIndexByParent.get(candidate.parent.logical_parent_id) ?? 0;
    childIndexByParent.set(candidate.parent.logical_parent_id, childIndex + 1);
    const block = validateSpan(blocks, candidate.span);
    const text = block.text.slice(candidate.span.start, candidate.span.end);
    const evidenceIds = [...candidate.evidenceIds].sort();
    const evidenceItems = candidate.experience.evidence_items.filter((item) =>
      item.logical_id ? candidate.evidenceIds.has(item.logical_id) : false,
    );
    return buildChildEntry(
      revision,
      revisionHash,
      snapshot,
      input.parentPlan,
      candidate.parent,
      childIndex,
      candidate.span,
      text,
      evidenceIds,
      candidate.experience,
      evidenceItems,
      embeddingConfig,
      targetUnits,
      maxUnits,
    );
  });

  return {
    source_id: revision.source.source_id,
    revision_id: revision.revision.revision_id,
    revision_content_hash: revisionHash,
    extraction_snapshot_id: snapshot.extraction_snapshot_id,
    planning_version: EXPERIENCE_CHILD_PLANNING_VERSION,
    parent_planning_version: input.parentPlan.planning_version,
    child_target_utf16_units: targetUnits,
    child_max_utf16_units: maxUnits,
    embedding_config: embeddingConfig,
    children,
  };
}

function isAcceptedRevisionStatus(status: CanonicalExperienceRevision["revision"]["status"]) {
  return status === "approved" || status === "indexing" || status === "indexed";
}

function approvedEvidenceIds(revision: CanonicalExperienceRevision) {
  return revision.experiences.flatMap((experience) =>
    experience.evidence_items.map((item) => requireLogicalId(item.logical_id, "Index plan freeze")),
  );
}

function assertEmbeddingConfiguration(config: ExperienceEmbeddingConfiguration, location: string) {
  if (
    config.context_version !== EXPERIENCE_EMBEDDING_CONTEXT_VERSION ||
    config.model !== GEMINI_EMBEDDING_MODEL ||
    config.task_type !== EXPERIENCE_EMBEDDING_TASK_TYPE ||
    config.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new Error(`${location} embedding configuration does not match the configured preparation boundary.`);
  }
}

function assertParentPlanMatches(
  parentPlan: ExperienceParentPlan,
  revision: CanonicalExperienceRevision,
  snapshot: ExtractionSnapshot,
  approvedContentHash: string,
) {
  if (
    parentPlan.source_id !== revision.source.source_id ||
    parentPlan.revision_id !== revision.revision.revision_id ||
    parentPlan.revision_content_hash !== approvedContentHash ||
    parentPlan.extraction_snapshot_id !== snapshot.extraction_snapshot_id ||
    parentPlan.planning_version !== EXPERIENCE_PARENT_PLANNING_VERSION
  ) {
    throw new Error("Parent plan does not match the approved revision.");
  }
  if (parentPlan.parents.length === 0) {
    throw new Error("Approved revision plan contains no parent contexts.");
  }
}

function assertChildPlanMatches(
  childPlan: ExperienceChildPlan,
  parentPlan: ExperienceParentPlan,
  revision: CanonicalExperienceRevision,
  snapshot: ExtractionSnapshot,
  approvedContentHash: string,
) {
  if (
    childPlan.source_id !== revision.source.source_id ||
    childPlan.revision_id !== revision.revision.revision_id ||
    childPlan.revision_content_hash !== approvedContentHash ||
    childPlan.extraction_snapshot_id !== snapshot.extraction_snapshot_id ||
    childPlan.parent_planning_version !== parentPlan.planning_version ||
    childPlan.planning_version !== EXPERIENCE_CHILD_PLANNING_VERSION
  ) {
    throw new Error("Child plan does not match the approved revision and parent plan.");
  }
  assertEmbeddingConfiguration(childPlan.embedding_config, "Child plan");
  if (childPlan.children.length === 0) {
    throw new Error("Approved revision plan contains no child chunks.");
  }

  const blocks = snapshotBlockMap(snapshot);
  const parentIds = new Set(parentPlan.parents.map((parent) => parent.logical_parent_id));
  const seenChunkIds = new Set<string>();
  for (const child of childPlan.children) {
    if (!parentIds.has(child.logical_parent_id)) {
      throw new Error(`Child chunk references an unknown parent: ${child.logical_parent_id}`);
    }
    if (seenChunkIds.has(child.logical_chunk_id)) {
      throw new Error(`Duplicate logical child chunk ID: ${child.logical_chunk_id}`);
    }
    seenChunkIds.add(child.logical_chunk_id);
    assertEmbeddingConfiguration(child.embedding_config, `Child ${child.logical_chunk_id}`);
    assertEmbeddingConfiguration(child.metadata.embedding_config, `Child ${child.logical_chunk_id} metadata`);
    const block = validateSpan(blocks, child.source_span);
    const retainedText = block.text.slice(child.source_span.start, child.source_span.end);
    if (retainedText !== child.child_text || child.source_span.text !== child.child_text) {
      throw new Error(`Child chunk citation text does not match retained source: ${child.logical_chunk_id}`);
    }
    if (!child.embedding_text.endsWith(child.child_text)) {
      throw new Error(`Child chunk embedding text must retain the exact citation text suffix: ${child.logical_chunk_id}`);
    }
  }
}

function assertChildCoverage(revision: CanonicalExperienceRevision, childPlan: ExperienceChildPlan) {
  const representedEvidenceIds = new Set(childPlan.children.flatMap((child) => child.evidence_logical_ids));
  const allowedEvidenceIds = new Set(approvedEvidenceIds(revision));
  for (const evidenceId of representedEvidenceIds) {
    if (!allowedEvidenceIds.has(evidenceId)) {
      throw new Error(`Child plan references unknown approved evidence: ${evidenceId}`);
    }
  }
  const missingEvidenceIds = [...allowedEvidenceIds].filter((evidenceId) => !representedEvidenceIds.has(evidenceId));
  if (missingEvidenceIds.length > 0) {
    throw new Error(`Approved evidence is missing from child plan: ${missingEvidenceIds.join(", ")}`);
  }
}

function buildPreparationConfiguration(
  parentPlan: ExperienceParentPlan,
  childPlan: ExperienceChildPlan,
  maxChildChunksPerRevision: number,
): ExperienceIndexPreparationConfiguration {
  return {
    plan_version: EXPERIENCE_INDEX_PLAN_VERSION,
    parent_planning_version: parentPlan.planning_version,
    child_planning_version: childPlan.planning_version,
    embedding_context_version: childPlan.embedding_config.context_version,
    chunking_version: chunkingVersion(),
    max_parent_utf16_units: parentPlan.max_parent_utf16_units,
    child_target_utf16_units: childPlan.child_target_utf16_units,
    child_max_utf16_units: childPlan.child_max_utf16_units,
    max_child_chunks_per_revision: maxChildChunksPerRevision,
    embedding_model: childPlan.embedding_config.model,
    embedding_task_type: childPlan.embedding_config.task_type,
    embedding_dimensions: childPlan.embedding_config.dimensions,
  };
}

function hashFrozenPlan(input: {
  approvedContentHash: string;
  parentPlan: ExperienceParentPlan;
  childPlan: ExperienceChildPlan;
  preparationConfig: ExperienceIndexPreparationConfiguration;
}) {
  return hashCanonicalJson({
    plan_version: EXPERIENCE_INDEX_PLAN_VERSION,
    approved_content_hash: input.approvedContentHash,
    preparation_config: input.preparationConfig,
    parent_plan: input.parentPlan,
    child_plan: input.childPlan,
  });
}

export function freezeApprovedExperienceIndexPlan(input: FreezeApprovedIndexPlanInput): FrozenExperienceIndexPlan {
  const snapshot = parseExtractionSnapshot(input.snapshot);
  const revision = parseCanonicalExperienceRevision(input.revision);
  assertRevisionMatchesSnapshot(snapshot, revision);
  if (!isAcceptedRevisionStatus(revision.revision.status)) {
    throw new Error("Only approved revisions can be frozen for indexing.");
  }

  const approvedContentHash = hashCanonicalRevisionContent(revision);
  if (revision.revision.approved_content_hash !== approvedContentHash) {
    throw new Error("Approved revision content hash must match before indexing.");
  }

  const parentPlan =
    input.parentPlan ??
    buildExperienceParentPlan({
      snapshot,
      revision,
      maxParentUtf16Units: input.maxParentUtf16Units,
    });
  const childPlan =
    input.childPlan ??
    buildExperienceChildPlan({
      snapshot,
      revision,
      parentPlan,
      childTargetUtf16Units: input.childTargetUtf16Units,
      childMaxUtf16Units: input.childMaxUtf16Units,
    });
  const maxChildChunksPerRevision = input.maxChildChunksPerRevision ?? EXPERIENCE_MAX_CHILD_CHUNKS_PER_REVISION;
  if (!Number.isInteger(maxChildChunksPerRevision) || maxChildChunksPerRevision < 1) {
    throw new Error("maxChildChunksPerRevision must be a positive integer.");
  }
  if (childPlan.children.length > maxChildChunksPerRevision) {
    throw new Error(
      `Approved revision plan exceeds the child chunk limit: ${childPlan.children.length}/${maxChildChunksPerRevision}.`,
    );
  }

  assertParentPlanMatches(parentPlan, revision, snapshot, approvedContentHash);
  assertChildPlanMatches(childPlan, parentPlan, revision, snapshot, approvedContentHash);
  assertChildCoverage(revision, childPlan);

  const preparationConfig = buildPreparationConfiguration(parentPlan, childPlan, maxChildChunksPerRevision);
  const expectedEvidenceCount = approvedEvidenceIds(revision).length;
  return {
    source_id: revision.source.source_id,
    revision_id: revision.revision.revision_id,
    extraction_snapshot_id: snapshot.extraction_snapshot_id,
    approved_content_hash: approvedContentHash,
    plan_version: EXPERIENCE_INDEX_PLAN_VERSION,
    plan_hash: hashFrozenPlan({
      approvedContentHash,
      parentPlan,
      childPlan,
      preparationConfig,
    }),
    expected_parent_count: parentPlan.parents.length,
    expected_child_count: childPlan.children.length,
    expected_evidence_count: expectedEvidenceCount,
    preparation_config: preparationConfig,
    parent_plan: parentPlan,
    child_plan: childPlan,
  };
}
