import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolvePassageAnchor } from "./anchors";
import { parseRagEvalFixture } from "./fixtureSchema";
import { synthesizeOfflineCorpusEntry } from "./offlineExport";
import { FAILING_EXAMPLES } from "./scenarios";
import { FINDING_CATEGORIES } from "./types";

export function readEvalReadme() {
  return readFileSync(join(process.cwd(), "app/lib/ragQualityEvals/README.md"), "utf8");
}

export function readmeBlock(name: string) {
  const readme = readEvalReadme();
  const match = readme.match(new RegExp(`<!-- ${name}:start -->\\s*\`\`\`[a-z]*\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- ${name}:end -->`));
  assert.ok(match, `README block ${name} is missing`);
  return match[1];
}

describe("rag-eval README: fixtures", () => {
  it("documents an example fixture that passes the validator and resolves its passages", () => {
    const fixture = parseRagEvalFixture(JSON.parse(readmeBlock("example-fixture")));
    const entry = synthesizeOfflineCorpusEntry(fixture);
    for (const passage of [...Object.values(fixture.expected_evidence).flat(), ...Object.values(fixture.distractors).flat()]) {
      assert.equal(resolvePassageAnchor(entry.active, { passage }).covered, true);
    }
  });

  it("documents anchor rules, revision plans, redaction policy, and thresholds", () => {
    const readme = readEvalReadme();
    for (const heading of ["### Passage-anchor rules", "### Revision plans", "### Redaction policy", "### Threshold conventions"]) {
      assert.ok(readme.includes(heading), heading);
    }
    assert.match(readme, /Physical vector row IDs/);
    assert.match(readme, /active-r1-latest-r2-unindexed/);
  });
});

describe("rag-eval README: deterministic mode", () => {
  it("documents the deterministic command that package.json defines", () => {
    const command = readmeBlock("deterministic-command").trim();
    assert.equal(command, "npm run eval:rag");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["eval:rag"], /cli\/offline\.js/);
    assert.doesNotMatch(pkg.scripts["eval:rag"], /env-file/, "the deterministic command must not load .env.local");
  });

  it("runs the documented command's entry point without API keys or Supabase variables", () => {
    const entry = join(process.cwd(), ".rag-eval-test-build/app/lib/ragQualityEvals/cli/offline.js");
    const result = spawnSync(process.execPath, [entry, "--no-write"], { env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# RAG quality eval: PASS/);
    assert.match(result.stdout, /harness checks over scripted inputs/);
  });
});

describe("rag-eval README: reports", () => {
  it("documents every finding category and threshold policy", () => {
    const readme = readEvalReadme();
    for (const category of FINDING_CATEGORIES) {
      assert.ok(readme.includes(`| \`${category}\` |`), `README documents ${category}`);
    }
    for (const heading of ["### Reading a report", "### Metrics", "### Finding categories", "### Threshold policy"]) {
      assert.ok(readme.includes(heading), heading);
    }
  });

  it("maps each documented failing example to its category", async () => {
    const documented = JSON.parse(readmeBlock("failing-examples")) as Array<{ example: string; category: string }>;
    assert.deepEqual(documented.map((entry) => entry.example).sort(), FAILING_EXAMPLES.map((entry) => entry.id).sort());
    for (const entry of documented) {
      const example = FAILING_EXAMPLES.find((candidate) => candidate.id === entry.example)!;
      assert.equal(example.category, entry.category, entry.example);
      const report = await example.run();
      assert.equal(report.status, "fail", entry.example);
      const findings = report.findings.filter((finding) => finding.category === entry.category);
      assert.ok(findings.length > 0, `${entry.example} produces ${entry.category}`);
      if (example.requirement_id) {
        assert.ok(findings.some((finding) => finding.requirement_id === example.requirement_id), `${entry.example} names ${example.requirement_id}`);
      }
    }
  });
});

describe("rag-eval README: corpus", () => {
  it("documents the corpus commands package.json defines, their guards, and that they are the only writers outside CI", () => {
    const readme = readEvalReadme();
    const commands = readmeBlock("corpus-commands");
    for (const command of ["seed", "seed --replace", "teardown", "reset"]) {
      assert.ok(commands.includes(`npm run rag-eval:corpus -- ${command}`), command);
    }
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["rag-eval:corpus"], /cli\/corpus\.js/);
    for (const guard of ["RAG_EVAL_LIVE=1", "RAG_EVAL_ALLOWED_PROJECT_REF", "RAG_EVAL_ALLOW_RESET=1"]) {
      assert.ok(readme.includes(guard), guard);
    }
    assert.match(readme, /corpus commands are the \*\*only writers\*\*/);
    assert.match(readme, /\*\*never part of CI\*\*/);
    assert.match(readme, /Seed once, run live evaluations as often as needed, and tear down or reset only by choice/);
    assert.ok(readme.includes("### Cost expectations"));
  });
});

describe("rag-eval README: live mode", () => {
  it("documents live mode as optional, opt-in, excluded from CI, and not a substitute for the deterministic suite", () => {
    const readme = readEvalReadme();
    assert.match(readme, /Live mode is \*\*optional\*\*/);
    assert.match(readme, /\*\*not a substitute for the deterministic suite\*\*/);
    assert.match(readme, /\*\*excluded from CI pass\/fail\*\*/);
    for (const heading of ["### Prerequisites", "### Seed once, evaluate repeatedly", "### Interpreting live results"]) {
      assert.ok(readme.includes(heading), heading);
    }
    const command = readmeBlock("live-command");
    assert.match(command, /RAG_EVAL_LIVE=1 RAG_EVAL_ALLOWED_PROJECT_REF=<project-ref> npm run eval:rag:live/);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["eval:rag:live"], /cli\/live\.js/);
    assert.doesNotMatch(pkg.scripts["test:rag-eval"], /live/);
  });
});
