import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import { JD_FIT_CONTEXT_CHARACTERS } from "./config";
import type { JdFitCitation, JdFitRequirement } from "./contracts";
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
}

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

/** Resolves a context handle to the retained approved passage it stands for. */
export function citationFromEvidence(record: EvidenceRecord): JdFitCitation {
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
    source_span: record.span,
    quote: record.hit.child_text,
  };
}
