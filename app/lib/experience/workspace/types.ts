/**
 * Browser-side shapes of the `/api/experiences` responses the workspace reads. They describe what the API returns
 * today; nothing here is sent back except through the existing request bodies.
 */

export type EvidenceKind = "background" | "responsibility" | "contribution" | "challenge" | "decision" | "outcome";
export type Attribution = "individual" | "team" | "unspecified";
export type ActivityStatus = "completed" | "ongoing" | "planned" | "unspecified";
export type ExperienceType = "project" | "general-experience";

export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["background", "responsibility", "contribution", "challenge", "decision", "outcome"];
export const ATTRIBUTIONS: readonly Attribution[] = ["individual", "team", "unspecified"];
export const ACTIVITY_STATUSES: readonly ActivityStatus[] = ["completed", "ongoing", "planned", "unspecified"];

export type ExperienceApiAction = "extract" | "parse" | "review" | "approve" | "index" | "retry";

export type RecoverableAction = "retry-extract" | "retry-parse" | "retry-index" | "retry-delete" | "refresh-source" | (string & {});

export interface SourceFailure {
  stage?: string;
  code?: string;
  message?: string;
  recoverable_action?: RecoverableAction;
}

export interface SourceSummary {
  id: string;
  file_name: string;
  file_type?: string;
  file_size?: number;
  status: string;
  latest_extraction_id?: string | null;
  latest_draft_revision_id?: string | null;
  latest_approved_revision_id?: string | null;
  active_revision_id?: string | null;
  active_version_number?: number | null;
  latest_approved_version_number?: number | null;
  failure?: SourceFailure | null;
  cleanup_error?: SourceFailure | null;
  created_at?: string;
  updated_at?: string;
  actions?: string[];
}

export interface SourceSpan {
  block_id: string;
  start: number;
  end: number;
}

export interface SourceBlock {
  block_id: string;
  order: number;
  text: string;
}

export interface SourceBackedString {
  value: string | null;
  source_refs: SourceSpan[];
}

export interface SourceBackedStringArray {
  value: string[];
  source_refs: SourceSpan[];
}

export interface EvidenceItem {
  logical_id?: string;
  kind: EvidenceKind;
  summary: string;
  source_refs: SourceSpan[];
  attribution: Attribution;
  activity_status: ActivityStatus;
}

export interface ExperienceEntry {
  logical_id?: string;
  type: ExperienceType;
  title: SourceBackedString;
  organization: SourceBackedString;
  role: SourceBackedString;
  period: {
    start: SourceBackedString;
    end: SourceBackedString;
    precision: "year" | "month" | "quarter" | "label" | "unknown";
  };
  technologies: SourceBackedStringArray;
  context_refs: SourceSpan[];
  evidence_items: EvidenceItem[];
}

export interface CanonicalRevision {
  schema_version: "1";
  source: { source_id: string; original_file_name: string; original_file_type: string; byte_sha256: string };
  extraction: { extraction_snapshot_id: string; text_sha256: string; parser_version: string; normalization_version: string };
  revision: {
    revision_id: string;
    status: "draft" | "approved" | "indexing" | "indexed" | "failed";
    draft_version: number;
    approved_content_hash: string | null;
    model_version: string | null;
    prompt_version: string | null;
  };
  experiences: ExperienceEntry[];
  review_acknowledgements: { warnings: boolean; unassigned_blocks: boolean };
}

export interface CoverageReport {
  totalBlocks: number;
  referencedBlocks: number;
  unreferencedBlocks: string[];
  coverageRatio?: number;
}

export interface RevisionRowSummary {
  id: string;
  status: string;
  draft_version: number;
  created_at?: string;
  approved_at?: string | null;
  draft_json?: {
    canonical_revision?: CanonicalRevision;
    source_warnings?: string[];
    omitted_block_coverage?: CoverageReport;
  } | null;
}

export interface ApprovedVersion {
  revision_id: string;
  version_number: number;
  approved_at: string;
}

export interface SourceDetail {
  source: SourceSummary;
  latest_extraction: { id: string; blocks?: SourceBlock[]; warnings?: string[] } | null;
  latest_revision: RevisionRowSummary | null;
  revisions?: RevisionRowSummary[];
  approved_versions?: ApprovedVersion[];
}

export interface DraftFieldError {
  path: string;
  code: string;
  message: string;
}

export interface IndexProgress {
  total_chunks: number;
  prepared_chunks: number;
  remaining_chunks: number;
  newly_prepared_chunks?: number;
  previously_prepared_chunks?: number;
}

export interface AcceptedRevisionExport {
  revision: CanonicalRevision;
  source_blocks: SourceBlock[];
  content_hash: string;
  exported_at: string;
  resolved_source_refs: Array<{
    logical_experience_id: string;
    logical_evidence_id: string | null;
    field_path: string;
    source_refs: Array<SourceSpan & { text: string }>;
  }>;
  configuration_versions: Record<string, string | null>;
}

/** Reads `error.message` from an API error body. */
export function readApiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as Record<string, unknown>).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** Reads `error.code` from an API error body. */
export function readApiErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const error = (data as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Reads `error.details.field_errors` from an API error body. */
export function readFieldErrors(data: unknown): DraftFieldError[] {
  if (!data || typeof data !== "object") return [];
  const error = (data as Record<string, unknown>).error;
  const details = error && typeof error === "object" ? (error as Record<string, unknown>).details : null;
  const fieldErrors = details && typeof details === "object" ? (details as Record<string, unknown>).field_errors : null;
  return Array.isArray(fieldErrors) ? (fieldErrors as DraftFieldError[]) : [];
}

export function cloneRevision(draft: CanonicalRevision): CanonicalRevision {
  return JSON.parse(JSON.stringify(draft)) as CanonicalRevision;
}
