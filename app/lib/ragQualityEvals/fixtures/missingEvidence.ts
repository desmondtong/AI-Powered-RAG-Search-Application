import type { RagEvalFixtureInput } from "../fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { LIVE_INITIAL, OFFLINE_EXACT } from "./thresholds";

const APP = "Built a SwiftUI iOS app that lets volunteers log tide pool species";
const SYNC = "Added Core Data storage and background sync";

export const missingEvidenceFixture: RagEvalFixtureInput = {
  schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
  fixture_id: "missing-evidence",
  title: "Missing evidence: mobile developer against an embedded hardware JD (synthetic)",
  experience: {
    file_stem: "tidepool-field-notes",
    paragraphs: [
      "Tidepool Field Notes App (synthetic project). Role: iOS Developer at Tidepool Labs, a fictional marine research nonprofit, in 2021.",
      "Built a SwiftUI iOS app that lets volunteers log tide pool species offline and sync later.",
      "Added Core Data storage and background sync for the field notes app.",
    ],
  },
  jd_text: ["Embedded Hardware Engineer", "Required: FPGA design in Verilog.", "Required: firmware in C on a real-time operating system (RTOS)."].join("\n"),
  expected_requirements: [
    { id: "verilog-fpga", text: "FPGA design in Verilog", importance: "required", match_any: ["verilog", "fpga"] },
    { id: "rtos-firmware", text: "Firmware in C on an RTOS", importance: "required", match_any: ["rtos", "real-time operating system", "firmware"] },
  ],
  expected_evidence: {},
  expected_gaps: ["verilog-fpga", "rtos-firmware"],
  distractors: { "rtos-firmware": [SYNC] },
  tolerated_requirements: ["embedded"],
  revision_plan: { kind: "single" },
  thresholds: { offline: { ...OFFLINE_EXACT, distractor_precision: 0 }, live: { ...LIVE_INITIAL, distractor_precision: 0 } },
  offline: {
    requirements: [
      { text: "FPGA design in Verilog", importance: "required", retrieval_query: "FPGA design in Verilog" },
      { text: "Firmware in C on a real-time operating system", importance: "required", retrieval_query: "C firmware on an RTOS" },
    ],
    search: {
      "FPGA design in Verilog": [APP],
      "C firmware on an RTOS": [SYNC],
    },
    report: [
      { requirement: 1, fit: "missing", rationale: "No provided evidence shows FPGA or Verilog work.", cite: [] },
      { requirement: 2, fit: "weak", rationale: "The cited passage shows background sync in a mobile app, not RTOS firmware.", cite: [SYNC] },
    ],
  },
};
