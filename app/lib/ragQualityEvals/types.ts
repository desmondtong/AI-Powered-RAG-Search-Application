import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import type { StructuredExperienceExport } from "../experience/contracts";
import type { JdFitResponse } from "../jdFit/contracts";
import type { PassageAnchor, RevisionIdentity } from "./anchors";
import type { RagEvalFixture, RagEvalMetric } from "./fixtureSchema";

export type RagEvalMode = "offline" | "live";

export const FINDING_CATEGORIES = [
  "requirement-miss",
  "unsupported-requirement",
  "retrieval-miss",
  "distractor-hit",
  "coverage-miss",
  "citation-invalid",
  "unsupported-positive-claim",
  "gap-hidden",
  "wrong-revision",
  "contract",
  "run-error",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** Categories that fail the run regardless of thresholds. */
export const FATAL_CATEGORIES: ReadonlySet<FindingCategory> = new Set(["wrong-revision", "contract", "run-error"]);

export interface Finding {
  category: FindingCategory;
  fixture_id: string;
  /** Fixture requirement ID when known, otherwise the JD-fit requirement ID prefixed with `jd:`. */
  requirement_id: string | null;
  message: string;
  fatal: boolean;
}

export interface MetricResult {
  value: number | null;
  numerator: number;
  denominator: number | null;
  threshold: number;
  comparator: ">=" | "<=";
  applicable: boolean;
  pass: boolean;
  /** True when the metric only proves the harness scorer over scripted inputs (offline extraction and retrieval). */
  harness_check: boolean;
}

export type FixtureMetrics = Record<RagEvalMetric, MetricResult>;

export interface RecordedSearchCall {
  query: string;
  options: Record<string, unknown>;
  hits: ApprovedExperienceSearchResult[];
}

export interface CorpusRevision {
  fixture_id: string;
  role: "active" | "latest-unindexed";
  export: StructuredExperienceExport;
}

/** Ground truth for one fixture, resolved against the retained exports of its seeded (or synthesized) source. */
export interface FixtureCorpus {
  fixture: RagEvalFixture;
  fixture_hash: string;
  file_name: string;
  source_id: string;
  active: RevisionIdentity;
  latest_unindexed: RevisionIdentity | null;
  expected: Map<string, PassageAnchor[]>;
  distractors: Map<string, PassageAnchor[]>;
}

/** All fixtures' corpora plus every known retained revision, keyed by revision identity. */
export interface CorpusIndex {
  fixtures: FixtureCorpus[];
  bySource: Map<string, FixtureCorpus>;
  revisions: Map<string, CorpusRevision>;
}

export interface SourceSelectionProbe {
  rejected: boolean;
  error_code: string | null;
  search_calls: number;
  model_calls: number;
}

export interface FixtureObservation {
  fixture_id: string;
  probe: SourceSelectionProbe;
  response: JdFitResponse | null;
  /** The response exactly as returned, before any parsing, for contract checks. */
  raw_response: unknown;
  error: { code: string; message: string } | null;
  search_calls: RecordedSearchCall[];
}
