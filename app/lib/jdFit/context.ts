import type { ApprovedExperienceSearchResult, ApprovedRevisionContentRow } from "../experience/approvedSearch";
import { JD_FIT_CONTEXT_CHARACTERS } from "./config";
import {
  JD_FIT_EVIDENCE_KINDS,
  JD_FIT_EXPERIENCE_TYPES,
  type JdFitCitation,
  type JdFitEvidenceKind,
  type JdFitExperienceType,
  type JdFitRequirement,
} from "./contracts";
import type { RequirementEvidence } from "./retrieval";

export interface RetainedSourceSpan {
  block_id: string;
  start: number;
  end: number;
}

export interface EvidenceRecord {
  handle: string;
  key: string;
  hit: ApprovedExperienceSearchResult;
  span: RetainedSourceSpan;
  evidenceLogicalIds: string[];
  /** Filled after retrieval from the cited revision's approved content; absent when the lookup did not resolve. */
  labels?: CitationLabels;
}

export interface CitationLabels {
  experience_title: string | null;
  experience_type: JdFitExperienceType;
  evidence_kinds: JdFitEvidenceKind[];
}

/**
 * Used when a citation's labels cannot be resolved. A project with a null title shows no title segment, so this
 * fallback never presents an invented label.
 */
export const UNRESOLVED_CITATION_LABELS: CitationLabels = Object.freeze({
  experience_title: null,
  experience_type: "project",
  evidence_kinds: [],
}) as CitationLabels;

export interface EvidenceContextStats {
  retrieved_count: number;
  deduped_evidence_count: number;
  context_evidence_count: number;
  trimmed_evidence_count: number;
  context_characters: number;
  context_character_budget: number;
  context_truncated: boolean;
}

export interface EvidenceContext {
  evidence: EvidenceRecord[];
  handlesByRequirement: Map<string, string[]>;
  stats: EvidenceContextStats;
}

/** Reads the retained span anchor ingestion stores on every published child chunk. */
export function retainedSourceSpan(hit: ApprovedExperienceSearchResult): RetainedSourceSpan | null {
  const span = hit.metadata?.source_span;
  if (!span || typeof span !== "object" || Array.isArray(span)) return null;
  const { block_id: blockId, start, end } = span as Record<string, unknown>;
  if (typeof blockId !== "string" || !blockId) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) <= (start as number)) {
    return null;
  }
  return { block_id: blockId, start: start as number, end: end as number };
}

function evidenceLogicalIds(hit: ApprovedExperienceSearchResult) {
  const ids = hit.metadata?.evidence_logical_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/**
 * Identity of one retrieved passage. Logical chunk IDs are preferred; when absent, the physical row ID plus the
 * retained span keeps the key unique. Revision ID is included because logical IDs are shared across revisions.
 */
export function evidenceKey(hit: ApprovedExperienceSearchResult, span: RetainedSourceSpan) {
  const passage = hit.logical_chunk_id ?? `${hit.id}@${span.block_id}:${span.start}-${span.end}`;
  return `${hit.source_id}|${hit.revision_id}|${passage}`;
}

/**
 * Deduplicates retrieved passages and fits them into the character budget deterministically: passages are taken
 * round-robin by rank across requirements in order, so every requirement keeps its best hits before any keeps more.
 */
export function buildEvidenceContext(
  requirements: JdFitRequirement[],
  retrieved: RequirementEvidence[],
  characterBudget = JD_FIT_CONTEXT_CHARACTERS,
): EvidenceContext {
  const hitsByRequirement = new Map(retrieved.map((entry) => [entry.requirement_id, entry.hits]));
  const ordered = requirements.map((requirement) => ({
    requirementId: requirement.requirement_id,
    hits: hitsByRequirement.get(requirement.requirement_id) ?? [],
  }));

  let retrievedCount = 0;
  const unique = new Map<string, { hit: ApprovedExperienceSearchResult; span: RetainedSourceSpan }>();
  const keysByRequirement = new Map<string, string[]>();
  let unanchored = 0;
  for (const { requirementId, hits } of ordered) {
    const keys: string[] = [];
    for (const hit of hits) {
      retrievedCount += 1;
      const span = retainedSourceSpan(hit);
      if (!span || !hit.child_text?.trim()) {
        unanchored += 1;
        keys.push("");
        continue;
      }
      const key = evidenceKey(hit, span);
      if (!unique.has(key)) unique.set(key, { hit, span });
      keys.push(key);
    }
    keysByRequirement.set(requirementId, keys);
  }

  const included = new Map<string, EvidenceRecord>();
  const considered = new Set<string>();
  let characters = 0;
  const maxRank = Math.max(0, ...ordered.map((entry) => entry.hits.length));
  for (let rank = 0; rank < maxRank; rank += 1) {
    for (const { requirementId } of ordered) {
      const key = keysByRequirement.get(requirementId)?.[rank];
      if (!key || considered.has(key)) continue;
      considered.add(key);
      const candidate = unique.get(key)!;
      const length = candidate.hit.child_text.length;
      if (characters + length > characterBudget) continue;
      characters += length;
      included.set(key, {
        handle: `E${included.size + 1}`,
        key,
        hit: candidate.hit,
        span: candidate.span,
        evidenceLogicalIds: evidenceLogicalIds(candidate.hit),
      });
    }
  }

  const handlesByRequirement = new Map<string, string[]>();
  for (const { requirementId } of ordered) {
    const handles: string[] = [];
    for (const key of keysByRequirement.get(requirementId) ?? []) {
      const record = key ? included.get(key) : undefined;
      if (record && !handles.includes(record.handle)) handles.push(record.handle);
    }
    handlesByRequirement.set(requirementId, handles);
  }

  const trimmed = unique.size - included.size + unanchored;
  return {
    evidence: [...included.values()],
    handlesByRequirement,
    stats: {
      retrieved_count: retrievedCount,
      deduped_evidence_count: unique.size,
      context_evidence_count: included.size,
      trimmed_evidence_count: trimmed,
      context_characters: characters,
      context_character_budget: characterBudget,
      context_truncated: trimmed > 0,
    },
  };
}

interface RevisionLabelIndex {
  sourceId: string;
  experiences: Map<string, { title: string | null; type: JdFitExperienceType }>;
  evidence: Map<string, { kind: JdFitEvidenceKind; order: number }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isExperienceType(value: unknown): value is JdFitExperienceType {
  return (JD_FIT_EXPERIENCE_TYPES as readonly unknown[]).includes(value);
}

function isEvidenceKind(value: unknown): value is JdFitEvidenceKind {
  return (JD_FIT_EVIDENCE_KINDS as readonly unknown[]).includes(value);
}

function titleValue(title: unknown): string | null {
  const value = asRecord(title)?.value;
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Indexes approved revision content by revision ID: logical experience ID to title and type, and evidence logical ID
 * to kind and its position in the approved JSON. Malformed entries are skipped rather than guessed.
 */
export function buildCitationLabelIndex(rows: readonly ApprovedRevisionContentRow[]): Map<string, RevisionLabelIndex> {
  const index = new Map<string, RevisionLabelIndex>();
  for (const row of rows) {
    const experiences = asRecord(row?.approved_json)?.experiences;
    if (typeof row?.id !== "string" || typeof row.source_id !== "string" || !Array.isArray(experiences)) continue;
    const entry: RevisionLabelIndex = { sourceId: row.source_id, experiences: new Map(), evidence: new Map() };
    let order = 0;
    for (const rawExperience of experiences) {
      const experience = asRecord(rawExperience);
      if (!experience || typeof experience.logical_id !== "string" || !isExperienceType(experience.type)) continue;
      entry.experiences.set(experience.logical_id, { title: titleValue(experience.title), type: experience.type });
      for (const rawItem of Array.isArray(experience.evidence_items) ? experience.evidence_items : []) {
        const item = asRecord(rawItem);
        if (!item || typeof item.logical_id !== "string" || !isEvidenceKind(item.kind)) continue;
        entry.evidence.set(item.logical_id, { kind: item.kind, order: order++ });
      }
    }
    index.set(row.id, entry);
  }
  return index;
}

/** Labels for one record, read only from the record's own revision; anything unresolved falls back to no label. */
export function citationLabelsFor(record: EvidenceRecord, index: ReadonlyMap<string, RevisionLabelIndex>): CitationLabels {
  const revision = index.get(record.hit.revision_id);
  if (!revision || revision.sourceId !== record.hit.source_id) return UNRESOLVED_CITATION_LABELS;
  const experience = revision.experiences.get(record.hit.logical_experience_id);
  if (!experience) return UNRESOLVED_CITATION_LABELS;
  const kinds = record.evidenceLogicalIds
    .map((id) => revision.evidence.get(id))
    .filter((item): item is { kind: JdFitEvidenceKind; order: number } => Boolean(item))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.kind);
  return {
    experience_title: experience.title,
    experience_type: experience.type,
    evidence_kinds: [...new Set(kinds)],
  };
}

/** Attaches labels to every context record from approved revision content rows. */
export function attachCitationLabels(evidence: EvidenceRecord[], rows: readonly ApprovedRevisionContentRow[]) {
  const index = buildCitationLabelIndex(rows);
  for (const record of evidence) {
    record.labels = citationLabelsFor(record, index);
  }
}

/** Resolves a context handle to the retained approved passage it stands for. */
export function citationFromEvidence(record: EvidenceRecord): JdFitCitation {
  const labels = record.labels ?? UNRESOLVED_CITATION_LABELS;
  return {
    evidence_handle: record.handle,
    source_id: record.hit.source_id,
    source_file_name: record.hit.parent?.source_file_name ?? "",
    revision_id: record.hit.revision_id,
    approved_content_hash: record.hit.approved_content_hash,
    logical_experience_id: record.hit.logical_experience_id,
    logical_parent_id: record.hit.logical_parent_id,
    logical_chunk_id: record.hit.logical_chunk_id,
    evidence_logical_ids: record.evidenceLogicalIds,
    experience_title: labels.experience_title,
    experience_type: labels.experience_type,
    evidence_kinds: [...labels.evidence_kinds],
    source_span: record.span,
    quote: record.hit.child_text,
  };
}
