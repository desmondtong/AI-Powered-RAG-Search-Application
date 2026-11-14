import { identityKey } from "./anchors";
import { RAG_EVAL_COUNT_METRICS, RAG_EVAL_METRICS, type RagEvalMetric } from "./fixtureSchema";
import { OFFLINE_HARNESS_METRICS, type FixtureScore } from "./metrics";
import {
  FINDING_CATEGORIES,
  type CorpusIndex,
  type Finding,
  type FindingCategory,
  type FixtureCorpus,
  type FixtureMetrics,
  type FixtureObservation,
  type RagEvalMode,
} from "./types";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION, RAG_EVAL_REPORT_SCHEMA_VERSION, RAG_EVAL_RUNNER_VERSION } from "./versions";

/** The finding category that explains each metric, used to name the requirements behind a failing metric. */
export const METRIC_FINDING_CATEGORY: Record<RagEvalMetric, FindingCategory> = {
  requirement_recall: "requirement-miss",
  unsupported_requirements: "unsupported-requirement",
  retrieval_recall: "retrieval-miss",
  distractor_precision: "distractor-hit",
  ingestion_coverage: "coverage-miss",
  citation_validity: "citation-invalid",
  unsupported_positive_claims: "unsupported-positive-claim",
  gap_visibility: "gap-hidden",
};

export interface FixtureRunResult {
  corpus: FixtureCorpus;
  observation: FixtureObservation;
  score: FixtureScore;
}

export interface ReportFailure {
  /** A metric name for threshold failures, or a finding category for fatal findings. */
  category: RagEvalMetric | FindingCategory;
  fixture_id: string;
  requirement_id: string | null;
  message: string;
}

export interface CitedRevision {
  source_id: string;
  revision_id: string;
  approved_content_hash: string;
  fixture_id: string | null;
  role: "active" | "latest-unindexed" | "unknown";
  configuration_versions: Record<string, string | null> | null;
}

export interface FixtureReport {
  fixture_id: string;
  title: string;
  fixture_hash: string;
  status: "pass" | "fail";
  source: { source_id: string; file_name: string; active_revision_id: string; latest_unindexed_revision_id: string | null };
  jd_fit: {
    status: "evaluated" | "no_evidence" | null;
    error: { code: string; message: string } | null;
    diagnostics: unknown;
    requirements: Array<{ requirement_id: string; text: string; importance: string; fit: string | null; citations: number; downgraded: boolean }>;
    gaps: string[];
    search_calls: number;
  };
  cited_revisions: CitedRevision[];
  metrics: FixtureMetrics;
  findings: Finding[];
}

export interface AggregateMetric {
  value: number | null;
  numerator: number;
  denominator: number | null;
  harness_check: boolean;
}

export interface RagEvalReport {
  report_schema_version: string;
  run_id: string;
  mode: RagEvalMode;
  /** Live reports are non-deterministic evidence; offline reports are reproducible harness runs. */
  live: boolean;
  deterministic: boolean;
  started_at: string;
  finished_at: string;
  versions: {
    fixture_schema: string;
    runner: string;
    report_schema: string;
    jd_fit: { model: string; requirement_prompt: string; report_prompt: string; validation: string } | null;
  };
  harness_check_note: string | null;
  status: "pass" | "fail";
  fixtures: FixtureReport[];
  aggregates: Record<RagEvalMetric, AggregateMetric>;
  finding_counts: Record<FindingCategory, number>;
  failures: ReportFailure[];
}

const CATEGORY_ORDER = new Map(FINDING_CATEGORIES.map((category, index) => [category, index]));

function sortFindings(findings: Finding[]) {
  return [...findings].sort(
    (left, right) =>
      CATEGORY_ORDER.get(left.category)! - CATEGORY_ORDER.get(right.category)! ||
      (left.requirement_id ?? "").localeCompare(right.requirement_id ?? "") ||
      left.message.localeCompare(right.message),
  );
}

function citedRevisions(observation: FixtureObservation, index: CorpusIndex): CitedRevision[] {
  const seen = new Map<string, CitedRevision>();
  for (const assessment of observation.response?.assessments ?? []) {
    for (const citation of assessment.citations) {
      const key = identityKey(citation);
      if (seen.has(key)) continue;
      const known = index.revisions.get(key);
      seen.set(key, {
        source_id: citation.source_id,
        revision_id: citation.revision_id,
        approved_content_hash: citation.approved_content_hash,
        fixture_id: known?.fixture_id ?? null,
        role: known?.role ?? "unknown",
        configuration_versions: known ? { ...known.export.configuration_versions } : null,
      });
    }
  }
  return [...seen.values()].sort((left, right) => identityKey(left).localeCompare(identityKey(right)));
}

function fixtureReport(result: FixtureRunResult, index: CorpusIndex): FixtureReport {
  const { corpus, observation, score } = result;
  const response = observation.response;
  const findings = sortFindings(score.findings);
  const failed = findings.some((finding) => finding.fatal) || RAG_EVAL_METRICS.some((name) => !score.metrics[name].pass);
  return {
    fixture_id: corpus.fixture.fixture_id,
    title: corpus.fixture.title,
    fixture_hash: corpus.fixture_hash,
    status: failed ? "fail" : "pass",
    source: {
      source_id: corpus.source_id,
      file_name: corpus.file_name,
      active_revision_id: corpus.active.revision_id,
      latest_unindexed_revision_id: corpus.latest_unindexed?.revision_id ?? null,
    },
    jd_fit: {
      status: response?.status ?? null,
      error: observation.error,
      diagnostics: response?.diagnostics ?? null,
      requirements: (response?.requirements ?? []).map((requirement) => {
        const assessment = response!.assessments.find((item) => item.requirement_id === requirement.requirement_id);
        return {
          requirement_id: requirement.requirement_id,
          text: requirement.text,
          importance: requirement.importance,
          fit: assessment?.fit ?? null,
          citations: assessment?.citations.length ?? 0,
          downgraded: assessment?.downgraded ?? false,
        };
      }),
      gaps: (response?.gaps ?? []).map((gap) => gap.requirement_id),
      search_calls: observation.search_calls.length,
    },
    cited_revisions: citedRevisions(observation, index),
    metrics: score.metrics,
    findings,
  };
}

function failuresFor(report: FixtureReport): ReportFailure[] {
  const failures: ReportFailure[] = [];
  for (const finding of report.findings.filter((item) => item.fatal)) {
    failures.push({ category: finding.category, fixture_id: report.fixture_id, requirement_id: finding.requirement_id, message: finding.message });
  }
  for (const name of RAG_EVAL_METRICS) {
    const result = report.metrics[name];
    if (result.pass) continue;
    const describe = result.value === null ? "could not be measured" : `${result.value} ${result.comparator === ">=" ? "<" : ">"} threshold ${result.threshold}`;
    const related = report.findings.filter((finding) => finding.category === METRIC_FINDING_CATEGORY[name]);
    if (related.length === 0) {
      failures.push({ category: name, fixture_id: report.fixture_id, requirement_id: null, message: `${name} ${describe}.` });
    }
    for (const finding of related) {
      failures.push({ category: name, fixture_id: report.fixture_id, requirement_id: finding.requirement_id, message: `${name} ${describe}: ${finding.message}` });
    }
  }
  return failures;
}

export interface BuildReportInput {
  mode: RagEvalMode;
  runId: string;
  startedAt: number;
  finishedAt: number;
  index: CorpusIndex;
  results: FixtureRunResult[];
}

export function buildRagEvalReport(input: BuildReportInput): RagEvalReport {
  const fixtures = input.results.map((result) => fixtureReport(result, input.index));
  const aggregates = Object.fromEntries(
    RAG_EVAL_METRICS.map((name) => {
      const numerator = input.results.reduce((sum, result) => sum + result.score.tallies[name].numerator, 0);
      const denominator = input.results.reduce((sum, result) => sum + result.score.tallies[name].denominator, 0);
      const isCount = RAG_EVAL_COUNT_METRICS.has(name);
      const value = isCount ? numerator : denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
      return [name, { value, numerator, denominator: isCount ? null : denominator, harness_check: input.mode === "offline" && OFFLINE_HARNESS_METRICS.has(name) }];
    }),
  ) as Record<RagEvalMetric, AggregateMetric>;
  const findingCounts = Object.fromEntries(FINDING_CATEGORIES.map((category) => [category, 0])) as Record<FindingCategory, number>;
  for (const fixture of fixtures) {
    for (const finding of fixture.findings) findingCounts[finding.category] += 1;
  }
  const diagnostics = input.results.find((result) => result.observation.response)?.observation.response?.diagnostics;
  const failures = fixtures.flatMap(failuresFor);
  return {
    report_schema_version: RAG_EVAL_REPORT_SCHEMA_VERSION,
    run_id: input.runId,
    mode: input.mode,
    live: input.mode === "live",
    deterministic: input.mode === "offline",
    started_at: new Date(input.startedAt).toISOString(),
    finished_at: new Date(input.finishedAt).toISOString(),
    versions: {
      fixture_schema: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
      runner: RAG_EVAL_RUNNER_VERSION,
      report_schema: RAG_EVAL_REPORT_SCHEMA_VERSION,
      jd_fit: diagnostics
        ? {
            model: diagnostics.model,
            requirement_prompt: diagnostics.requirement_prompt_version,
            report_prompt: diagnostics.report_prompt_version,
            validation: diagnostics.validation_version,
          }
        : null,
    },
    harness_check_note:
      input.mode === "offline"
        ? "Offline extraction and retrieval metrics are harness checks over scripted inputs. They prove the scorer, not model or ranking quality."
        : null,
    status: fixtures.every((fixture) => fixture.status === "pass") ? "pass" : "fail",
    fixtures,
    aggregates,
    finding_counts: findingCounts,
    failures,
  };
}

function formatMetric(name: RagEvalMetric, result: { value: number | null; harness_check: boolean }) {
  const value = result.value === null ? "n/a" : RAG_EVAL_COUNT_METRICS.has(name) ? String(result.value) : result.value.toFixed(2);
  return result.harness_check ? `${value}*` : value;
}

/** Compact human-readable rendering of a report. */
export function renderRagEvalMarkdown(report: RagEvalReport) {
  const lines: string[] = [];
  lines.push(`# RAG quality eval: ${report.status.toUpperCase()}`);
  lines.push("");
  lines.push(`- Mode: ${report.mode}${report.live ? " (live, non-deterministic evidence)" : " (deterministic)"}`);
  lines.push(`- Run: ${report.run_id}, ${report.started_at} to ${report.finished_at}`);
  lines.push(`- Versions: fixtures ${report.versions.fixture_schema}, runner ${report.versions.runner}, report ${report.versions.report_schema}`);
  if (report.versions.jd_fit) {
    const jd = report.versions.jd_fit;
    lines.push(`- JD-fit: model ${jd.model}, prompts ${jd.requirement_prompt} and ${jd.report_prompt}, validation ${jd.validation}`);
  }
  if (report.harness_check_note) {
    lines.push(`- \\* ${report.harness_check_note}`);
  }
  lines.push("");
  const header = ["Fixture", "Status", ...RAG_EVAL_METRICS];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const fixture of report.fixtures) {
    lines.push(`| ${fixture.fixture_id} | ${fixture.status} | ${RAG_EVAL_METRICS.map((name) => `${formatMetric(name, fixture.metrics[name])}${fixture.metrics[name].pass ? "" : " ✗"}`).join(" | ")} |`);
  }
  lines.push(`| all | ${report.status} | ${RAG_EVAL_METRICS.map((name) => formatMetric(name, report.aggregates[name])).join(" | ")} |`);
  lines.push("");
  if (report.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const failure of report.failures) {
      lines.push(`- **${failure.category}** ${failure.fixture_id}${failure.requirement_id ? ` / ${failure.requirement_id}` : ""}: ${failure.message}`);
    }
    lines.push("");
  }
  const counted = FINDING_CATEGORIES.filter((category) => report.finding_counts[category] > 0);
  if (counted.length > 0) {
    lines.push("## Findings");
    lines.push("");
    lines.push(counted.map((category) => `${category}: ${report.finding_counts[category]}`).join(", "));
    lines.push("");
    for (const fixture of report.fixtures.filter((item) => item.findings.length > 0)) {
      lines.push(`### ${fixture.fixture_id}`);
      lines.push("");
      for (const finding of fixture.findings) {
        lines.push(`- ${finding.fatal ? "**FATAL** " : ""}\`${finding.category}\`${finding.requirement_id ? ` ${finding.requirement_id}` : ""}: ${finding.message}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
