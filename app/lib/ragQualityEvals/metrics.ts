import { JD_FIT_POSITIVE_LABELS, JdFitResponseSchema, type JdFitCitation, type JdFitRequirement } from "../jdFit/contracts";
import { citationMatchesAnchor, hitMatchesAnchor, identityKey, sameRevision, type PassageAnchor } from "./anchors";
import { RAG_EVAL_COUNT_METRICS, RAG_EVAL_METRICS, type ExpectedRequirement, type ModeThresholds, type RagEvalMetric } from "./fixtureSchema";
import {
  FATAL_CATEGORIES,
  type CorpusIndex,
  type Finding,
  type FindingCategory,
  type FixtureCorpus,
  type FixtureMetrics,
  type FixtureObservation,
  type MetricResult,
  type RagEvalMode,
} from "./types";

/** Offline, these metrics only prove the scorer over scripted inputs; they say nothing about model or ranking quality. */
export const OFFLINE_HARNESS_METRICS: ReadonlySet<RagEvalMetric> = new Set([
  "requirement_recall",
  "unsupported_requirements",
  "retrieval_recall",
  "distractor_precision",
  "ingestion_coverage",
]);

const SCORE_KEY = /(^|_)(score|scores|rating|ratings|percent|percentage|fit_pct)($|_)/i;

interface Tally {
  numerator: number;
  denominator: number;
}

function tally(): Tally {
  return { numerator: 0, denominator: 0 };
}

class FindingList {
  readonly items: Finding[] = [];

  constructor(private readonly fixtureId: string) {}

  add(category: FindingCategory, requirementId: string | null, message: string) {
    this.items.push({ category, fixture_id: this.fixtureId, requirement_id: requirementId, message, fatal: FATAL_CATEGORIES.has(category) });
  }
}

function lower(value: string) {
  return value.toLowerCase();
}

/** Fixture requirements an extracted requirement matches, by case-insensitive phrase containment. */
export function matchExpectedRequirements(extracted: JdFitRequirement, expected: ExpectedRequirement[]) {
  const text = lower(extracted.text);
  return expected.filter((requirement) => requirement.match_any.some((phrase) => text.includes(lower(phrase))));
}

function jdLabel(requirement: JdFitRequirement) {
  return `jd:${requirement.requirement_id}`;
}

function shortText(text: string) {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function citationLabel(citation: JdFitCitation) {
  return `${citation.evidence_handle} (revision ${citation.revision_id}, ${citation.source_span.block_id}:${citation.source_span.start}-${citation.source_span.end})`;
}

/** Recursively finds keys that look like numeric fit scores anywhere outside diagnostics. */
export function findScoreFields(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findScoreFields(item, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, entry]) => {
    const here = path ? `${path}.${key}` : key;
    if (here === "diagnostics") return [];
    return [...(SCORE_KEY.test(key) ? [here] : []), ...findScoreFields(entry, here)];
  });
}

function checkContracts(observation: FixtureObservation, findings: FindingList) {
  const probe = observation.probe;
  if (!probe.rejected) {
    findings.add("contract", null, "JD-fit accepted a request carrying sourceIds; it must reject any source selection.");
  } else if (probe.error_code !== "unsupported-request-field") {
    findings.add("contract", null, `JD-fit rejected sourceIds with ${probe.error_code ?? "an unknown error"} instead of unsupported-request-field.`);
  }
  if (probe.search_calls > 0 || probe.model_calls > 0) {
    findings.add("contract", null, `JD-fit made ${probe.search_calls} search and ${probe.model_calls} model calls before rejecting sourceIds.`);
  }

  observation.search_calls.forEach((call) => {
    if ("sourceIds" in call.options || "source_ids" in call.options) {
      findings.add("contract", null, `Retrieval for "${call.query}" was called with a source selection.`);
    }
  });

  if (observation.raw_response !== null && observation.raw_response !== undefined) {
    for (const field of findScoreFields(observation.raw_response)) {
      findings.add("contract", null, `Response contains a numeric fit score field: ${field}.`);
    }
    if (!JdFitResponseSchema.safeParse(observation.raw_response).success) {
      findings.add("contract", null, "Response does not satisfy the accepted JD-fit response schema.");
    }
  }
}

/** Checks one citation's identity against the corpus. Returns true when it is a valid citation of this fixture. */
function checkCitationIdentity(citation: JdFitCitation, corpus: FixtureCorpus, index: CorpusIndex, requirementId: string, findings: FindingList) {
  const owner = index.bySource.get(citation.source_id);
  if (!owner) {
    findings.add("citation-invalid", requirementId, `${citationLabel(citation)} cites a source outside the evaluation corpus.`);
    return false;
  }
  if (!sameRevision(citation, owner.active)) {
    const known = index.revisions.get(identityKey(citation));
    findings.add(
      "wrong-revision",
      requirementId,
      `${citationLabel(citation)} carries ${known ? `the ${known.role} revision` : "an unknown revision"} of ${owner.fixture.fixture_id}; only the active revision ${owner.active.revision_id} may be cited.`,
    );
    return false;
  }
  if (owner !== corpus) {
    findings.add("citation-invalid", requirementId, `${citationLabel(citation)} cites another fixture's source (${owner.fixture.fixture_id}).`);
    return false;
  }
  const exportDoc = index.revisions.get(identityKey(citation))?.export;
  const block = exportDoc?.source_blocks.find((candidate) => candidate.block_id === citation.source_span.block_id);
  if (!block || citation.source_span.end > block.text.length) {
    findings.add("citation-invalid", requirementId, `${citationLabel(citation)} points outside the retained source blocks.`);
    return false;
  }
  return true;
}

function metric(
  name: RagEvalMetric,
  thresholds: ModeThresholds,
  mode: RagEvalMode,
  numerator: number,
  denominator: number | null,
): MetricResult {
  const threshold = thresholds[name];
  const isCount = RAG_EVAL_COUNT_METRICS.has(name);
  const applicable = isCount || (denominator ?? 0) > 0;
  const value = isCount ? numerator : applicable ? numerator / (denominator as number) : null;
  const pass = !applicable || (isCount ? (value as number) <= threshold : (value as number) >= threshold - 1e-9);
  return {
    value: value === null ? null : Math.round(value * 10_000) / 10_000,
    numerator,
    denominator: isCount ? null : denominator,
    threshold,
    comparator: isCount ? "<=" : ">=",
    applicable,
    pass,
    harness_check: mode === "offline" && OFFLINE_HARNESS_METRICS.has(name),
  };
}

export interface FixtureScore {
  findings: Finding[];
  metrics: FixtureMetrics;
  tallies: Record<RagEvalMetric, Tally>;
}

/** Scores one fixture run. Findings come first; metrics are computed from the same tallies. */
export function scoreFixture(corpus: FixtureCorpus, index: CorpusIndex, observation: FixtureObservation, mode: RagEvalMode): FixtureScore {
  const fixture = corpus.fixture;
  const findings = new FindingList(fixture.fixture_id);
  const t = Object.fromEntries(RAG_EVAL_METRICS.map((name) => [name, tally()])) as Record<RagEvalMetric, Tally>;

  checkContracts(observation, findings);
  if (observation.error) {
    findings.add("run-error", null, `JD-fit failed with ${observation.error.code}: ${observation.error.message}`);
  }

  // Ingestion coverage is a property of the corpus, so it is scored even when JD-fit failed.
  for (const requirement of fixture.expected_requirements) {
    for (const anchor of corpus.expected.get(requirement.id) ?? []) {
      t.ingestion_coverage.denominator += 1;
      if (anchor.covered) {
        t.ingestion_coverage.numerator += 1;
      } else {
        findings.add("coverage-miss", requirement.id, `No approved evidence covers the expected passage "${shortText(anchor.passage)}"; it is excluded from retrieval recall.`);
      }
    }
  }

  const response = observation.response;
  if (response) {
    const extracted = response.requirements;
    const matches = new Map(extracted.map((requirement) => [requirement.requirement_id, matchExpectedRequirements(requirement, fixture.expected_requirements)]));
    const extractedFor = (expectedId: string) => extracted.filter((requirement) => matches.get(requirement.requirement_id)!.some((entry) => entry.id === expectedId));

    // Requirement extraction.
    for (const requirement of fixture.expected_requirements) {
      t.requirement_recall.denominator += 1;
      const found = extractedFor(requirement.id);
      if (found.length === 0) {
        findings.add("requirement-miss", requirement.id, `Expected ${requirement.importance} requirement "${requirement.text}" was not extracted.`);
      } else if (!found.some((entry) => entry.importance === requirement.importance)) {
        findings.add(
          "requirement-miss",
          requirement.id,
          `Requirement "${requirement.text}" was extracted as ${found[0].importance} (${found.map((entry) => entry.requirement_id).join(", ")}), expected ${requirement.importance}.`,
        );
      } else {
        t.requirement_recall.numerator += 1;
      }
    }
    for (const requirement of extracted) {
      if (matches.get(requirement.requirement_id)!.length > 0) continue;
      if (fixture.tolerated_requirements.some((phrase) => lower(requirement.text).includes(lower(phrase)))) continue;
      t.unsupported_requirements.numerator += 1;
      findings.add("unsupported-requirement", jdLabel(requirement), `Extracted requirement "${shortText(requirement.text)}" is not supported by the fixture JD.`);
    }

    // Retrieval. Hits are attributed to fixture requirements through the extracted requirements that match them.
    const hitsByQuery = new Map<string, FixtureObservation["search_calls"][number]["hits"]>();
    for (const call of observation.search_calls) {
      hitsByQuery.set(call.query, [...(hitsByQuery.get(call.query) ?? []), ...call.hits]);
    }
    for (const call of observation.search_calls) {
      for (const hit of call.hits) {
        const owner = index.bySource.get(hit.source_id);
        if (owner && !sameRevision(hit, owner.active)) {
          findings.add("wrong-revision", null, `Retrieval for "${call.query}" returned revision ${hit.revision_id} of ${owner.fixture.fixture_id}; only the active revision ${owner.active.revision_id} is searchable.`);
        }
      }
    }
    for (const requirement of fixture.expected_requirements) {
      const found = extractedFor(requirement.id);
      if (found.length === 0) continue;
      const hits = found.flatMap((entry) => hitsByQuery.get(entry.retrieval_query) ?? []);
      for (const anchor of corpus.expected.get(requirement.id) ?? []) {
        if (!anchor.covered) continue;
        t.retrieval_recall.denominator += 1;
        if (hits.some((hit) => hitMatchesAnchor(hit, anchor))) {
          t.retrieval_recall.numerator += 1;
          t.distractor_precision.numerator += 1;
          t.distractor_precision.denominator += 1;
        } else {
          findings.add("retrieval-miss", requirement.id, `Expected passage "${shortText(anchor.passage)}" was not retrieved for "${requirement.text}".`);
        }
      }
      for (const anchor of corpus.distractors.get(requirement.id) ?? []) {
        const ranks = hits.map((hit, rank) => (hitMatchesAnchor(hit, anchor) ? rank + 1 : 0)).filter((rank) => rank > 0);
        if (ranks.length === 0) continue;
        t.distractor_precision.denominator += 1;
        findings.add("distractor-hit", requirement.id, `Distractor "${shortText(anchor.passage)}" was retrieved for "${requirement.text}" (rank ${ranks[0]}).`);
      }
    }

    // Report quality and citation identity.
    const allAnchors: PassageAnchor[] = [...corpus.expected.values()].flat();
    const gapIds = new Set(response.gaps.map((gap) => gap.requirement_id));
    for (const assessment of response.assessments) {
      const requirement = extracted.find((entry) => entry.requirement_id === assessment.requirement_id)!;
      const expected = matches.get(requirement.requirement_id)!;
      const label = expected[0]?.id ?? jdLabel(requirement);
      const validCitations = assessment.citations.filter((citation) => checkCitationIdentity(citation, corpus, index, label, findings));
      if (!JD_FIT_POSITIVE_LABELS.has(assessment.fit)) continue;

      if (expected.length === 0) {
        t.citation_validity.denominator += 1;
        if (validCitations.some((citation) => allAnchors.some((anchor) => citationMatchesAnchor(citation, anchor)))) {
          t.citation_validity.numerator += 1;
        } else {
          findings.add("citation-invalid", label, `${assessment.fit} claim for "${shortText(requirement.text)}" cites no expected evidence passage of the fixture.`);
        }
        continue;
      }
      for (const entry of expected) {
        const anchors = corpus.expected.get(entry.id) ?? [];
        if (fixture.expected_gaps.includes(entry.id) || anchors.length === 0) {
          t.unsupported_positive_claims.numerator += 1;
          findings.add("unsupported-positive-claim", entry.id, `"${entry.text}" is expected to be a gap but was reported ${assessment.fit} (${assessment.requirement_id}).`);
          continue;
        }
        t.citation_validity.denominator += 1;
        if (validCitations.some((citation) => anchors.some((anchor) => citationMatchesAnchor(citation, anchor)))) {
          t.citation_validity.numerator += 1;
        } else {
          findings.add("citation-invalid", entry.id, `${assessment.fit} claim for "${entry.text}" (${assessment.requirement_id}) has no citation matching its expected evidence.`);
        }
      }
    }

    for (const gapId of fixture.expected_gaps) {
      const found = extractedFor(gapId);
      if (found.length === 0) continue;
      t.gap_visibility.denominator += 1;
      if (found.some((entry) => gapIds.has(entry.requirement_id))) {
        t.gap_visibility.numerator += 1;
      } else {
        const fits = found.map((entry) => `${entry.requirement_id}=${response.assessments.find((item) => item.requirement_id === entry.requirement_id)?.fit}`);
        findings.add("gap-hidden", gapId, `Expected gap "${fixture.expected_requirements.find((entry) => entry.id === gapId)!.text}" is not listed in gaps (${fits.join(", ")}).`);
      }
    }
  }

  const thresholds = fixture.thresholds[mode];
  const metrics = Object.fromEntries(
    RAG_EVAL_METRICS.map((name) => {
      const value = t[name];
      return [name, metric(name, thresholds, mode, value.numerator, RAG_EVAL_COUNT_METRICS.has(name) ? null : value.denominator)];
    }),
  ) as FixtureMetrics;

  // When JD-fit produced no response, response-dependent metrics cannot pass.
  if (!response) {
    for (const name of RAG_EVAL_METRICS) {
      if (name !== "ingestion_coverage") metrics[name] = { ...metrics[name], pass: false };
    }
  }

  return { findings: findings.items, metrics, tallies: t };
}
