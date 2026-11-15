/**
 * Background stage changes worth a notice (design Decision 6): a file that finished processing while the page polled
 * becomes ready for review, and a file that finished indexing becomes searchable. Pure, so the hook stays thin.
 */

export type TransitionKind = "ready-for-review" | "searchable";

export interface StageTransition {
  id: string;
  fileName: string;
  kind: TransitionKind;
}

export interface TrackedSource {
  id: string;
  file_name: string;
  status: string;
}

/** Last seen status per source id. */
export type StatusSnapshot = ReadonlyMap<string, string>;

const PROCESSING = new Set(["extracting", "parsing"]);

function kindOf(previous: string, next: string): TransitionKind | null {
  if (PROCESSING.has(previous) && next === "draft") return "ready-for-review";
  if (previous === "indexing" && next === "indexed") return "searchable";
  return null;
}

/**
 * Compares the next list with the last snapshot. A source seen for the first time, or not seen at all, raises
 * nothing; a source that kept its status raises nothing; each qualifying change raises one event.
 */
export function detectTransitions(previous: StatusSnapshot, next: readonly TrackedSource[]) {
  const events: StageTransition[] = [];
  const snapshot = new Map<string, string>();
  for (const source of next) {
    snapshot.set(source.id, source.status);
    const before = previous.get(source.id);
    if (before === undefined || before === source.status) continue;
    const kind = kindOf(before, source.status);
    if (kind) events.push({ id: source.id, fileName: source.file_name, kind });
  }
  return { events, snapshot: snapshot as StatusSnapshot };
}

export function transitionText(transition: StageTransition): string {
  return transition.kind === "ready-for-review" ? `${transition.fileName} is ready for review.` : `${transition.fileName} is searchable.`;
}
