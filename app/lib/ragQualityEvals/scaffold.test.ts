import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION, RAG_EVAL_RUNNER_VERSION } from "./versions";

describe("rag-eval scaffold", () => {
  it("compiles and runs without model or Supabase credentials", () => {
    assert.match(RAG_EVAL_FIXTURE_SCHEMA_VERSION, /^rag-eval-fixture-v\d+$/);
    assert.match(RAG_EVAL_RUNNER_VERSION, /^rag-eval-runner-v\d+$/);
  });
});
