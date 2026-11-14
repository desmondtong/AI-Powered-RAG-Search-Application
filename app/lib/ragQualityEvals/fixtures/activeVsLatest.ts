import type { RagEvalFixtureInput } from "../fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { LIVE_INITIAL, OFFLINE_EXACT } from "./thresholds";

const TERRAFORM = "Wrote Terraform modules that provision VPCs";
const AWS_NET = "provision VPCs, subnets, and security groups on AWS";

export const activeVsLatestFixture: RagEvalFixtureInput = {
  schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
  fixture_id: "active-vs-latest",
  title: "Active R1 indexed, latest R2 approved but not indexed (synthetic)",
  experience: {
    file_stem: "basalt-cloud-migration",
    paragraphs: [
      "Basalt Cloud Migration (synthetic project). Role: Infrastructure Engineer at Basalt Analytics, a fictional analytics firm, from 2019 to 2021.",
      "Wrote Terraform modules that provision VPCs, subnets, and security groups on AWS for twelve services.",
      "Moved the deployment pipeline to a hosted CI service with plan and apply stages for every Terraform change.",
    ],
  },
  jd_text: ["Infrastructure Engineer", "Required: infrastructure as code with Terraform.", "Preferred: AWS networking (VPCs, subnets)."].join("\n"),
  expected_requirements: [
    { id: "terraform", text: "Infrastructure as code with Terraform", importance: "required", match_any: ["terraform", "infrastructure as code"] },
    { id: "aws-networking", text: "AWS networking (VPCs, subnets)", importance: "preferred", match_any: ["aws", "vpc", "network"] },
  ],
  expected_evidence: {
    terraform: [TERRAFORM],
    "aws-networking": [AWS_NET],
  },
  expected_gaps: [],
  distractors: {},
  tolerated_requirements: [],
  revision_plan: { kind: "active-r1-latest-r2-unindexed", r2_evidence_summary_suffix: " (revised after review)" },
  thresholds: { offline: OFFLINE_EXACT, live: LIVE_INITIAL },
  offline: {
    requirements: [
      { text: "Infrastructure as code with Terraform", importance: "required", retrieval_query: "Terraform infrastructure as code" },
      { text: "AWS networking (VPCs, subnets)", importance: "preferred", retrieval_query: "AWS VPC and subnet networking" },
    ],
    search: {
      "Terraform infrastructure as code": [TERRAFORM],
      "AWS VPC and subnet networking": [AWS_NET],
    },
    report: [
      { requirement: 1, fit: "strong", rationale: "The cited passage shows Terraform modules.", cite: [TERRAFORM] },
      { requirement: 2, fit: "strong", rationale: "The cited passage shows AWS VPC and subnet provisioning.", cite: [AWS_NET] },
    ],
  },
};
