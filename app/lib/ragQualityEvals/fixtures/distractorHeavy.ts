import type { RagEvalFixtureInput } from "../fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { LIVE_INITIAL, OFFLINE_EXACT } from "./thresholds";

const AUDIT = "Led WCAG 2.1 AA accessibility audits of the booking flow";
const PROFILE = "Profiled React rendering with the React DevTools profiler";
const TALK = "Attended a conference talk about accessibility";
const WIKI = "Listed React and accessibility as interests on the team wiki page";
const BLOG = "Read a blog series about React performance during onboarding";

export const distractorHeavyFixture: RagEvalFixtureInput = {
  schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
  fixture_id: "distractor-heavy",
  title: "Distractor-heavy: real evidence next to look-alike passages (synthetic)",
  experience: {
    file_stem: "marigold-booking-web",
    paragraphs: [
      "Marigold Booking Web App (synthetic project). Role: Frontend Engineer at Marigold Travel, a fictional travel startup, in 2022.",
      "Led WCAG 2.1 AA accessibility audits of the booking flow and fixed 60 screen reader and keyboard navigation issues.",
      "Attended a conference talk about accessibility and shared the slides with the team.",
      "Profiled React rendering with the React DevTools profiler and removed unnecessary re-renders, halving booking page interaction latency.",
      "Listed React and accessibility as interests on the team wiki page.",
      "Read a blog series about React performance during onboarding.",
    ],
  },
  jd_text: ["Frontend Engineer", "Required: run WCAG accessibility audits and fix the findings.", "Required: React performance profiling and optimization."].join("\n"),
  expected_requirements: [
    { id: "wcag-audits", text: "Run WCAG accessibility audits and fix the findings", importance: "required", match_any: ["wcag", "accessibility"] },
    { id: "react-performance", text: "React performance profiling and optimization", importance: "required", match_any: ["react perf", "react rendering", "profil"] },
  ],
  expected_evidence: {
    "wcag-audits": [AUDIT],
    "react-performance": [PROFILE],
  },
  expected_gaps: [],
  distractors: {
    "wcag-audits": [TALK, WIKI],
    "react-performance": [BLOG, WIKI],
  },
  tolerated_requirements: [],
  revision_plan: { kind: "single" },
  // Scripted search returns one distractor beside each expected passage, so offline precision is exactly 0.5.
  thresholds: { offline: { ...OFFLINE_EXACT, distractor_precision: 0.5 }, live: LIVE_INITIAL },
  offline: {
    requirements: [
      { text: "Run WCAG accessibility audits and fix the findings", importance: "required", retrieval_query: "WCAG accessibility audits" },
      { text: "React performance profiling and optimization", importance: "required", retrieval_query: "React performance profiling" },
    ],
    search: {
      "WCAG accessibility audits": [AUDIT, TALK],
      "React performance profiling": [PROFILE, BLOG],
    },
    report: [
      { requirement: 1, fit: "strong", rationale: "The cited passage shows WCAG audits with fixes.", cite: [AUDIT] },
      { requirement: 2, fit: "strong", rationale: "The cited passage shows React rendering profiling and optimization.", cite: [PROFILE] },
    ],
  },
};
