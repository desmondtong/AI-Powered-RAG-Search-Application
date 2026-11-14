import type { RagEvalFixtureInput } from "../fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { LIVE_INITIAL, OFFLINE_EXACT } from "./thresholds";

const ETL = "Built Python batch ETL pipelines that load soil sensor readings";
const AIRFLOW = "Ran a two-week spike evaluating Apache Airflow";

export const partialMatchFixture: RagEvalFixtureInput = {
  schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
  fixture_id: "partial-match",
  title: "Partial match: data engineer with one gap (synthetic)",
  experience: {
    file_stem: "orchard-sensor-analytics",
    paragraphs: [
      "Orchard Sensor Analytics (synthetic project). Role: Data Engineer at Orchard Sensors, a fictional agritech company, in 2023.",
      "Built Python batch ETL pipelines that load soil sensor readings into a columnar warehouse every hour.",
      "Ran a two-week spike evaluating Apache Airflow for scheduling the ETL jobs; the team kept cron for production.",
      "Wrote data quality checks in Python that flag missing sensor readings.",
    ],
  },
  jd_text: [
    "Data Engineer",
    "Required: build Python ETL pipelines.",
    "Required: operate Apache Airflow DAGs in production.",
    "Required: model warehouse tables with dbt.",
  ].join("\n"),
  expected_requirements: [
    { id: "python-etl", text: "Build Python ETL pipelines", importance: "required", match_any: ["python", "etl"] },
    { id: "airflow", text: "Operate Apache Airflow DAGs in production", importance: "required", match_any: ["airflow"] },
    { id: "dbt", text: "Model warehouse tables with dbt", importance: "required", match_any: ["dbt"] },
  ],
  expected_evidence: {
    "python-etl": [ETL],
    airflow: [AIRFLOW],
  },
  expected_gaps: ["dbt"],
  distractors: {},
  tolerated_requirements: [],
  revision_plan: { kind: "single" },
  thresholds: { offline: OFFLINE_EXACT, live: LIVE_INITIAL },
  offline: {
    requirements: [
      { text: "Build Python ETL pipelines", importance: "required", retrieval_query: "built Python ETL pipelines" },
      { text: "Operate Apache Airflow DAGs in production", importance: "required", retrieval_query: "Apache Airflow DAGs in production" },
      { text: "Model warehouse tables with dbt", importance: "required", retrieval_query: "dbt warehouse models" },
    ],
    search: {
      "built Python ETL pipelines": [ETL],
      "Apache Airflow DAGs in production": [AIRFLOW],
      "dbt warehouse models": [],
    },
    report: [
      { requirement: 1, fit: "strong", rationale: "The cited passage shows Python ETL pipelines.", cite: [ETL] },
      { requirement: 2, fit: "partial", rationale: "The cited passage shows an Airflow evaluation spike, not production operation.", cite: [AIRFLOW] },
      { requirement: 3, fit: "missing", rationale: "No provided evidence mentions dbt.", cite: [] },
    ],
  },
};
