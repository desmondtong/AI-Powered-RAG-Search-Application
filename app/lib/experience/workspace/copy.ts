/**
 * The JD Fit Check copy deck (design.md Decision 13). Components and tests read strings from here so copy changes
 * stay in one place.
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
  return count === 0 ? "No files indexed yet" : `${plural(count, "file", "files")} indexed and searchable`;
}

export const STAGE_NAMES = ["Upload", "Extract", "Parse", "Review", "Approve", "Index"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const STAGE_LEGEND: ReadonlyArray<{ name: StageName; description: string }> = [
  { name: "Upload", description: "Your file is kept privately. Nothing is searchable yet." },
  { name: "Extract", description: "Text is pulled out and frozen as the source of every citation." },
  { name: "Parse", description: "Projects and evidence are proposed, each tied to a sentence in the text." },
  { name: "Review", description: "You check and fix the proposal. Only what the file says can be kept." },
  { name: "Approve", description: "The reviewed version is frozen. Later edits start a new draft." },
  { name: "Index", description: "Embeddings are prepared and the file becomes searchable in Fit Check." },
];

export const EXPERIENCE_PAGE = {
  title: "Experience",
  subtitle: "Your uploaded files. Each one moves through six stages before Fit Check can search it.",
  legendTitle: "The six stages",
  empty: "No experience files yet. Upload one to get started.",
  loadError: "Your experience files could not be loaded.",
} as const;

export const DROP_ZONE = {
  title: "Upload experience file",
  body: "Drop a DOCX or selectable-text PDF here, or browse. Max 10 MB.",
  hint: "Uploading takes you straight to the file.",
  browse: "Browse files",
  uploading: "Uploading…",
  accept: ".pdf,.docx",
} as const;

export const ACTION_LABELS = {
  "continue-processing": "Continue processing",
  "retry-extract": "Retry extract",
  "retry-parse": "Retry parse",
  "start-review": "Start review",
  "continue-review": "Continue review",
  "index-now": "Index now",
  "continue-indexing": "Continue indexing",
  "retry-index": "Retry indexing",
  "try-jd": "Try a job description",
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

export const PROCESSING = {
  body: (fileName: string) =>
    `Reading the text in ${fileName}, then finding the projects and evidence in it. Usually under a minute.`,
  extracting: "Step 1 of 2 · extracting",
  parsing: "Step 2 of 2 · parsing",
  leave: "You can leave this page. If it isn't finished when you come back, choose Continue processing.",
  leaveList: "You can leave this page; come back and choose Continue if it stops.",
  alreadyRunning: "This stage is already running elsewhere. Showing its latest state.",
} as const;

export function parsedSummary(experiences: number, evidence: number, warnings: number, unassigned: number) {
  return (
    `We found ${plural(experiences, "experience", "experiences")} and ${plural(evidence, "piece", "pieces")} of evidence. ` +
    `${plural(warnings, "extraction warning", "extraction warnings")} and ${plural(unassigned, "unassigned block", "unassigned blocks")} to look at. ` +
    "Nothing is searchable until you approve."
  );
}

export function reviewGuidance(experiences: number) {
  return (
    `Step 4 of 6 · Review. We found ${plural(experiences, "experience", "experiences")} in your file. ` +
    "Check each one against the source, fix or remove anything that isn't supported, then approve."
  );
}

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

export function approvedCopy(version: number) {
  return {
    body:
      `Version ${version} is approved and frozen. Indexing prepares embeddings so Fit Check can search it. ` +
      "It is the last step, and you start it. If an earlier version is indexed, it stays searchable until this one replaces it.",
    status: `Approved version ${version} · ready for indexing`,
  };
}

export function indexingProgress(prepared: number, total: number) {
  return `Indexing · ${prepared} of ${total} chunks prepared`;
}

export const INDEXING = {
  keepOpen: "Keep this page open until it finishes.",
  stalled: "Indexing stopped making progress. Choose Continue indexing to try again.",
  interrupted: "Indexing was interrupted. Choose Continue indexing to pick up where it stopped.",
  starting: "Indexing · preparing chunks",
  running: (version: number | null) =>
    `Preparing embeddings for ${version === null ? "the approved version" : `version ${version}`} so Fit Check can search it.`,
} as const;

export function indexedCopy(since: string, version: number, experiences: number, evidence: number) {
  return {
    body: `Searchable in Fit Check since ${since} · version ${version} · ${plural(experiences, "experience", "experiences")}, ${plural(evidence, "evidence item", "evidence items")}.`,
    detail: `Any query against this file cites exact sentence spans from version ${version}.`,
  };
}

export function indexedWithDraftCopy(activeVersion: number) {
  return {
    label: `Indexed · draft for version ${activeVersion + 1} in review`,
    helper: `Version ${activeVersion} stays searchable until the new version is approved and indexed.`,
  };
}

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
  cleanupPending: "Deleted, but the stored original could not be removed yet. Retry cleanup when you can.",
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
  title: "How well does your experience fit this role?",
  intro:
    "Paste a job description. Every requirement is checked against your approved, indexed experience and cited back to the exact sentence in your file.",
  emptyTitle: "Fit Check needs at least one indexed experience file",
  emptyBody:
    "Upload a DOCX or PDF that describes your projects. You'll review what we find in it, approve it, and index it. About ten minutes the first time. After that, paste any job description here.",
  emptyAction: "Upload experience file",
  gapsTitle: (count: number) => `Gaps to address · ${count}`,
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
