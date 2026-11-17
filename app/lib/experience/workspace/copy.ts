/**
 * The JD Fit Check copy deck. Components and tests read strings from here so copy changes stay in one place.
 *
 * Every stage-facing string has one of four jobs (tighten-workspace-copy-and-feedback, design Decision 1):
 * - label: names a state. Always shown.
 * - instruction: the next step. Shown only while there is one.
 * - fact: the one state-specific fact worth stating.
 * - explanation: how the product works. Shown only in "How it works" and the Fit Check empty state, never in a
 *   stage helper, row or subtitle. `EXPLANATIONS` lists them so tests can enforce that.
 */

export const PRODUCT_NAME = "JD Fit Check";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export const NAV = {
  fitCheck: "Fit Check",
  experience: "Experience",
} as const;

export function indexedPill(count: number): string {
  return count === 0 ? "No files indexed" : `${plural(count, "file", "files")} indexed`;
}

export const STAGE_NAMES = ["Upload", "Extract", "Parse", "Review", "Approve", "Index"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

/** Explanations: one sentence per stage. Rendered only by "How it works" and the Fit Check empty state. */
export const HOW_IT_WORKS: ReadonlyArray<{ name: StageName; description: string }> = [
  { name: "Upload", description: "Your file is kept privately and nothing is searchable yet." },
  { name: "Extract", description: "Text is pulled out and frozen as the source of every citation." },
  { name: "Parse", description: "Projects and evidence are proposed, each tied to a sentence in the text." },
  { name: "Review", description: "You check and fix the proposal, keeping only what the file says." },
  { name: "Approve", description: "The reviewed version is frozen; indexing it is a separate step you start." },
  { name: "Index", description: "Embeddings are prepared and the file becomes searchable in Fit Check, replacing any earlier indexed version." },
];

export const EXPERIENCE_PAGE = {
  title: "Experience",
  howItWorks: "How it works",
  empty: "No experience files yet. Upload one to get started.",
  loadError: "Your experience files could not be loaded.",
} as const;

export const DROP_ZONE = {
  title: "Upload experience file",
  body: "Drop a DOCX or selectable-text PDF here, or browse. Max 10 MB.",
  browse: "Browse files",
  uploading: "Uploading…",
  accept: ".pdf,.docx",
} as const;

export const ACTION_LABELS = {
  "start-processing": "Start processing",
  "continue-processing": "Continue processing",
  "retry-extract": "Retry extract",
  "retry-parse": "Retry parse",
  "start-review": "Start review",
  "continue-review": "Continue review",
  "index-now": "Index now",
  "continue-indexing": "Continue indexing",
  "retry-index": "Retry indexing",
  "edit-approved": "Edit",
  reparse: "Re-parse into a new draft",
  "download-original": "Download original",
  "inspect-json": "Inspect accepted JSON",
  delete: "Delete",
  "retry-delete": "Retry cleanup",
  "upload-different": "Upload a different file",
  open: "Open",
  refresh: "Refresh state",
} as const;

export type ActionId = keyof typeof ACTION_LABELS;

export function editApprovedLabel(nextVersion: number) {
  return `Edit · starts draft for version ${nextVersion}`;
}

/** One stage's copy. The keys carry the class: a helper is either an instruction or a fact, never both. */
export interface StageCopy {
  label: string;
  instruction?: string;
  fact?: string;
}

const LEAVE = "You can leave this page.";
const REVIEW_INSTRUCTION = "Check each experience against the source, then approve.";

function draftFact(experiences: number, evidence: number, warnings: number, unassigned: number) {
  const found = `We found ${plural(experiences, "experience", "experiences")} and ${plural(evidence, "evidence item", "evidence items")}`;
  const toCheck = [
    warnings > 0 ? plural(warnings, "extraction warning", "extraction warnings") : null,
    unassigned > 0 ? plural(unassigned, "unassigned block", "unassigned blocks") : null,
  ].filter(Boolean);
  return toCheck.length > 0 ? `${found}, with ${toCheck.join(" and ")} to check.` : `${found}.`;
}

/** Per-state stage copy (design Decision 2). `version` is the approved version number shown in labels. */
export const STAGE_COPY = {
  uploaded: { label: "Uploaded", instruction: "Start processing to read the text." },
  extracting: { label: "Extracting text", instruction: LEAVE },
  extracted: { label: "Text extracted", instruction: "Continue processing to find the projects in it." },
  parsing: { label: "Finding projects and evidence", instruction: LEAVE },
  draftNew: (draftName: string, counts: { experiences: number; evidence: number; warnings: number; unassigned: number } | null): StageCopy =>
    counts
      ? { label: `${draftName} · ready for review`, fact: draftFact(counts.experiences, counts.evidence, counts.warnings, counts.unassigned) }
      : { label: `${draftName} · ready for review`, instruction: REVIEW_INSTRUCTION },
  draftStarted: (draftName: string): StageCopy => ({ label: `${draftName} · in review`, instruction: REVIEW_INSTRUCTION }),
  indexedWithDraft: (version: number): StageCopy => ({
    label: `Indexed · version ${version} · new draft in review`,
    fact: "The indexed version stays searchable until the new draft is approved and indexed.",
  }),
  approved: (version: number): StageCopy => ({
    label: `Version ${version} approved · not indexed`,
    instruction: "Index now to make it searchable in Fit Check.",
  }),
  indexing: (version: number | null): StageCopy => ({
    label: version === null ? "Indexing" : `Indexing version ${version}`,
    instruction: "Indexing stopped part-way; continue indexing to finish.",
  }),
  indexed: (version: number, onPage: { experiences: number; evidence: number; since: string } | null): StageCopy => ({
    label: `Indexed · version ${version}`,
    fact: onPage
      ? `${plural(onPage.experiences, "experience", "experiences")} and ${plural(onPage.evidence, "evidence item", "evidence items")}, searchable since ${onPage.since}.`
      : undefined,
  }),
  failed: (stage: string): StageCopy => ({ label: `${stage} failed` }),
  cleanupPending: { label: "Deleted · cleanup pending", instruction: "Retry cleanup to remove the stored original." },
  unavailable: { label: "Unavailable", fact: "This file can't be worked on right now." },
} as const;

/** The review instruction, also used as the file page's guidance while the review workspace is open. */
export const REVIEW_GUIDANCE = REVIEW_INSTRUCTION;

/** Explanation sentences that must never appear in a stage helper, row or subtitle. */
export const EXPLANATIONS: readonly string[] = [
  ...HOW_IT_WORKS.map((stage) => stage.description),
  "Indexing prepares embeddings",
  "cites exact sentence spans",
  "Nothing is searchable until you approve",
  "Each one moves through six stages",
];

export const PROCESSING = {
  extracting: "Step 1 of 2 · extracting",
  parsing: "Step 2 of 2 · parsing",
  leave: LEAVE,
  alreadyRunning: "This stage is already running elsewhere. Showing its latest state.",
} as const;

/** Transient outcome notices (design Decision 5). Success and information only; errors stay on the page. */
export const NOTICES = {
  draftSaved: "Draft saved.",
  approved: (version: number | null) => (version === null ? "Version approved." : `Version ${version} approved.`),
  searchable: (version: number | null) =>
    version === null ? "The file is searchable in Fit Check." : `Version ${version} is searchable in Fit Check.`,
  /** The searchable notice's action: the only shortcut from an indexing outcome to Fit Check. */
  tryJd: "Try a job description",
  draftCreated: (version: number) => `Draft for version ${version} created.`,
  evidenceRemoved: "Evidence removed.",
  spanRemoved: "Span removed.",
  undo: "Undo",
  uploaded: (fileName: string) => `Uploaded ${fileName}.`,
  deleted: (fileName: string) => `Deleted ${fileName}.`,
  deletedPending: (fileName: string) => `Deleted ${fileName}; the stored original is still to be removed.`,
} as const;

export const GATE = {
  title: "Before you can approve",
  warnings: (count: number) => `I've read the ${plural(count, "extraction warning", "extraction warnings")}`,
  unassigned: (count: number, labels: string[]) =>
    `I've checked the ${plural(count, "unassigned block", "unassigned blocks")} (${labels.join(", ")}) and they don't belong in any experience`,
  missingSpans: (count: number) =>
    `${plural(count, "evidence item", "evidence items")} still ${count === 1 ? "needs" : "need"} a source span`,
  nothingToIndex: "Nothing to index: keep at least one evidence item",
  footer: (version: number) => `Approving freezes version ${version}. Indexing is a separate step you start yourself.`,
  approveLocked: (remaining: number) => `Approve · ${plural(remaining, "item", "items")} left`,
  saveAndApprove: "Save & approve",
  approve: "Approve",
  saving: "Saving…",
  approving: "Approving…",
  staleVersion: "This draft changed since you opened it. Reload the current draft before approving.",
  reload: "Reload draft",
} as const;

export const MISSING_SPAN = {
  body: "No source span. Select the sentence in the document that says this, or remove the item.",
  select: "Select from source",
  remove: "Remove",
} as const;

export const REVIEW = {
  saveDraft: "Save draft",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  saved: "All changes saved",
  documentTitle: "Source document",
  railTitle: "Experiences",
  unassigned: "unassigned",
  attachSelection: "Attach selection",
  selectWithinBlock: "Select text within one block. Add further spans one block at a time.",
  addSpan: "Add span",
  cancel: "Cancel",
  noSpan: "(no span)",
  sourceLink: (blockLabel: string) => `Source: ${blockLabel}`,
  fromSource: (blockNumber: number) => `from source, block ${blockNumber}`,
  noDraft: "There is no draft to review for this file.",
} as const;

export function indexingProgress(prepared: number, total: number) {
  return `Indexing · ${prepared} of ${total} chunks prepared`;
}

export const INDEXING = {
  keepOpen: "Keep this page open until it finishes.",
  stalled: "Indexing stopped making progress. Choose Continue indexing to try again.",
  starting: "Indexing · preparing chunks",
} as const;

export const EDIT_APPROVED_NOTE = "Your searchable version stays unchanged until the new draft is approved and indexed.";

export function conflictCopy(input: { latest: number | null; notIndexed: number | null; searchable: number | null }) {
  const latest = input.latest === null ? "a newer version" : `version ${input.latest}`;
  const notIndexed = input.notIndexed === null ? "the version you started" : `version ${input.notIndexed}`;
  const searchable =
    input.searchable === null
      ? "No version is searchable in Fit Check yet."
      : `Version ${input.searchable} is still the one Fit Check searches.`;
  return {
    title: "A newer approved version exists.",
    body: `${capitalise(latest)} was approved after this indexing started, so ${notIndexed} was not indexed. The state below has been refreshed. ${searchable}`,
    searchableNow: input.searchable === null ? "Searchable now · none" : `Searchable now · version ${input.searchable}`,
    latestApproved: input.latest === null ? "Latest approved · unknown" : `Latest approved · version ${input.latest}`,
    notIndexedFact: input.notIndexed === null ? "Not indexed · superseded" : `Not indexed · version ${input.notIndexed} (superseded)`,
    indexLatest: input.latest === null ? "Index latest version" : `Index version ${input.latest}`,
    lookFirst: input.latest === null ? "Look at the latest version first" : `Look at version ${input.latest} first`,
  };
}

export const CONFLICT = {
  refreshFailed: (message: string) => `The state could not be refreshed: ${message} Indexing stays stopped until a refresh succeeds.`,
  refresh: "Refresh state",
} as const;

export const DELETE_CONFIRM = {
  title: (fileName: string) => `Delete ${fileName}?`,
  body: "The file stops being searchable in Fit Check immediately. Its review history and the original upload are removed.",
  confirm: "Delete file",
  retryTitle: "Retry storage cleanup?",
  retryBody: "The file is already not searchable. This retries removing the stored original.",
  retryConfirm: "Retry cleanup",
  cancel: "Cancel",
} as const;

/** The in-page confirmation shown when an in-app link is activated while the draft has unsaved edits. */
export const LEAVE_GUARD = {
  title: "Leave without saving?",
  body: "This draft has unsaved changes.",
  leave: "Leave without saving",
  save: "Save and leave",
  stay: "Stay",
  saving: "Saving…",
} as const;

export const FAILURE = {
  title: (stage: string) => `${stage} failed`,
  fallback: "Something went wrong in this stage.",
} as const;

export const CITATION = {
  differentVersion:
    "This citation comes from a version whose text isn't shown here, so it can't be highlighted. The quoted text is:",
  highlighted: "Cited passage highlighted below.",
} as const;

export const FIT_CHECK = {
  title: "Fit Check",
  emptyTitle: "Fit Check needs at least one indexed experience file",
  emptyBody:
    "Upload a DOCX or PDF that describes your projects. You'll review what we find in it, approve it, and index it. About ten minutes the first time. After that, paste any job description here.",
  emptyAction: "Upload experience file",
  gapsNote:
    "A gap means your indexed files don't say it, not that you can't do it. If you have done it, add it to your experience file and re-upload.",
  diagnosticsSummary: "Diagnostics · model, prompt versions, retrieval counts",
} as const;

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Nov 14, 2026, 3:05 PM" in the viewer's locale and zone; falls back to the raw value. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatFileSize(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileTypeLabel(fileType: string | undefined, fileName: string): string {
  const extension = fileName.split(".").pop()?.toUpperCase();
  if (extension === "DOCX" || extension === "PDF") return extension;
  if (fileType?.includes("pdf")) return "PDF";
  if (fileType?.includes("word")) return "DOCX";
  return extension ?? "File";
}
