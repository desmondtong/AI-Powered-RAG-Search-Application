import { z } from "zod";
import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import type { StructuredExperienceExport } from "../experience/contracts";
import { retainedSourceSpan } from "../jdFit/context";
import type { JdFitCitation } from "../jdFit/contracts";
import { MIN_PASSAGE_LENGTH } from "./fixtureSchema";

/** Identity of one retained revision. Sibling revisions share logical IDs, so only these fields tell them apart. */
export interface RevisionIdentity {
  source_id: string;
  revision_id: string;
  approved_content_hash: string;
}

/** Ground truth for one passage: revision identity plus a retained, block-relative source span. */
export interface PassageAnchor extends RevisionIdentity {
  passage: string;
  block_id: string;
  start: number;
  end: number;
  /** Logical evidence IDs whose resolved source refs overlap the span. Diagnostic only; never used to match. */
  evidence_logical_ids: string[];
  /** Whether any approved evidence item covers the span, i.e. whether the passage could have become a chunk. */
  covered: boolean;
}

export type AnchorErrorCode = "invalid-anchor" | "passage-not-in-retained-blocks" | "passage-ambiguous" | "export-identity-mismatch";

export class AnchorError extends Error {
  readonly code: AnchorErrorCode;

  constructor(code: AnchorErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "AnchorError";
    this.code = code;
  }
}

/**
 * The only accepted ground-truth anchor input: an exact passage of retained source text. Strict, so physical vector
 * row IDs, chunk or parent row IDs, generated summaries, parent headers, and embedding text cannot be supplied as
 * extra fields; and the passage must be found verbatim in the retained source blocks, which those texts are not.
 */
const AnchorInputSchema = z.object({ passage: z.string().min(MIN_PASSAGE_LENGTH) }).strict();

export function revisionIdentityOfExport(exportDoc: StructuredExperienceExport): RevisionIdentity {
  return {
    source_id: exportDoc.revision.source.source_id,
    revision_id: exportDoc.revision.revision.revision_id,
    approved_content_hash: exportDoc.content_hash,
  };
}

export function sameRevision(left: RevisionIdentity, right: RevisionIdentity) {
  return (
    left.source_id === right.source_id &&
    left.revision_id === right.revision_id &&
    left.approved_content_hash === right.approved_content_hash
  );
}

export function identityKey(identity: RevisionIdentity) {
  return `${identity.source_id}|${identity.revision_id}|${identity.approved_content_hash}`;
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

/**
 * Resolves a ground-truth passage against a retained revision export. When `expected` is given (from the corpus
 * manifest), the export must carry exactly that identity.
 */
export function resolvePassageAnchor(exportDoc: StructuredExperienceExport, input: unknown, expected?: RevisionIdentity): PassageAnchor {
  const parsed = AnchorInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AnchorError(
      "invalid-anchor",
      "Ground-truth anchors must be { passage } objects holding retained source text; row IDs, summaries, headers, and embedding text are not accepted.",
    );
  }
  const passage = parsed.data.passage;
  const identity = revisionIdentityOfExport(exportDoc);
  if (expected && !sameRevision(identity, expected)) {
    throw new AnchorError(
      "export-identity-mismatch",
      `Export identity ${identityKey(identity)} does not match the expected revision ${identityKey(expected)}.`,
    );
  }

  const matches: Array<{ block_id: string; start: number }> = [];
  for (const block of exportDoc.source_blocks) {
    let index = block.text.indexOf(passage);
    while (index >= 0) {
      matches.push({ block_id: block.block_id, start: index });
      index = block.text.indexOf(passage, index + 1);
    }
  }
  if (matches.length === 0) {
    throw new AnchorError("passage-not-in-retained-blocks", `Passage is not retained source text of revision ${identity.revision_id}: "${passage}"`);
  }
  if (matches.length > 1) {
    throw new AnchorError("passage-ambiguous", `Passage occurs ${matches.length} times in revision ${identity.revision_id}: "${passage}"`);
  }

  const { block_id, start } = matches[0];
  const end = start + passage.length;
  const evidenceIds = new Set<string>();
  for (const reference of exportDoc.resolved_source_refs) {
    if (!reference.logical_evidence_id) continue;
    if (reference.source_refs.some((span) => span.block_id === block_id && overlaps(span.start, span.end, start, end))) {
      evidenceIds.add(reference.logical_evidence_id);
    }
  }
  return {
    ...identity,
    passage,
    block_id,
    start,
    end,
    evidence_logical_ids: [...evidenceIds].sort(),
    covered: evidenceIds.size > 0,
  };
}

/** A citation supports an anchor when it carries the same revision identity and an overlapping span in the same block. */
export function citationMatchesAnchor(citation: JdFitCitation, anchor: PassageAnchor) {
  return (
    sameRevision(citation, anchor) &&
    citation.source_span.block_id === anchor.block_id &&
    overlaps(citation.source_span.start, citation.source_span.end, anchor.start, anchor.end)
  );
}

/** A retrieval hit matches an anchor by revision identity plus its retained span. Physical row IDs are ignored. */
export function hitMatchesAnchor(hit: ApprovedExperienceSearchResult, anchor: PassageAnchor) {
  const span = retainedSourceSpan(hit);
  return (
    span !== null &&
    sameRevision(hit, anchor) &&
    span.block_id === anchor.block_id &&
    overlaps(span.start, span.end, anchor.start, anchor.end)
  );
}
