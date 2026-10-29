"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "../../components/Navigation";

type EvidenceKind = "background" | "responsibility" | "contribution" | "challenge" | "decision" | "outcome";
type Attribution = "individual" | "team" | "unspecified";
type ActivityStatus = "completed" | "ongoing" | "planned" | "unspecified";

interface SourceSpan {
  block_id: string;
  start: number;
  end: number;
}

interface SourceBlock {
  block_id: string;
  order: number;
  text: string;
  start_offset?: number;
  end_offset?: number;
}

interface SourceBackedString {
  value: string | null;
  source_refs: SourceSpan[];
}

interface SourceBackedStringArray {
  value: string[];
  source_refs: SourceSpan[];
}

interface EvidenceItem {
  logical_id?: string;
  kind: EvidenceKind;
  summary: string;
  source_refs: SourceSpan[];
  attribution: Attribution;
  activity_status: ActivityStatus;
}

interface ExperienceEntry {
  logical_id?: string;
  type: "project" | "general-experience";
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

interface CanonicalExperienceRevision {
  schema_version: "1";
  source: {
    source_id: string;
    original_file_name: string;
    original_file_type: string;
    byte_sha256: string;
  };
  extraction: {
    extraction_snapshot_id: string;
    text_sha256: string;
    parser_version: string;
    normalization_version: string;
  };
  revision: {
    revision_id: string;
    status: "draft" | "approved" | "indexing" | "indexed" | "failed";
    draft_version: number;
    approved_content_hash: string | null;
    model_version: string | null;
    prompt_version: string | null;
  };
  experiences: ExperienceEntry[];
  review_acknowledgements: {
    warnings: boolean;
    unassigned_blocks: boolean;
  };
}

interface CoverageReport {
  totalBlocks: number;
  referencedBlocks: number;
  unreferencedBlocks: string[];
  coverageRatio: number;
}

interface DraftJson {
  canonical_revision?: CanonicalExperienceRevision;
  source_warnings?: string[];
  omitted_block_coverage?: CoverageReport;
}

interface ExperienceDetailResponse {
  source: {
    id: string;
    file_name: string;
    status: string;
    actions?: string[];
    latest_draft_revision_id?: string | null;
    latest_approved_revision_id?: string | null;
    active_revision_id?: string | null;
    failure?: {
      stage?: string;
      code?: string;
      message?: string;
      recoverable_action?: string;
    } | null;
    cleanup_error?: {
      stage?: string;
      code?: string;
      message?: string;
      recoverable_action?: string;
    } | null;
  };
  latest_extraction: {
    id: string;
    blocks?: SourceBlock[];
    warnings?: string[];
  } | null;
  latest_revision: {
    id: string;
    status: string;
    draft_version: number;
    draft_json?: DraftJson | null;
  } | null;
}

interface DraftFieldError {
  path: string;
  code: string;
  message: string;
}

interface AcceptedRevisionExport {
  revision: CanonicalExperienceRevision;
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

interface IndexProgress {
  total_chunks: number;
  prepared_chunks: number;
  remaining_chunks: number;
  newly_prepared_chunks?: number;
  previously_prepared_chunks?: number;
}

const EVIDENCE_KINDS: EvidenceKind[] = ["background", "responsibility", "contribution", "challenge", "decision", "outcome"];
const ATTRIBUTIONS: Attribution[] = ["individual", "team", "unspecified"];
const ACTIVITY_STATUSES: ActivityStatus[] = ["completed", "ongoing", "planned", "unspecified"];

function cloneDraft(draft: CanonicalExperienceRevision): CanonicalExperienceRevision {
  return JSON.parse(JSON.stringify(draft)) as CanonicalExperienceRevision;
}

function readErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") {
    return fallback;
  }
  const error = (data as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
}

function readFieldErrors(data: unknown): DraftFieldError[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const error = (data as Record<string, unknown>).error;
  const details = error && typeof error === "object" ? (error as Record<string, unknown>).details : null;
  const fieldErrors = details && typeof details === "object" ? (details as Record<string, unknown>).field_errors : null;
  return Array.isArray(fieldErrors) ? (fieldErrors as DraftFieldError[]) : [];
}

function spanPreview(blocks: SourceBlock[], ref: SourceSpan) {
  const block = blocks.find((candidate) => candidate.block_id === ref.block_id);
  if (!block) {
    return "";
  }
  return block.text.slice(Math.max(0, ref.start), Math.min(block.text.length, ref.end));
}

function firstBlockSpan(blocks: SourceBlock[]): SourceSpan {
  const block = blocks[0];
  return {
    block_id: block?.block_id ?? "",
    start: 0,
    end: Math.min(block?.text.length ?? 0, 160),
  };
}

export default function ExperienceReviewClient({ sourceId }: { sourceId: string }) {
  const [detail, setDetail] = useState<ExperienceDetailResponse | null>(null);
  const [draft, setDraft] = useState<CanonicalExperienceRevision | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DraftFieldError[]>([]);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [acceptedExport, setAcceptedExport] = useState<AcceptedRevisionExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/experiences/${sourceId}`);
      const data = (await response.json()) as ExperienceDetailResponse | { error?: unknown };
      if (!response.ok) {
        setError(readErrorMessage(data, "Failed to load experience source."));
        return;
      }
      const typedDetail = data as ExperienceDetailResponse;
      const canonicalDraft = typedDetail.latest_revision?.draft_json?.canonical_revision ?? null;
      setDetail(typedDetail);
      setDraft(canonicalDraft ? cloneDraft(canonicalDraft) : null);
      setFieldErrors([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load experience source.");
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    void Promise.resolve().then(loadDetail);
  }, [loadDetail]);

  const sourceBlocks = useMemo(() => detail?.latest_extraction?.blocks ?? [], [detail]);
  const sourceWarnings = detail?.latest_revision?.draft_json?.source_warnings ?? detail?.latest_extraction?.warnings ?? [];
  const omittedCoverage = detail?.latest_revision?.draft_json?.omitted_block_coverage ?? null;
  const latestRevisionStatus = detail?.latest_revision?.status ?? null;
  const activeRevisionId = detail?.source.active_revision_id ?? null;
  const latestApprovedRevisionId = detail?.source.latest_approved_revision_id ?? null;
  const latestDraftRevisionId = detail?.source.latest_draft_revision_id ?? null;
  const sourceFailure = detail?.source.failure ?? null;
  const cleanupError = detail?.source.cleanup_error ?? null;

  const runSourceAction = async (action: "extract" | "parse") => {
    try {
      setRunningAction(action);
      setMessage(null);
      setError(null);
      setFieldErrors([]);
      const response = await fetch(`/api/experiences/${sourceId}/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(readErrorMessage(data, `${action} failed.`));
        return;
      }
      setMessage(`${action === "extract" ? "Extraction" : "Parsing"} completed. Next action: ${data.next_action ?? "review"}.`);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${action} failed.`);
    } finally {
      setRunningAction(null);
    }
  };

  const updateDraft = (updater: (next: CanonicalExperienceRevision) => void) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const next = cloneDraft(current);
      updater(next);
      return next;
    });
  };

  const updateExperience = (experienceIndex: number, updater: (experience: ExperienceEntry) => void) => {
    updateDraft((next) => {
      const experience = next.experiences[experienceIndex];
      if (experience) {
        updater(experience);
      }
    });
  };

  const updateSourceBackedString = (
    experienceIndex: number,
    field: "title" | "organization" | "role",
    value: string,
  ) => {
    updateExperience(experienceIndex, (experience) => {
      experience[field].value = value.trim() ? value : null;
    });
  };

  const updateEvidence = (
    experienceIndex: number,
    evidenceIndex: number,
    updater: (evidence: EvidenceItem) => void,
  ) => {
    updateExperience(experienceIndex, (experience) => {
      const evidence = experience.evidence_items[evidenceIndex];
      if (evidence) {
        updater(evidence);
      }
    });
  };

  const removeEvidence = (experienceIndex: number, evidenceIndex: number) => {
    updateExperience(experienceIndex, (experience) => {
      experience.evidence_items.splice(evidenceIndex, 1);
    });
  };

  const addEvidenceSpan = (experienceIndex: number, evidenceIndex: number) => {
    updateEvidence(experienceIndex, evidenceIndex, (evidence) => {
      evidence.source_refs.push(firstBlockSpan(sourceBlocks));
    });
  };

  const updateEvidenceSpan = (
    experienceIndex: number,
    evidenceIndex: number,
    spanIndex: number,
    patch: Partial<SourceSpan>,
  ) => {
    updateEvidence(experienceIndex, evidenceIndex, (evidence) => {
      const span = evidence.source_refs[spanIndex];
      if (span) {
        evidence.source_refs[spanIndex] = { ...span, ...patch };
      }
    });
  };

  const removeEvidenceSpan = (experienceIndex: number, evidenceIndex: number, spanIndex: number) => {
    updateEvidence(experienceIndex, evidenceIndex, (evidence) => {
      evidence.source_refs.splice(spanIndex, 1);
    });
  };

  const saveDraft = async () => {
    if (!draft) {
      return;
    }
    const evidenceCount = draft.experiences.reduce((count, experience) => count + experience.evidence_items.length, 0);
    if (evidenceCount === 0) {
      setFieldErrors([
        {
          path: "experiences",
          code: "no-usable-evidence",
          message: "Draft must contain at least one source-grounded evidence item.",
        },
      ]);
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      setFieldErrors([]);
      setAcceptedExport(null);
      const response = await fetch(`/api/experiences/${sourceId}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision_id: draft.revision.revision_id,
          expected_draft_version: draft.revision.draft_version,
          draft,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(readFieldErrors(data));
        setError(readErrorMessage(data, "Draft could not be saved."));
        return;
      }
      setMessage(`Saved draft version ${data.draft_version}.`);
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Draft could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const approveDraft = async () => {
    if (!draft || latestRevisionStatus !== "draft") {
      return;
    }
    try {
      setRunningAction("approve");
      setMessage(null);
      setError(null);
      setFieldErrors([]);
      const response = await fetch(`/api/experiences/${sourceId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision_id: draft.revision.revision_id,
          expected_draft_version: draft.revision.draft_version,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(readFieldErrors(data));
        setError(readErrorMessage(data, "Approval failed."));
        return;
      }
      setIndexProgress(null);
      setMessage(`Approved draft version ${data.draft_version}. Ready to index.`);
      await loadDetail();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Approval failed.");
    } finally {
      setRunningAction(null);
    }
  };

  const indexApprovedRevision = async () => {
    const revisionId = latestApprovedRevisionId ?? activeRevisionId ?? detail?.latest_revision?.id;
    if (!revisionId) {
      setError("No approved revision is available for indexing.");
      return;
    }
    try {
      setRunningAction("index");
      setMessage(null);
      setError(null);
      const response = await fetch(`/api/experiences/${sourceId}/index`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision_id: revisionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(readErrorMessage(data, "Indexing failed."));
        return;
      }
      setIndexProgress(data.progress ?? null);
      setAcceptedExport(null);
      setMessage(data.status === "indexed" ? "Indexing complete." : "Indexing progress saved.");
      await loadDetail();
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "Indexing failed.");
    } finally {
      setRunningAction(null);
    }
  };

  const createDraftFromApproved = async () => {
    try {
      setRunningAction("draft-from-approved");
      setMessage(null);
      setError(null);
      const response = await fetch(`/api/experiences/${sourceId}/draft-from-approved`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(latestApprovedRevisionId ? { approved_revision_id: latestApprovedRevisionId } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(readErrorMessage(data, "Draft could not be created."));
        return;
      }
      setMessage(`Created editable draft ${data.revision_id}.`);
      setAcceptedExport(null);
      await loadDetail();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Draft could not be created.");
    } finally {
      setRunningAction(null);
    }
  };

  const retryDeleteCleanup = async () => {
    try {
      setRunningAction("retry-delete");
      setMessage(null);
      setError(null);
      const response = await fetch(`/api/experiences/${sourceId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setError(readErrorMessage(data, "Delete retry failed."));
        return;
      }
      setMessage(data.status === "cleanup-pending" ? "Storage cleanup is still pending." : "Experience source deleted.");
      if (data.status === "cleanup-pending") {
        await loadDetail();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete retry failed.");
    } finally {
      setRunningAction(null);
    }
  };

  const canExtract = detail?.source.actions?.includes("extract") || sourceFailure?.recoverable_action === "retry-extract";
  const canParse = detail?.source.actions?.includes("parse") || sourceFailure?.recoverable_action === "retry-parse";
  const canApprove = Boolean(draft && latestRevisionStatus === "draft");
  const canIndex =
    detail?.source.actions?.includes("index") ||
    sourceFailure?.recoverable_action === "retry-index" ||
    latestRevisionStatus === "approved" ||
    latestRevisionStatus === "indexing";
  const canCreateDraftFromApproved = Boolean(latestApprovedRevisionId && latestRevisionStatus !== "draft");
  const canRetryDelete = detail?.source.status === "cleanup-pending" || cleanupError?.recoverable_action === "retry-delete";
  const exportRevisionId = latestApprovedRevisionId ?? activeRevisionId;

  const loadAcceptedExport = async () => {
    if (!exportRevisionId) {
      setError("No accepted revision is available for inspection.");
      return;
    }
    try {
      setLoadingExport(true);
      setError(null);
      const response = await fetch(`/api/experiences/${sourceId}/revisions/${exportRevisionId}/export`);
      const data = await response.json();
      if (!response.ok) {
        setError(readErrorMessage(data, "Accepted revision export failed."));
        return;
      }
      setAcceptedExport(data as AcceptedRevisionExport);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Accepted revision export failed.");
    } finally {
      setLoadingExport(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-7xl mx-auto p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/documents" className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400">
              Back to Documents
            </Link>
            <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
              {detail?.source.file_name ?? "Experience Review"}
            </h1>
          </div>
          <button
            onClick={saveDraft}
            disabled={!draft || saving || loading || latestRevisionStatus !== "draft"}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
        </div>

        {detail && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-1 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Source:</span> {detail.source.status}
                </div>
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Draft:</span> {latestDraftRevisionId ?? "none"}
                </div>
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Approved:</span> {latestApprovedRevisionId ?? "none"}
                </div>
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Active:</span> {activeRevisionId ?? "none"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canExtract && (
                  <button
                    onClick={() => runSourceAction("extract")}
                    disabled={runningAction !== null}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {runningAction === "extract" ? "Extracting..." : "Extract"}
                  </button>
                )}
                {canParse && (
                  <button
                    onClick={() => runSourceAction("parse")}
                    disabled={runningAction !== null}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {runningAction === "parse" ? "Parsing..." : "Parse"}
                  </button>
                )}
                {canApprove && (
                  <button
                    onClick={approveDraft}
                    disabled={runningAction !== null || saving}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-400"
                  >
                    {runningAction === "approve" ? "Approving..." : "Approve"}
                  </button>
                )}
                {canIndex && (
                  <button
                    onClick={indexApprovedRevision}
                    disabled={runningAction !== null}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {runningAction === "index" ? "Indexing..." : "Index"}
                  </button>
                )}
                {canCreateDraftFromApproved && (
                  <button
                    onClick={createDraftFromApproved}
                    disabled={runningAction !== null}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {runningAction === "draft-from-approved" ? "Creating..." : "Edit Approved"}
                  </button>
                )}
                {canRetryDelete && (
                  <button
                    onClick={retryDeleteCleanup}
                    disabled={runningAction !== null}
                    className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    {runningAction === "retry-delete" ? "Retrying..." : "Retry Cleanup"}
                  </button>
                )}
                <a
                  href={`/api/experiences/${sourceId}/file`}
                  download
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Download Original
                </a>
                {exportRevisionId && (
                  <button
                    onClick={loadAcceptedExport}
                    disabled={loadingExport}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {loadingExport ? "Loading JSON..." : "Inspect Accepted JSON"}
                  </button>
                )}
              </div>
            </div>

            {indexProgress && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>Embedding preparation</span>
                  <span>
                    {indexProgress.prepared_chunks}/{indexProgress.total_chunks}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full bg-blue-600"
                    style={{
                      width: `${
                        indexProgress.total_chunks > 0
                          ? Math.round((indexProgress.prepared_chunks / indexProgress.total_chunks) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            {(sourceFailure || cleanupError) && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                {sourceFailure?.message || cleanupError?.message}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading experience...</div>
        ) : error ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {message && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
            {message}
          </div>
        )}

        {fieldErrors.length > 0 && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <div className="space-y-1 text-sm text-red-800 dark:text-red-200">
              {fieldErrors.map((fieldError) => (
                <p key={`${fieldError.path}:${fieldError.code}`}>
                  <span className="font-medium">{fieldError.path}</span>: {fieldError.message}
                </p>
              ))}
            </div>
          </div>
        )}

        {acceptedExport && (
          <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Accepted Revision</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{acceptedExport.content_hash}</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Accepted JSON</h3>
                <pre className="max-h-96 overflow-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-800 dark:bg-gray-950 dark:text-gray-200">
                  {JSON.stringify(acceptedExport.revision, null, 2)}
                </pre>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Resolved Source References</h3>
                <div className="max-h-96 space-y-3 overflow-auto pr-1">
                  {acceptedExport.resolved_source_refs.map((reference, index) => (
                    <div key={`${reference.field_path}:${index}`} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{reference.field_path}</p>
                      {reference.source_refs.map((sourceRef, sourceRefIndex) => (
                        <blockquote
                          key={`${sourceRef.block_id}:${sourceRef.start}:${sourceRefIndex}`}
                          className="mt-2 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200"
                        >
                          {sourceRef.text}
                        </blockquote>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !draft && !error && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            No editable draft is available for this source.
          </div>
        )}

        {draft && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Review Acknowledgements</h2>
                <div className="mt-4 space-y-3">
                  <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={draft.review_acknowledgements.warnings}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.review_acknowledgements.warnings = event.target.checked;
                        })
                      }
                      className="h-4 w-4"
                    />
                    Warnings reviewed ({sourceWarnings.length})
                  </label>
                  <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={draft.review_acknowledgements.unassigned_blocks}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.review_acknowledgements.unassigned_blocks = event.target.checked;
                        })
                      }
                      className="h-4 w-4"
                    />
                    Unassigned blocks reviewed ({omittedCoverage?.unreferencedBlocks.length ?? 0})
                  </label>
                </div>
              </div>

              {draft.experiences.map((experience, experienceIndex) => (
                <div
                  key={experience.logical_id ?? experienceIndex}
                  className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
                >
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {experience.title.value || `Experience ${experienceIndex + 1}`}
                    </h2>
                    <span className="w-fit rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {experience.type}
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Title
                      <input
                        value={experience.title.value ?? ""}
                        onChange={(event) => updateSourceBackedString(experienceIndex, "title", event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Organization
                      <input
                        value={experience.organization.value ?? ""}
                        onChange={(event) => updateSourceBackedString(experienceIndex, "organization", event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Role
                      <input
                        value={experience.role.value ?? ""}
                        onChange={(event) => updateSourceBackedString(experienceIndex, "role", event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Technologies
                      <input
                        value={experience.technologies.value.join(", ")}
                        onChange={(event) =>
                          updateExperience(experienceIndex, (next) => {
                            next.technologies.value = event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean);
                          })
                        }
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Start
                      <input
                        value={experience.period.start.value ?? ""}
                        onChange={(event) =>
                          updateExperience(experienceIndex, (next) => {
                            next.period.start.value = event.target.value.trim() ? event.target.value : null;
                          })
                        }
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      End
                      <input
                        value={experience.period.end.value ?? ""}
                        onChange={(event) =>
                          updateExperience(experienceIndex, (next) => {
                            next.period.end.value = event.target.value.trim() ? event.target.value : null;
                          })
                        }
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                  </div>

                  <div className="mt-6 space-y-4">
                    {experience.evidence_items.map((evidence, evidenceIndex) => (
                      <div
                        key={evidence.logical_id ?? evidenceIndex}
                        className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                            Evidence
                            <textarea
                              value={evidence.summary}
                              onChange={(event) =>
                                updateEvidence(experienceIndex, evidenceIndex, (next) => {
                                  next.summary = event.target.value;
                                })
                              }
                              rows={3}
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                            />
                          </label>
                          <button
                            onClick={() => removeEvidence(experienceIndex, evidenceIndex)}
                            className="mt-6 text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                          >
                            Remove
                          </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Kind
                            <select
                              value={evidence.kind}
                              onChange={(event) =>
                                updateEvidence(experienceIndex, evidenceIndex, (next) => {
                                  next.kind = event.target.value as EvidenceKind;
                                })
                              }
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                            >
                              {EVIDENCE_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Attribution
                            <select
                              value={evidence.attribution}
                              onChange={(event) =>
                                updateEvidence(experienceIndex, evidenceIndex, (next) => {
                                  next.attribution = event.target.value as Attribution;
                                })
                              }
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                            >
                              {ATTRIBUTIONS.map((attribution) => (
                                <option key={attribution} value={attribution}>
                                  {attribution}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Status
                            <select
                              value={evidence.activity_status}
                              onChange={(event) =>
                                updateEvidence(experienceIndex, evidenceIndex, (next) => {
                                  next.activity_status = event.target.value as ActivityStatus;
                                })
                              }
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                            >
                              {ACTIVITY_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Source Spans</h3>
                            <button
                              onClick={() => addEvidenceSpan(experienceIndex, evidenceIndex)}
                              className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            >
                              Add Span
                            </button>
                          </div>
                          {evidence.source_refs.map((sourceRef, spanIndex) => (
                            <div key={`${sourceRef.block_id}:${spanIndex}`} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_96px_96px_auto] md:items-end">
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                  Block
                                  <select
                                    value={sourceRef.block_id}
                                    onChange={(event) => {
                                      const block = sourceBlocks.find((candidate) => candidate.block_id === event.target.value);
                                      updateEvidenceSpan(experienceIndex, evidenceIndex, spanIndex, {
                                        block_id: event.target.value,
                                        start: 0,
                                        end: Math.min(block?.text.length ?? 0, Math.max(1, sourceRef.end - sourceRef.start)),
                                      });
                                    }}
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                  >
                                    {sourceBlocks.map((block) => (
                                      <option key={block.block_id} value={block.block_id}>
                                        {block.block_id}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                  Start
                                  <input
                                    type="number"
                                    min={0}
                                    value={sourceRef.start}
                                    onChange={(event) =>
                                      updateEvidenceSpan(experienceIndex, evidenceIndex, spanIndex, {
                                        start: Number(event.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                  />
                                </label>
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                  End
                                  <input
                                    type="number"
                                    min={0}
                                    value={sourceRef.end}
                                    onChange={(event) =>
                                      updateEvidenceSpan(experienceIndex, evidenceIndex, spanIndex, {
                                        end: Number(event.target.value),
                                      })
                                    }
                                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                  />
                                </label>
                                <button
                                  onClick={() => removeEvidenceSpan(experienceIndex, evidenceIndex, spanIndex)}
                                  className="text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                                >
                                  Remove
                                </button>
                              </div>
                              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{spanPreview(sourceBlocks, sourceRef)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <aside className="min-w-0 space-y-6">
              <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Source Blocks</h2>
                <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {sourceBlocks.map((block) => (
                    <div key={block.block_id} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                      <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {block.block_id} · {block.text.length} chars
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{block.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {(sourceWarnings.length > 0 || (omittedCoverage?.unreferencedBlocks.length ?? 0) > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
                  <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">Review Flags</h2>
                  {sourceWarnings.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
                      {sourceWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {(omittedCoverage?.unreferencedBlocks.length ?? 0) > 0 && (
                    <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                      Unassigned blocks: {omittedCoverage?.unreferencedBlocks.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
