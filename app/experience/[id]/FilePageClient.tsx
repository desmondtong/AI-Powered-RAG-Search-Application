"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotice } from "@/app/components/NoticeProvider";
import { useWorkspaceSummary } from "@/app/components/WorkspaceSummaryProvider";
import { ArrowIcon, BoltIcon } from "@/app/components/icons";
import { autostartKey } from "@/app/lib/experience/uploadUi";
import { parseCiteParam, quoteFromBlocks, resolveCitation, type CitationResolution } from "@/app/lib/experience/workspace/citation";
import {
  ACTION_LABELS,
  CITATION,
  DELETE_CONFIRM,
  EDIT_APPROVED_NOTE,
  INDEXING,
  NOTICES,
  PROCESSING,
  REVIEW,
  REVIEW_GUIDANCE,
  editApprovedLabel,
  fileTypeLabel,
  formatFileSize,
  formatTimestamp,
  indexingProgress,
  type ActionId,
} from "@/app/lib/experience/workspace/copy";
import { blockLabels, buildApprovalGate, type GateTarget } from "@/app/lib/experience/workspace/gate";
import { blockNumbers as numberBlocks, evidenceHighlights, evidenceSpanKey, evidenceTargets } from "@/app/lib/experience/workspace/review";
import { describeRevisions, versionForRevision } from "@/app/lib/experience/workspace/revisionLabels";
import { rangeToSpan } from "@/app/lib/experience/workspace/selection";
import { toStageView, type StageAction } from "@/app/lib/experience/workspace/stage";
import { readApiErrorMessage, type AcceptedRevisionExport, type SourceDetail, type SourceSpan } from "@/app/lib/experience/workspace/types";
import ConfirmInline from "../_components/ConfirmInline";
import type { OverflowItem } from "../_components/OverflowMenu";
import { IN_PROGRESS_STATUSES, usePolling } from "../_components/usePolling";
import { useStageTransitions } from "../_components/useStageTransitions";
import { Button, ButtonLink, Hint, Pill } from "../_components/ui";
import AcceptedJsonPanel from "./_components/AcceptedJsonPanel";
import ApprovalGate from "./_components/ApprovalGate";
import ConflictPanel from "./_components/ConflictPanel";
import DocumentPane, { CITATION_KEY, blockAnchorId, spanAnchorId } from "./_components/DocumentPane";
import { evidenceAnchorId } from "./_components/EvidenceCard";
import ExperienceRail, { experienceAnchorId } from "./_components/ExperienceRail";
import FailureInset from "./_components/FailureInset";
import SpanPopover, { type PopoverState } from "./_components/SpanPopover";
import StageHeader from "./_components/StageHeader";
import { useDraftEditor, type UndoToken } from "./_hooks/useDraftEditor";
import { useIndexSequence } from "./_hooks/useIndexSequence";
import { useStageRunner } from "./_hooks/useStageRunner";

type Confirming = null | "delete" | "retry-delete";
type EvidenceRef = { experienceIndex: number; evidenceIndex: number };

const INDEX_ACTIONS: ReadonlySet<ActionId> = new Set(["index-now", "continue-indexing", "retry-index"]);

function scrollToId(id: string) {
  const element = document.getElementById(id);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  return element;
}

/**
 * The file page: one stage header with a single primary action, the processing chain, the explicit index
 * sequence, the review workspace for drafts and the in-page delete confirmation. Every request uses the existing
 * `/api/experiences` routes and bodies.
 */
export default function FilePageClient({ sourceId, cite, rev }: { sourceId: string; cite?: string | null; rev?: string | null }) {
  const router = useRouter();
  const { refresh: refreshSummary } = useWorkspaceSummary();
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastStatus = useRef<string | null>(null);
  const adoptRef = useRef<(detail: SourceDetail | null) => void>(() => {});

  /** Re-reads the detail. Keeps unsaved draft edits, and refreshes the shared summary when the stage changed. */
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/experiences/${sourceId}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as SourceDetail | null;
      if (!response.ok || !data?.source) {
        throw new Error(readApiErrorMessage(data, "This file could not be loaded."));
      }
      setDetail(data);
      setLoadError(null);
      adoptRef.current(data);
      if (lastStatus.current !== data.source.status) {
        if (lastStatus.current !== null) void refreshSummary();
        lastStatus.current = data.source.status;
      }
      return { detail: data, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "This file could not be loaded.";
      setLoadError(message);
      return { detail: null, error: message };
    } finally {
      setLoading(false);
    }
  }, [sourceId, refreshSummary]);

  const notice = useNotice();
  const editor = useDraftEditor(sourceId, refresh, notice);
  useEffect(() => {
    adoptRef.current = editor.adopt;
  }, [editor.adopt]);

  const runner = useStageRunner(sourceId, refresh);
  const indexing = useIndexSequence(sourceId, refresh, notice);

  // A fresh upload hands over a one-time key. Read it once and remove it, so a reload never starts work again.
  const autostart = useRef<boolean | null>(null);
  useEffect(() => {
    if (autostart.current !== null) return;
    let flagged = false;
    try {
      const key = autostartKey(sourceId);
      flagged = sessionStorage.getItem(key) === "1";
      sessionStorage.removeItem(key);
    } catch {
      flagged = false;
    }
    autostart.current = flagged;
  }, [sourceId]);

  const { runChain } = runner;
  useEffect(() => {
    void Promise.resolve().then(async () => {
      const { detail: loaded } = await refresh();
      if (!autostart.current || !loaded) return;
      autostart.current = false;
      if (loaded.source.status === "uploaded") void runChain("extract");
      else if (loaded.source.status === "extracted") void runChain("parse");
    });
  }, [refresh, runChain]);

  // Follow work running on the server while this page is not itself waiting on a request.
  const serverWorking = Boolean(detail && IN_PROGRESS_STATUSES.has(detail.source.status));
  usePolling(serverWorking && !runner.busy && !indexing.running, refresh);

  // A stage change this page did not cause itself (work started elsewhere, seen by polling) gets one notice.
  const trackedSource = useMemo(() => (detail ? [detail.source] : null), [detail]);
  useStageTransitions(trackedSource, notice, {
    suppress: runner.busy || indexing.running || indexing.stopReason === "indexed",
    linkToFile: false,
  });

  const [reviewing, setReviewing] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportDoc, setExportDoc] = useState<{ title: string; doc: AcceptedRevisionExport } | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const source = detail?.source ?? null;
  const effectiveSource = useMemo(() => {
    if (!source) return null;
    if (runner.running) return { ...source, status: runner.running === "extract" ? "extracting" : "parsing" };
    if (indexing.running) return { ...source, status: "indexing" };
    return source;
  }, [source, runner.running, indexing.running]);
  const view = effectiveSource ? toStageView(effectiveSource, detail) : null;
  const revisions = source ? describeRevisions(source, detail) : null;

  const blocks = useMemo(() => detail?.latest_extraction?.blocks ?? [], [detail]);
  const blocksById = useMemo(() => new Map(blocks.map((block) => [block.block_id, block])), [blocks]);
  const labels = useMemo(() => blockLabels(blocks), [blocks]);
  const numbers = useMemo(() => numberBlocks(blocks), [blocks]);

  // ---- Citation from a Fit Check report ("Open in source") -------------------------------------------------
  const citeTarget = useMemo(() => parseCiteParam(cite, rev), [cite, rev]);
  const [citeQuote, setCiteQuote] = useState<{ quote: string | null; done: boolean }>({ quote: null, done: false });
  useEffect(() => {
    if (!citeTarget) return;
    let cancelled = false;
    void (async () => {
      let quote: string | null = null;
      if (citeTarget.revisionId) {
        try {
          const response = await fetch(`/api/experiences/${sourceId}/revisions/${citeTarget.revisionId}/export`);
          const data = (await response.json().catch(() => null)) as AcceptedRevisionExport | null;
          if (response.ok && data?.source_blocks) quote = quoteFromBlocks(data.source_blocks, citeTarget.span);
        } catch {
          quote = null;
        }
      }
      if (!cancelled) setCiteQuote({ quote, done: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [citeTarget, sourceId]);
  const citation: CitationResolution | null =
    citeTarget && citeQuote.done && detail ? resolveCitation(blocks, citeTarget, citeQuote.quote) : null;

  // ---- Review workspace ------------------------------------------------------------------------------------
  const draft = editor.draft;
  const hasDraft = Boolean(draft && detail?.latest_revision?.status === "draft");
  const showReview = Boolean(view && hasDraft && (reviewing || view.primary?.id !== "start-review"));

  const highlights = useMemo(() => {
    const map = evidenceHighlights(showReview ? draft : null);
    if (citation?.kind === "highlight") {
      const list = map.get(citation.span.block_id) ?? [];
      map.set(citation.span.block_id, [...list, { key: CITATION_KEY, start: citation.span.start, end: citation.span.end }]);
    }
    return map;
  }, [draft, showReview, citation]);

  const gate = useMemo(
    () => (draft && detail ? buildApprovalGate(draft, detail, editor.fieldErrors, editor.dirty) : null),
    [draft, detail, editor.fieldErrors, editor.dirty],
  );
  const unassigned = useMemo(() => new Set(gate?.unassignedBlockIds ?? []), [gate]);
  const targets = useMemo(() => evidenceTargets(draft, REVIEW.noSpan), [draft]);

  const documentRef = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [selecting, setSelecting] = useState<EvidenceRef | null>(null);
  const [emphasised, setEmphasised] = useState<string | null>(null);
  const [selectionHint, setSelectionHint] = useState<string | null>(null);

  // Remember the last selection inside the document so the keyboard "Attach selection" control can use it.
  useEffect(() => {
    if (!showReview) return;
    const onChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (documentRef.current?.contains(range.commonAncestorContainer)) lastRange.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [showReview]);

  const openPopoverFor = (range: Range | null, fromControl: boolean) => {
    const container = documentRef.current;
    if (!container || !range || range.collapsed) {
      if (fromControl) setSelectionHint("Select text in one block of the document first.");
      return;
    }
    const result = rangeToSpan(container, range, (blockId) => blocksById.get(blockId)?.text);
    const anchor = range.getBoundingClientRect();
    if (result.ok) {
      setSelectionHint(null);
      setPopover({ kind: "attach", span: result.span, text: result.text, blockLabel: labels.get(result.span.block_id) ?? "block", anchor });
    } else if (result.reason === "cross-block") {
      setPopover({ kind: "cross-block", anchor });
    } else if (fromControl) {
      setSelectionHint("Select text in one block of the document first.");
    }
  };

  const onPointerSelect = () => {
    if (!showReview || popover) return;
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      openPopoverFor(selection.getRangeAt(0), false);
    });
  };

  const closePopover = () => {
    setPopover(null);
    documentRef.current?.focus({ preventScroll: true });
  };

  const addSpan = (target: EvidenceRef, span: SourceSpan) => {
    const item = draft?.experiences[target.experienceIndex]?.evidence_items[target.evidenceIndex];
    editor.addEvidenceSpan(target.experienceIndex, target.evidenceIndex, span);
    setEmphasised(evidenceSpanKey(target.experienceIndex, target.evidenceIndex, item?.source_refs.length ?? 0));
    setSelecting(null);
    setPopover(null);
    lastRange.current = null;
    window.getSelection()?.removeAllRanges();
    documentRef.current?.focus({ preventScroll: true });
  };

  const showSpan = (experienceIndex: number, evidenceIndex: number, spanIndex: number) => {
    const key = evidenceSpanKey(experienceIndex, evidenceIndex, spanIndex);
    setEmphasised(key);
    if (!scrollToId(spanAnchorId(key))) {
      const span = draft?.experiences[experienceIndex]?.evidence_items[evidenceIndex]?.source_refs[spanIndex];
      if (span) scrollToId(blockAnchorId(span.block_id));
    }
  };

  const selectFromSource = (experienceIndex: number, evidenceIndex: number) => {
    setSelecting({ experienceIndex, evidenceIndex });
    setSelectionHint("Select the sentence in the document that supports this item, then choose Add span.");
    documentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    documentRef.current?.focus({ preventScroll: true });
  };

  /** Local removals are reported with an Undo action that lives as long as the notice. */
  const offerUndo = (text: string, token: UndoToken | null) => {
    if (token) notice.success(text, { action: { label: NOTICES.undo, onClick: token.restore } });
  };

  const jumpTo = (target: GateTarget) => {
    if (target.kind === "evidence") scrollToId(evidenceAnchorId(target.experienceIndex, target.evidenceIndex));
    else if (target.kind === "experience") scrollToId(experienceAnchorId(target.experienceIndex));
    else if (target.kind === "block") scrollToId(blockAnchorId(target.blockId));
  };

  // A different draft revision starts with no emphasised span.
  const draftRevisionId = draft?.revision.revision_id ?? null;
  useEffect(() => {
    void Promise.resolve().then(() => setEmphasised(null));
  }, [draftRevisionId]);

  // Bring the document into view when the user starts reviewing.
  useEffect(() => {
    if (reviewing) requestAnimationFrame(() => documentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [reviewing]);

  // Scroll to a resolved citation once the document renders.
  const scrolledCitation = useRef(false);
  useEffect(() => {
    if (citation?.kind !== "highlight" || scrolledCitation.current) return;
    scrolledCitation.current = true;
    requestAnimationFrame(() => scrollToId(spanAnchorId(CITATION_KEY)));
  }, [citation]);

  // ---- Lifecycle actions -----------------------------------------------------------------------------------
  const latestApprovedId = source?.latest_approved_revision_id ?? null;

  const loadExport = async (revisionId: string | null | undefined) => {
    if (!revisionId) return;
    setActionBusy("inspect-json");
    setActionError(null);
    try {
      const response = await fetch(`/api/experiences/${sourceId}/revisions/${revisionId}/export`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(readApiErrorMessage(data, "The accepted JSON could not be loaded."));
        return;
      }
      const number = versionForRevision(revisionId, detail?.approved_versions)?.version_number;
      setExportDoc({ title: number ? `Version ${number} · accepted JSON` : "Accepted JSON", doc: data as AcceptedRevisionExport });
    } catch {
      setActionError("The accepted JSON could not be loaded. Check your connection and try again.");
    } finally {
      setActionBusy(null);
    }
  };

  /** "Edit · starts draft for version N+1": a new draft from the latest approved revision. The searchable version is unchanged. */
  const createDraftFromApproved = async () => {
    setActionBusy("edit-approved");
    setActionError(null);
    try {
      const response = await fetch(`/api/experiences/${sourceId}/draft-from-approved`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(latestApprovedId ? { approved_revision_id: latestApprovedId } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(readApiErrorMessage(data, "A new draft could not be created."));
        return;
      }
      setExportDoc(null);
      setReviewing(true);
      await refresh();
      void refreshSummary();
      notice.success(NOTICES.draftCreated((revisions?.latestApproved?.versionNumber ?? 0) + 1));
    } catch {
      setActionError("A new draft could not be created. Check your connection and try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const remove = async () => {
    setActionBusy("delete");
    setDeleteError(null);
    try {
      const response = await fetch(`/api/experiences/${sourceId}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(readApiErrorMessage(data, "The file could not be deleted."));
        return;
      }
      setConfirming(null);
      if (data?.status === "cleanup-pending") {
        await refresh();
        void refreshSummary();
        notice.info(NOTICES.deletedPending(source?.file_name ?? "the file"));
        return;
      }
      await refreshSummary();
      // The notice provider lives in the root layout, so this notice is still showing on the list.
      notice.success(NOTICES.deleted(source?.file_name ?? "the file"));
      router.push("/experience");
    } catch {
      setDeleteError("The file could not be deleted. Check your connection and try again.");
    } finally {
      setActionBusy(null);
    }
  };

  const busy = runner.busy || indexing.running || Boolean(actionBusy) || editor.phase !== null;

  const runAction = (id: ActionId) => {
    setActionError(null);
    switch (id) {
      case "continue-processing":
        void runner.runChain(source?.status === "extracted" ? "parse" : "extract");
        break;
      case "retry-extract":
        void runner.runChain("extract");
        break;
      case "retry-parse":
      case "reparse":
        void runner.runChain("parse");
        break;
      case "start-review":
      case "continue-review":
        setReviewing(true);
        break;
      case "index-now":
      case "continue-indexing":
      case "retry-index":
        // Only ever reached from a click: approval and page loads never index.
        void indexing.runIndexSequence(latestApprovedId);
        break;
      case "edit-approved":
        void createDraftFromApproved();
        break;
      case "inspect-json":
        void loadExport(latestApprovedId ?? source?.active_revision_id);
        break;
      case "delete":
        setDeleteError(null);
        setConfirming("delete");
        break;
      case "retry-delete":
        setDeleteError(null);
        setConfirming("retry-delete");
        break;
      default:
        break;
    }
  };

  // ---- Render ----------------------------------------------------------------------------------------------
  if (!detail || !source || !view || !effectiveSource) {
    return (
      <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
        {loading ? (
          <p className="rounded-panel border border-hairline bg-card p-6 text-body-md text-ink-secondary">Loading this file…</p>
        ) : (
          <div role="alert" className="rounded-panel border border-red-border bg-red-wash p-5">
            <p className="text-body-md text-ink">{loadError ?? "This file could not be loaded."}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void refresh()}>Try again</Button>
              <ButtonLink href="/experience" variant="ghost">
                Back to Experience
              </ButtonLink>
            </div>
          </div>
        )}
      </main>
    );
  }

  const indexDisabled = indexing.refreshRequired;
  const editVisible = source.status === "indexed" && view.overflow.some((item) => item.id === "edit-approved");
  const overflow: OverflowItem[] = view.overflow
    .filter((item) => !(editVisible && item.id === "edit-approved"))
    .map((item) => {
      if (item.id === "download-original") {
        return { id: item.id, label: item.label, href: `/api/experiences/${sourceId}/file`, download: true };
      }
      return {
        id: item.id,
        label: item.label,
        destructive: item.id === "delete",
        disabled: busy || (item.id === "reparse" && runner.busy),
        onSelect: () => runAction(item.id),
      };
    });

  const renderPrimary = (action: StageAction | null) => {
    if (runner.running) {
      return (
        <Button variant="primary" busy>
          {runner.running === "extract" ? "Extracting…" : "Parsing…"}
        </Button>
      );
    }
    if (indexing.running) {
      return (
        <Button variant="primary" busy>
          <BoltIcon size={16} />
          Indexing…
        </Button>
      );
    }
    if (showReview) {
      const saving = editor.phase === "saving";
      return (
        <Button variant="primary" onClick={() => void editor.save()} busy={saving} disabled={!saving && (!editor.dirty || busy)}>
          {saving ? REVIEW.saving : REVIEW.saveDraft}
        </Button>
      );
    }
    if (!action) return null;
    if (action.id === "try-jd") {
      return (
        <ButtonLink href="/" variant="primary">
          {action.label}
          <ArrowIcon size={16} />
        </ButtonLink>
      );
    }
    const disabled = busy || (INDEX_ACTIONS.has(action.id) && indexDisabled);
    return (
      <Button variant="primary" onClick={() => runAction(action.id)} disabled={disabled}>
        {INDEX_ACTIONS.has(action.id) && <BoltIcon size={16} />}
        {action.label}
      </Button>
    );
  };

  const secondary = (() => {
    if (view.secondary?.id === "upload-different") {
      return (
        <ButtonLink href="/experience" variant="secondary">
          {ACTION_LABELS["upload-different"]}
        </ButtonLink>
      );
    }
    if (editVisible) {
      return (
        <>
          {/* Tooltips are visual only, so the same note is the button's description for assistive technology. */}
          <span id="edit-approved-note" className="sr-only">
            {EDIT_APPROVED_NOTE}
          </span>
          <Hint label={EDIT_APPROVED_NOTE}>
            <Button
              onClick={() => runAction("edit-approved")}
              busy={actionBusy === "edit-approved"}
              disabled={busy}
              aria-describedby="edit-approved-note"
            >
              {actionBusy === "edit-approved" ? "Creating draft…" : editApprovedLabel((revisions?.latestApproved?.versionNumber ?? 0) + 1)}
            </Button>
          </Hint>
        </>
      );
    }
    return null;
  })();

  const failedStep = view.steps.find((step) => step.state === "failed");
  const processing = runner.running || source.status === "extracting" || source.status === "parsing";
  // One sentence at most: the stage helper, or the instruction for work this page itself is doing.
  const guidance = showReview
    ? REVIEW_GUIDANCE
    : indexing.running
      ? INDEXING.keepOpen
      : view.tone === "failed" && view.primary
        ? `Choose ${view.primary.label} to run this stage again.`
        : view.helper;

  // Type, size and one dated fact. The searchable version is added only when the label does not already name a version.
  const metaParts = [
    fileTypeLabel(source.file_type, source.file_name),
    formatFileSize(source.file_size),
    revisions?.searchable && !/version \d/i.test(view.label) ? `Searchable: ${revisions.searchable.label.toLowerCase()}` : null,
    view.metaFact ?? (source.created_at ? `Uploaded ${formatTimestamp(source.created_at)}` : null),
  ].filter(Boolean);

  const progress = indexing.progress;
  const headerDetail = (
    <div className="mt-3 space-y-2 empty:hidden">
      {processing && (
        <div className="rounded-control bg-evidence-wash p-3 text-body-md text-evidence-text">
          <p className="font-semibold">{effectiveSource.status === "parsing" ? PROCESSING.parsing : PROCESSING.extracting}</p>
        </div>
      )}
      {(indexing.running || (progress && indexing.stopReason !== "indexed")) && (
        <div className="rounded-control bg-evidence-wash p-3 text-body-md text-evidence-text">
          <p className="font-semibold">
            {progress ? indexingProgress(progress.prepared_chunks, progress.total_chunks) : INDEXING.starting}
          </p>
          {progress && progress.total_chunks > 0 && (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"
              role="progressbar"
              aria-label="Chunks prepared"
              aria-valuemin={0}
              aria-valuemax={progress.total_chunks}
              aria-valuenow={progress.prepared_chunks}
            >
              <div className="h-full rounded-full bg-cobalt" style={{ width: `${Math.round((progress.prepared_chunks / progress.total_chunks) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {indexing.stopReason === "no-progress" && <p className="text-body-md text-amber-text">{INDEXING.stalled}</p>}
      {indexing.error && (
        <p role="alert" className="text-body-md text-red">
          {indexing.error}
        </p>
      )}
      {runner.notice && <p className="text-body-md text-ink-secondary">{runner.notice}</p>}
      {source.status !== "failed" &&
        (["extract", "parse"] as const).map((stage) =>
          runner.errors[stage] ? (
            <p key={stage} role="alert" className="text-body-md text-red">
              {runner.errors[stage]}
            </p>
          ) : null,
        )}
      {actionError && (
        <p role="alert" className="text-body-md text-red">
          {actionError}
        </p>
      )}
    </div>
  );

  const stale = indexing.conflict?.code === "index-candidate-stale";
  const conflictLatest = revisions?.latestApproved?.versionNumber ?? null;
  const conflictNotIndexed = indexing.conflict
    ? versionForRevision(indexing.conflict.attemptedRevisionId, detail.approved_versions)?.version_number ?? null
    : null;

  return (
    <main className={`mx-auto w-full px-4 py-6 sm:px-6 ${showReview || citation ? "max-w-[1536px]" : "max-w-[1040px]"}`}>
      <p aria-live="polite" className="sr-only">
        {view.label}
      </p>

      <StageHeader
        fileName={source.file_name}
        meta={metaParts.join(" · ")}
        view={view}
        label={view.label}
        guidance={guidance}
        detail={headerDetail}
        primary={renderPrimary(view.primary)}
        secondary={secondary}
        status={
          showReview ? (
            editor.dirty ? (
              <Pill tone="amber">{REVIEW.unsaved}</Pill>
            ) : editor.savedVersion !== null ? (
              <Pill tone="green">{REVIEW.saved}</Pill>
            ) : null
          ) : null
        }
        overflow={overflow}
      />

      {view.tone === "failed" && failedStep && !runner.busy && (
        <FailureInset stageName={failedStep.name} message={source.failure?.message ?? ""} code={source.failure?.code} />
      )}

      {indexing.conflict && (
        <ConflictPanel
          stale={stale}
          message={indexing.conflict.message}
          searchable={revisions?.searchable?.versionNumber ?? null}
          latest={conflictLatest}
          notIndexed={conflictNotIndexed}
          refreshRequired={indexing.refreshRequired}
          refreshError={indexing.refreshError}
          canIndexLatest={Boolean(latestApprovedId && source.actions?.includes("index") && latestApprovedId !== indexing.conflict.attemptedRevisionId)}
          busy={busy}
          onIndexLatest={() => {
            indexing.dismissConflict();
            void indexing.runIndexSequence(latestApprovedId);
          }}
          onLookFirst={() => void loadExport(latestApprovedId)}
          onRefresh={() => void indexing.manualRefresh()}
          onDismiss={indexing.dismissConflict}
        />
      )}

      {confirming && (
        <div className="mt-4">
          <ConfirmInline
            title={confirming === "retry-delete" ? DELETE_CONFIRM.retryTitle : DELETE_CONFIRM.title(source.file_name)}
            body={confirming === "retry-delete" ? DELETE_CONFIRM.retryBody : DELETE_CONFIRM.body}
            confirmLabel={confirming === "retry-delete" ? DELETE_CONFIRM.retryConfirm : DELETE_CONFIRM.confirm}
            cancelLabel={DELETE_CONFIRM.cancel}
            busy={actionBusy === "delete"}
            error={deleteError}
            onConfirm={() => void remove()}
            onCancel={() => {
              setConfirming(null);
              setDeleteError(null);
            }}
          />
        </div>
      )}

      {exportDoc && <AcceptedJsonPanel title={exportDoc.title} exportDoc={exportDoc.doc} onClose={() => setExportDoc(null)} />}

      {citation?.kind === "different-version" && (
        <section role="note" className="mt-4 rounded-panel border border-amber-border bg-amber-wash p-4">
          <p className="text-body-md text-ink">{CITATION.differentVersion}</p>
          {citation.quote ? (
            <blockquote className="mt-2 border-l-2 border-amber pl-3 text-body-md whitespace-pre-wrap text-ink">{citation.quote}</blockquote>
          ) : (
            <p className="mt-2 text-body-sm text-ink-muted">The quoted text could not be loaded for this citation.</p>
          )}
        </section>
      )}
      {citation?.kind === "highlight" && <p className="mt-4 text-body-md text-ink-secondary">{CITATION.highlighted}</p>}

      {showReview && draft && gate ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            {selectionHint && (
              <p className="mb-2 rounded-control border border-evidence-border bg-evidence-wash px-3 py-2 text-body-md text-evidence-text">
                {selectionHint}
              </p>
            )}
            <DocumentPane
              ref={documentRef}
              blocks={blocks}
              highlights={highlights}
              unassigned={unassigned}
              emphasised={emphasised}
              onPointerSelect={onPointerSelect}
              toolbar={
                <Button className="min-h-8 px-3 py-1" onClick={() => openPopoverFor(lastRange.current, true)}>
                  {REVIEW.attachSelection}
                </Button>
              }
            />
          </div>
          <div className="min-w-0 space-y-4 lg:col-span-4">
            <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:space-y-4 lg:overflow-auto lg:pr-1">
              <ApprovalGate
                gate={gate}
                acknowledgements={draft.review_acknowledgements}
                busy={busy}
                phase={editor.phase}
                blockLabelFor={(blockId) => labels.get(blockId) ?? blockId}
                onAcknowledge={editor.acknowledge}
                onJump={jumpTo}
                onReload={() => void editor.reload()}
                onApprove={() => void editor.approve()}
              />
              <div className="mt-4 lg:mt-0">
                <ExperienceRail
                  draft={draft}
                  blocks={blocks}
                  blockNumbers={numbers}
                  fieldErrors={editor.fieldErrors}
                  selecting={selecting}
                  handlers={{
                    updateExperience: editor.updateExperience,
                    updateEvidence: editor.updateEvidence,
                    removeEvidence: (experienceIndex, evidenceIndex) =>
                      offerUndo(NOTICES.evidenceRemoved, editor.removeEvidence(experienceIndex, evidenceIndex)),
                    removeEvidenceSpan: (experienceIndex, evidenceIndex, spanIndex) =>
                      offerUndo(NOTICES.spanRemoved, editor.removeEvidenceSpan(experienceIndex, evidenceIndex, spanIndex)),
                    showSpan,
                    selectFromSource,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : citation?.kind === "highlight" ? (
        <div className="mt-6">
          <DocumentPane blocks={blocks} highlights={highlights} />
        </div>
      ) : null}

      {popover && (
        <SpanPopover
          state={popover}
          targets={targets}
          preferred={selecting}
          onAdd={addSpan}
          onClose={closePopover}
        />
      )}
    </main>
  );
}
