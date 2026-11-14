import type { ModeThresholds } from "../fixtureSchema";

/** Offline runs are scripted, so every metric is expected to be exact unless a fixture says otherwise. */
export const OFFLINE_EXACT: ModeThresholds = {
  requirement_recall: 1,
  unsupported_requirements: 0,
  retrieval_recall: 1,
  distractor_precision: 1,
  ingestion_coverage: 1,
  citation_validity: 1,
  unsupported_positive_claims: 0,
  gap_visibility: 1,
};

/** Initial live thresholds: permissive, tightened only after recorded runs. Unsupported positive claims stay at zero. */
export const LIVE_INITIAL: ModeThresholds = {
  requirement_recall: 0.6,
  unsupported_requirements: 2,
  retrieval_recall: 0.6,
  distractor_precision: 0.3,
  ingestion_coverage: 0.6,
  citation_validity: 0.6,
  unsupported_positive_claims: 0,
  gap_visibility: 0.6,
};
