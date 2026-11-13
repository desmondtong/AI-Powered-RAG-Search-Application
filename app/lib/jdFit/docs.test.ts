import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  JD_FIT_CONTEXT_CHARACTERS,
  JD_FIT_DEADLINE_MS,
  JD_FIT_MATCHES_PER_REQUIREMENT,
  JD_FIT_MAX_JD_CHARACTERS,
  JD_FIT_MAX_OUTPUT_TOKENS,
  JD_FIT_MAX_REQUIREMENTS,
  JD_FIT_REPORT_PROMPT_VERSION,
  JD_FIT_REQUIREMENT_PROMPT_VERSION,
  JD_FIT_RETRIEVAL_CONCURRENCY,
  JD_FIT_VALIDATION_VERSION,
} from "./config";
import { JD_FIT_FIT_LABELS, JdFitErrorResponseSchema, JdFitRequestSchema, JdFitResponseSchema } from "./contracts";

const readme = readFileSync(join(process.cwd(), "app/lib/jdFit/README.md"), "utf8");

function example(name: string) {
  const match = readme.match(new RegExp(`<!-- example:${name} -->\\s*\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``));
  assert.ok(match, `README is missing example:${name}`);
  return JSON.parse(match[1]);
}

describe("JD-fit documentation", () => {
  it("has request, response, and error examples that pass the runtime schemas", () => {
    assert.equal(JdFitRequestSchema.safeParse(example("request")).success, true);
    const response = JdFitResponseSchema.safeParse(example("response"));
    assert.equal(response.success, true, response.success ? "" : JSON.stringify(response.error.issues));
    assert.equal(JdFitErrorResponseSchema.safeParse(example("error")).success, true);
  });

  it("shows diagnostics without credentials or private storage paths", () => {
    const response = example("response");
    assert.ok(response.diagnostics.model);
    const serialized = JSON.stringify([example("response"), example("error")]);
    for (const secret of ["service_role", "SUPABASE", "storage_path", "experience-sources/", "GEMINI_API_KEY"]) {
      assert.equal(serialized.includes(secret), false, `example leaks ${secret}`);
    }
  });

  it("documents every fit label and the configured limits and versions", () => {
    for (const label of JD_FIT_FIT_LABELS) {
      assert.match(readme, new RegExp(`\\| \`${label}\` \\|`));
    }
    const formatted = (value: number) => value.toLocaleString("en-US");
    for (const value of [JD_FIT_MAX_JD_CHARACTERS, JD_FIT_CONTEXT_CHARACTERS, JD_FIT_DEADLINE_MS, JD_FIT_MAX_OUTPUT_TOKENS]) {
      assert.ok(readme.includes(formatted(value)), `README is missing ${formatted(value)}`);
    }
    for (const value of [JD_FIT_MAX_REQUIREMENTS, JD_FIT_MATCHES_PER_REQUIREMENT, JD_FIT_RETRIEVAL_CONCURRENCY]) {
      assert.match(readme, new RegExp(`\\| ${value} \\|`));
    }
    for (const version of [JD_FIT_REQUIREMENT_PROMPT_VERSION, JD_FIT_REPORT_PROMPT_VERSION, JD_FIT_VALIDATION_VERSION]) {
      assert.ok(readme.includes(version), `README is missing ${version}`);
    }
  });
});
