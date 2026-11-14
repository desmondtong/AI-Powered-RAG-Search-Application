import { parseRagEvalFixtures, type RagEvalFixture, type RagEvalFixtureInput } from "../fixtureSchema";
import { activeVsLatestFixture } from "./activeVsLatest";
import { distractorHeavyFixture } from "./distractorHeavy";
import { missingEvidenceFixture } from "./missingEvidence";
import { partialMatchFixture } from "./partialMatch";
import { promptInjectionFixture } from "./promptInjection";
import { strongMatchFixture } from "./strongMatch";

/** Committed synthetic fixtures. All text is invented; see the eval README for the redaction policy. */
export const RAG_EVAL_FIXTURE_INPUTS: readonly RagEvalFixtureInput[] = [
  strongMatchFixture,
  partialMatchFixture,
  missingEvidenceFixture,
  promptInjectionFixture,
  distractorHeavyFixture,
  activeVsLatestFixture,
];

/** Validated fixtures, sorted by fixture ID. Throws a FixtureValidationError before any evaluation if one is invalid. */
export function loadRagEvalFixtures(): RagEvalFixture[] {
  return parseRagEvalFixtures(structuredClone([...RAG_EVAL_FIXTURE_INPUTS]));
}
