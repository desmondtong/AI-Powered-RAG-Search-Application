import type { RagEvalFixtureInput } from "../fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { LIVE_INITIAL, OFFLINE_EXACT } from "./thresholds";

const API = "Designed and built TypeScript REST APIs on Node.js for carrier dispatch";
const PG = "Tuned PostgreSQL queries and added composite indexes";
const MENTOR = "Mentored three junior engineers through weekly code reviews";

export const strongMatchFixture: RagEvalFixtureInput = {
  schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
  fixture_id: "strong-match",
  title: "Strong match: backend API engineer (synthetic)",
  experience: {
    file_stem: "lumen-freight-dispatch",
    paragraphs: [
      "Lumen Freight Dispatch Platform (synthetic project). Role: Backend Engineer at Lumen Freight, a fictional logistics company, from 2022 to 2024.",
      "Designed and built TypeScript REST APIs on Node.js for carrier dispatch, serving 40 partner integrations.",
      "Tuned PostgreSQL queries and added composite indexes, cutting the p95 latency of the dispatch search endpoint from 900 ms to 120 ms.",
      "Mentored three junior engineers through weekly code reviews and pairing sessions.",
      "Wrote the on-call runbook for the dispatch service.",
    ],
  },
  jd_text: [
    "Senior Backend Engineer",
    "Required: build TypeScript REST APIs on Node.js.",
    "Required: PostgreSQL performance tuning and indexing.",
    "Preferred: mentoring junior engineers.",
  ].join("\n"),
  expected_requirements: [
    { id: "typescript-rest-apis", text: "Build TypeScript REST APIs on Node.js", importance: "required", match_any: ["typescript", "rest api"] },
    { id: "postgres-tuning", text: "PostgreSQL performance tuning and indexing", importance: "required", match_any: ["postgres"] },
    { id: "mentoring", text: "Mentoring junior engineers", importance: "preferred", match_any: ["mentor"] },
  ],
  expected_evidence: {
    "typescript-rest-apis": [API],
    "postgres-tuning": [PG],
    mentoring: [MENTOR],
  },
  expected_gaps: [],
  distractors: {},
  tolerated_requirements: ["senior", "backend engineering experience"],
  revision_plan: { kind: "single" },
  thresholds: { offline: OFFLINE_EXACT, live: LIVE_INITIAL },
  offline: {
    requirements: [
      { text: "Build TypeScript REST APIs on Node.js", importance: "required", retrieval_query: "built TypeScript REST APIs on Node.js" },
      { text: "PostgreSQL performance tuning and indexing", importance: "required", retrieval_query: "tuned PostgreSQL queries and indexes" },
      { text: "Mentoring junior engineers", importance: "preferred", retrieval_query: "mentored junior engineers" },
    ],
    search: {
      "built TypeScript REST APIs on Node.js": [API],
      "tuned PostgreSQL queries and indexes": [PG],
      "mentored junior engineers": [MENTOR],
    },
    report: [
      { requirement: 1, fit: "strong", rationale: "The cited passage shows TypeScript REST APIs built on Node.js.", cite: [API] },
      { requirement: 2, fit: "strong", rationale: "The cited passage shows PostgreSQL query tuning and indexing.", cite: [PG] },
      { requirement: 3, fit: "strong", rationale: "The cited passage shows mentoring junior engineers.", cite: [MENTOR] },
    ],
  },
};
