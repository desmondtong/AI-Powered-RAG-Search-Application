import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringify } from "../experience/contracts";
import { DEFAULT_SOURCE_BLOCK_MAX_UTF16_UNITS } from "../experience/extractionSnapshot";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "./versions";

export type FixtureValidationCode =
  | "fixture-not-object"
  | "schema-version-unsupported"
  | "fixture-shape-invalid"
  | "missing-thresholds"
  | "unknown-revision-plan"
  | "duplicate-fixture-id"
  | "duplicate-requirement-id"
  | "unknown-requirement-reference"
  | "paragraph-not-normalized"
  | "passage-too-short"
  | "passage-not-in-experience"
  | "passage-ambiguous"
  | "passage-labeled-twice"
  | "gap-has-expected-evidence"
  | "offline-script-invalid";

/** A fixture failed validation. Raised before any retrieval or report evaluation runs. */
export class FixtureValidationError extends Error {
  readonly code: FixtureValidationCode;
  readonly fixtureId: string | null;

  constructor(code: FixtureValidationCode, fixtureId: string | null, message: string) {
    super(`[${code}]${fixtureId ? ` ${fixtureId}:` : ""} ${message}`);
    this.name = "FixtureValidationError";
    this.code = code;
    this.fixtureId = fixtureId;
  }
}

/** Minimum length of a ground-truth passage, so trivial substrings cannot stand in for evidence. */
export const MIN_PASSAGE_LENGTH = 12;

const unit = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase kebab-case");
const passageList = z.array(z.string().min(1));

export const RAG_EVAL_METRICS = [
  "requirement_recall",
  "unsupported_requirements",
  "retrieval_recall",
  "distractor_precision",
  "ingestion_coverage",
  "citation_validity",
  "unsupported_positive_claims",
  "gap_visibility",
] as const;
export type RagEvalMetric = (typeof RAG_EVAL_METRICS)[number];

/** Ratio metrics must be at least their threshold; count metrics must be at most theirs. */
export const RAG_EVAL_COUNT_METRICS: ReadonlySet<RagEvalMetric> = new Set(["unsupported_requirements", "unsupported_positive_claims"]);

export const ModeThresholdsSchema = z
  .object({
    requirement_recall: unit,
    unsupported_requirements: count,
    retrieval_recall: unit,
    distractor_precision: unit,
    ingestion_coverage: unit,
    citation_validity: unit,
    unsupported_positive_claims: count,
    gap_visibility: unit,
  })
  .strict();
export type ModeThresholds = z.infer<typeof ModeThresholdsSchema>;

const ExpectedRequirementSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    importance: z.enum(["required", "preferred"]),
    /** Case-insensitive phrases; an extracted requirement matches when its text contains any of them. */
    match_any: z.array(z.string().min(2)).min(1),
  })
  .strict();

export const REVISION_PLAN_KINDS = ["single", "active-r1-latest-r2-unindexed"] as const;

const RevisionPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single") }).strict(),
  z
    .object({
      kind: z.literal("active-r1-latest-r2-unindexed"),
      /** Grounded R2 edit: appended to the first evidence item's summary. Source references are unchanged. */
      r2_evidence_summary_suffix: z.string().min(1),
    })
    .strict(),
]);

const OfflineScriptSchema = z
  .object({
    /** Scripted requirement-extraction output, in order. Requirement N gets JD-fit ID `RN`. */
    requirements: z
      .array(
        z
          .object({
            text: z.string().min(1),
            importance: z.enum(["required", "preferred"]),
            retrieval_query: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    /** Scripted approved-search results, keyed by retrieval query. Each entry is a passage of the fixture text. */
    search: z.record(z.string(), passageList),
    /** Scripted report output. `requirement` is the 1-based index into `requirements`; `cite` lists passages. */
    report: z.array(
      z
        .object({
          requirement: z.number().int().positive(),
          fit: z.enum(["strong", "partial", "weak", "missing"]),
          rationale: z.string().min(1),
          cite: passageList,
        })
        .strict(),
    ),
  })
  .strict();

export const RagEvalFixtureSchema = z
  .object({
    schema_version: z.literal(RAG_EVAL_FIXTURE_SCHEMA_VERSION),
    fixture_id: idSchema,
    title: z.string().min(1),
    experience: z
      .object({
        file_stem: idSchema,
        paragraphs: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    jd_text: z.string().min(1),
    expected_requirements: z.array(ExpectedRequirementSchema).min(1),
    /** Passages that support each expected requirement, keyed by expected requirement ID. */
    expected_evidence: z.record(z.string(), passageList),
    /** Expected requirement IDs the report must show as weak or missing. */
    expected_gaps: z.array(z.string()),
    /** Passages that look relevant to a requirement but do not support it, keyed by expected requirement ID. */
    distractors: z.record(z.string(), passageList),
    /** Case-insensitive phrases for extra extracted requirements that are tolerated, not counted as invented. */
    tolerated_requirements: z.array(z.string().min(2)).default([]),
    revision_plan: RevisionPlanSchema,
    thresholds: z.object({ offline: ModeThresholdsSchema, live: ModeThresholdsSchema }).strict(),
    offline: OfflineScriptSchema,
  })
  .strict();

export type RagEvalFixture = z.infer<typeof RagEvalFixtureSchema>;
export type RagEvalFixtureInput = z.input<typeof RagEvalFixtureSchema>;
export type ExpectedRequirement = RagEvalFixture["expected_requirements"][number];

function fail(code: FixtureValidationCode, fixtureId: string | null, message: string): never {
  throw new FixtureValidationError(code, fixtureId, message);
}

function issueText(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "fixture"}: ${issue.message}`).join("; ");
}

function occurrences(haystack: string, needle: string) {
  let found = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    found += 1;
    index = haystack.indexOf(needle, index + 1);
  }
  return found;
}

/** Fixture paragraphs become source blocks one-to-one, so each must already be in normalized block form. */
function assertParagraphs(fixture: RagEvalFixture) {
  fixture.experience.paragraphs.forEach((paragraph, index) => {
    if (paragraph !== paragraph.trim() || /\n/.test(paragraph) || /[ \t]{2,}/.test(paragraph)) {
      fail("paragraph-not-normalized", fixture.fixture_id, `paragraph ${index + 1} must be one trimmed line without repeated spaces.`);
    }
    if (paragraph.length > DEFAULT_SOURCE_BLOCK_MAX_UTF16_UNITS) {
      fail("paragraph-not-normalized", fixture.fixture_id, `paragraph ${index + 1} exceeds the ${DEFAULT_SOURCE_BLOCK_MAX_UTF16_UNITS}-unit block limit.`);
    }
  });
}

/** A ground-truth passage must sit inside exactly one paragraph, exactly once. */
export function assertPassageInExperience(fixture: Pick<RagEvalFixture, "fixture_id" | "experience">, passage: string, label: string) {
  if (passage.length < MIN_PASSAGE_LENGTH) {
    fail("passage-too-short", fixture.fixture_id, `${label} passage "${passage}" is shorter than ${MIN_PASSAGE_LENGTH} characters.`);
  }
  const total = fixture.experience.paragraphs.reduce((sum, paragraph) => sum + occurrences(paragraph, passage), 0);
  if (total === 0) {
    fail("passage-not-in-experience", fixture.fixture_id, `${label} passage is not an exact substring of one experience paragraph: "${passage}"`);
  }
  if (total > 1) {
    fail("passage-ambiguous", fixture.fixture_id, `${label} passage occurs ${total} times in the experience text: "${passage}"`);
  }
}

function assertSemantics(fixture: RagEvalFixture) {
  const id = fixture.fixture_id;
  const requirementIds = new Set<string>();
  for (const requirement of fixture.expected_requirements) {
    if (requirementIds.has(requirement.id)) {
      fail("duplicate-requirement-id", id, `expected requirement ID "${requirement.id}" is repeated.`);
    }
    requirementIds.add(requirement.id);
  }

  const requireKnown = (requirementId: string, where: string) => {
    if (!requirementIds.has(requirementId)) {
      fail("unknown-requirement-reference", id, `${where} references unknown requirement "${requirementId}".`);
    }
  };
  Object.keys(fixture.expected_evidence).forEach((key) => requireKnown(key, "expected_evidence"));
  Object.keys(fixture.distractors).forEach((key) => requireKnown(key, "distractors"));
  fixture.expected_gaps.forEach((key) => requireKnown(key, "expected_gaps"));
  if (new Set(fixture.expected_gaps).size !== fixture.expected_gaps.length) {
    fail("duplicate-requirement-id", id, "expected_gaps repeats a requirement.");
  }

  for (const gap of fixture.expected_gaps) {
    if ((fixture.expected_evidence[gap] ?? []).length > 0) {
      fail("gap-has-expected-evidence", id, `requirement "${gap}" is an expected gap, so it cannot list expected evidence.`);
    }
  }

  // A passage may be a distractor for several requirements, but never both evidence and distractor for one.
  for (const [requirementId, passages] of Object.entries(fixture.expected_evidence)) {
    passages.forEach((passage) => assertPassageInExperience(fixture, passage, `expected_evidence.${requirementId}`));
  }
  for (const [requirementId, passages] of Object.entries(fixture.distractors)) {
    for (const passage of passages) {
      assertPassageInExperience(fixture, passage, `distractors.${requirementId}`);
      if ((fixture.expected_evidence[requirementId] ?? []).includes(passage)) {
        fail("passage-labeled-twice", id, `passage is both expected evidence and a distractor for "${requirementId}": "${passage}"`);
      }
    }
  }

  const script = fixture.offline;
  for (const [query, passages] of Object.entries(script.search)) {
    passages.forEach((passage) => assertPassageInExperience(fixture, passage, `offline.search["${query}"]`));
  }
  for (const entry of script.report) {
    if (entry.requirement > script.requirements.length) {
      fail("offline-script-invalid", id, `offline.report references requirement ${entry.requirement}, but only ${script.requirements.length} are scripted.`);
    }
    entry.cite.forEach((passage) => assertPassageInExperience(fixture, passage, `offline.report[${entry.requirement}]`));
  }
}

/** Validates one fixture: schema version first, then shape, thresholds, revision plan, and ground-truth passages. */
export function parseRagEvalFixture(input: unknown): RagEvalFixture {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("fixture-not-object", null, "fixture must be a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  const fixtureId = typeof raw.fixture_id === "string" ? raw.fixture_id : null;
  if (raw.schema_version !== RAG_EVAL_FIXTURE_SCHEMA_VERSION) {
    fail(
      "schema-version-unsupported",
      fixtureId,
      `schema_version ${JSON.stringify(raw.schema_version)} is not supported; expected "${RAG_EVAL_FIXTURE_SCHEMA_VERSION}".`,
    );
  }
  const thresholds = raw.thresholds as Record<string, unknown> | undefined;
  if (!thresholds || typeof thresholds !== "object" || !thresholds.offline || !thresholds.live) {
    fail("missing-thresholds", fixtureId, "thresholds.offline and thresholds.live are both required.");
  }
  const plan = raw.revision_plan as Record<string, unknown> | undefined;
  if (!plan || !REVISION_PLAN_KINDS.includes(plan.kind as (typeof REVISION_PLAN_KINDS)[number])) {
    fail("unknown-revision-plan", fixtureId, `revision_plan.kind ${JSON.stringify(plan?.kind)} is not one of ${REVISION_PLAN_KINDS.join(", ")}.`);
  }

  const parsed = RagEvalFixtureSchema.safeParse(input);
  if (!parsed.success) {
    const thresholdIssue = parsed.error.issues.find((issue) => issue.path[0] === "thresholds");
    fail(thresholdIssue ? "missing-thresholds" : "fixture-shape-invalid", fixtureId, issueText(parsed.error));
  }
  assertParagraphs(parsed.data);
  assertSemantics(parsed.data);
  return parsed.data;
}

/** Validates a fixture set, including fixture-ID uniqueness across the set. */
export function parseRagEvalFixtures(inputs: unknown[]): RagEvalFixture[] {
  const fixtures = inputs.map(parseRagEvalFixture);
  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (seen.has(fixture.fixture_id)) {
      fail("duplicate-fixture-id", fixture.fixture_id, "fixture ID is used by more than one fixture.");
    }
    seen.add(fixture.fixture_id);
  }
  return [...fixtures].sort((left, right) => left.fixture_id.localeCompare(right.fixture_id));
}

/**
 * Stable hash of the fixture content that seeding depends on (experience text and revision plan). The corpus
 * manifest records it so live preflight can detect a stale seed. Ground truth, thresholds, and offline scripts are
 * excluded: editing them does not require reseeding.
 */
export function hashFixtureCorpusContent(fixture: RagEvalFixture) {
  const content = {
    schema_version: fixture.schema_version,
    fixture_id: fixture.fixture_id,
    experience: fixture.experience,
    revision_plan: fixture.revision_plan,
  };
  return `sha256:${createHash("sha256").update(canonicalStringify(content)).digest("hex")}`;
}

/** The full experience text the seeded DOCX carries: paragraphs separated by blank lines, as extraction joins them. */
export function fixtureExperienceText(fixture: RagEvalFixture) {
  return fixture.experience.paragraphs.join("\n\n");
}
