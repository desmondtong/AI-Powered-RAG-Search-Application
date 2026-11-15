"use client";

import { useCallback, useRef, useState } from "react";
import type { Notice } from "@/app/components/NoticeProvider";
import { NOTICES } from "@/app/lib/experience/workspace/copy";
import {
  cloneRevision,
  readApiErrorCode,
  readApiErrorMessage,
  readFieldErrors,
  type CanonicalRevision,
  type DraftFieldError,
  type EvidenceItem,
  type ExperienceEntry,
  type SourceDetail,
  type SourceSpan,
} from "@/app/lib/experience/workspace/types";

export type DraftPhase = "saving" | "approving" | null;

/** Restores one local removal. A no-op once a different draft revision is loaded. */
export interface UndoToken {
  restore: () => void;
}

/** A request-level error with no field errors still has to show in the gate, keyed by its code. */
function requestError(data: unknown, fallback: string): DraftFieldError {
  return { path: "", code: readApiErrorCode(data) ?? "request-failed", message: readApiErrorMessage(data, fallback) };
}

/**
 * Local draft editing for the review workspace. The draft comes from `latest_revision.draft_json.canonical_revision`
 * and is saved with the existing PATCH body `{ revision_id, expected_draft_version, draft }`. Approve sends only
 * `{ revision_id, expected_draft_version }`, so "Save & approve" saves first and approves with the `draft_version`
 * the save returned, sending no approval when the save fails (design Decision 8).
 */
export function useDraftEditor(
  sourceId: string,
  refresh: () => Promise<{ detail: SourceDetail | null; error: string | null }>,
  notice: Notice,
) {
  const [draft, setDraft] = useState<CanonicalRevision | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<DraftFieldError[]>([]);
  const [phase, setPhase] = useState<DraftPhase>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const dirtyRef = useRef(false);
  const draftRef = useRef<CanonicalRevision | null>(null);
  const inFlight = useRef(false);

  const commitDraft = (next: CanonicalRevision | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const markDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };

  /** Adopts the server draft unless the user has unsaved edits to the same revision (or `force` is set). */
  const adopt = useCallback((detail: SourceDetail | null, force = false) => {
    const canonical = detail?.latest_revision?.status === "draft" ? detail.latest_revision.draft_json?.canonical_revision ?? null : null;
    const current = draftRef.current;
    const sameRevision = Boolean(current && canonical && current.revision.revision_id === canonical.revision.revision_id);
    if (!force && dirtyRef.current && sameRevision) return;
    if (force || !sameRevision) {
      setFieldErrors([]);
      setSavedVersion(null);
    }
    commitDraft(canonical ? cloneRevision(canonical) : null);
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const update = useCallback((updater: (next: CanonicalRevision) => void) => {
    const current = draftRef.current;
    if (!current) return;
    const next = cloneRevision(current);
    updater(next);
    commitDraft(next);
    markDirty(true);
    setSavedVersion(null);
  }, []);

  const updateExperience = useCallback(
    (experienceIndex: number, updater: (experience: ExperienceEntry) => void) =>
      update((next) => {
        const experience = next.experiences[experienceIndex];
        if (experience) updater(experience);
      }),
    [update],
  );

  const updateEvidence = useCallback(
    (experienceIndex: number, evidenceIndex: number, updater: (item: EvidenceItem) => void) =>
      updateExperience(experienceIndex, (experience) => {
        const item = experience.evidence_items[evidenceIndex];
        if (item) updater(item);
      }),
    [updateExperience],
  );

  /**
   * Captures what a local removal took out and returns a token that puts it back at the same position through
   * `update`, which marks the draft dirty. Nothing is sent to the server either way.
   */
  const undoable = useCallback(
    <T,>(removed: T, reinsert: (next: CanonicalRevision, item: T) => void): UndoToken => {
      const revisionId = draftRef.current?.revision.revision_id;
      const kept = structuredClone(removed);
      return {
        restore: () => {
          if (!revisionId || draftRef.current?.revision.revision_id !== revisionId) return;
          update((next) => reinsert(next, structuredClone(kept)));
        },
      };
    },
    [update],
  );

  const removeEvidence = useCallback(
    (experienceIndex: number, evidenceIndex: number): UndoToken | null => {
      const item = draftRef.current?.experiences[experienceIndex]?.evidence_items[evidenceIndex];
      if (!item) return null;
      const token = undoable<EvidenceItem>(item, (next, restored) => {
        next.experiences[experienceIndex]?.evidence_items.splice(evidenceIndex, 0, restored);
      });
      updateExperience(experienceIndex, (experience) => {
        experience.evidence_items.splice(evidenceIndex, 1);
      });
      return token;
    },
    [updateExperience, undoable],
  );

  const addEvidenceSpan = useCallback(
    (experienceIndex: number, evidenceIndex: number, span: SourceSpan) =>
      updateEvidence(experienceIndex, evidenceIndex, (item) => {
        item.source_refs.push({ block_id: span.block_id, start: span.start, end: span.end });
      }),
    [updateEvidence],
  );

  const removeEvidenceSpan = useCallback(
    (experienceIndex: number, evidenceIndex: number, spanIndex: number): UndoToken | null => {
      const span = draftRef.current?.experiences[experienceIndex]?.evidence_items[evidenceIndex]?.source_refs[spanIndex];
      if (!span) return null;
      const token = undoable<SourceSpan>(span, (next, restored) => {
        next.experiences[experienceIndex]?.evidence_items[evidenceIndex]?.source_refs.splice(spanIndex, 0, restored);
      });
      updateEvidence(experienceIndex, evidenceIndex, (item) => {
        item.source_refs.splice(spanIndex, 1);
      });
      return token;
    },
    [updateEvidence, undoable],
  );

  /** Ticks `review_acknowledgements.warnings` or `review_acknowledgements.unassigned_blocks`. */
  const acknowledge = useCallback(
    (field: "warnings" | "unassigned_blocks", value: boolean) =>
      update((next) => {
        if (field === "warnings") next.review_acknowledgements.warnings = value;
        else next.review_acknowledgements.unassigned_blocks = value;
      }),
    [update],
  );

  /** PATCH the draft. Resolves to the saved `draft_version`, or null when the save was rejected. */
  const saveRequest = async (current: CanonicalRevision): Promise<number | null> => {
    const evidenceCount = current.experiences.reduce((count, experience) => count + experience.evidence_items.length, 0);
    if (evidenceCount === 0) {
      setFieldErrors([
        { path: "experiences", code: "no-usable-evidence", message: "Draft must contain at least one source-grounded evidence item." },
      ]);
      return null;
    }
    try {
      const response = await fetch(`/api/experiences/${sourceId}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision_id: current.revision.revision_id,
          expected_draft_version: current.revision.draft_version,
          draft: current,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // Server `field_errors` go next to their items; anything else (e.g. a stale version) shows in the gate.
        const errors = readFieldErrors(data);
        setFieldErrors(errors.length > 0 ? errors : [requestError(data, "Draft could not be saved.")]);
        return null;
      }
      const version = typeof data?.draft_version === "number" ? data.draft_version : current.revision.draft_version + 1;
      const latest = draftRef.current;
      if (latest) {
        const next = cloneRevision(latest);
        next.revision.draft_version = version;
        commitDraft(next);
      }
      markDirty(false);
      setFieldErrors([]);
      setSavedVersion(version);
      return version;
    } catch {
      setFieldErrors([{ path: "", code: "network", message: "The draft could not be saved. Check your connection and try again." }]);
      return null;
    }
  };

  const approveRequest = async (revisionId: string, expectedDraftVersion: number): Promise<boolean> => {
    try {
      const response = await fetch(`/api/experiences/${sourceId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision_id: revisionId, expected_draft_version: expectedDraftVersion }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const errors = readFieldErrors(data);
        setFieldErrors(errors.length > 0 ? errors : [requestError(data, "Approval failed.")]);
        return false;
      }
      setFieldErrors([]);
      return true;
    } catch {
      setFieldErrors([{ path: "", code: "network", message: "The approval did not reach the server. Check your connection and try again." }]);
      return false;
    }
  };

  /** "Save draft" in the header: save without approving. */
  const save = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft || inFlight.current) return null;
    inFlight.current = true;
    setPhase("saving");
    try {
      const version = await saveRequest(draft);
      if (version !== null) {
        await refresh();
        notice.success(NOTICES.draftSaved);
      }
      return version;
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, sourceId, notice]);

  /**
   * The gate button. With unsaved edits: PATCH, stop on any save error, then approve with the version the save
   * returned. Without: approve the current revision and draft version. Approval never starts indexing.
   */
  const approve = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft || inFlight.current) return false;
    inFlight.current = true;
    try {
      let expectedDraftVersion = draft.revision.draft_version;
      if (dirtyRef.current) {
        setPhase("saving");
        const savedDraftVersion = await saveRequest(draft);
        if (savedDraftVersion === null) return false;
        expectedDraftVersion = savedDraftVersion;
      }
      setPhase("approving");
      const approved = await approveRequest(draft.revision.revision_id, expectedDraftVersion);
      const { detail } = await refresh();
      if (approved) notice.success(NOTICES.approved(detail?.source.latest_approved_version_number ?? null));
      return approved;
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, sourceId, notice]);

  /** "Reload draft" after a stale-version error: discard local edits and take the server's current draft. */
  const reload = useCallback(async () => {
    const { detail } = await refresh();
    if (detail) adopt(detail, true);
  }, [refresh, adopt]);

  return {
    draft,
    dirty,
    fieldErrors,
    phase,
    savedVersion,
    adopt,
    updateExperience,
    updateEvidence,
    removeEvidence,
    addEvidenceSpan,
    removeEvidenceSpan,
    acknowledge,
    save,
    approve,
    reload,
  };
}
