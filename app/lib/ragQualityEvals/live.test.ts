import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceServiceClient } from "../experience/apiService";
import { RagEvalConfigurationError } from "./adapters";
import { identityKey } from "./anchors";
import { loadRagEvalFixtures } from "./fixtures";
import { assertLiveProject } from "./guards";
import { SEED_COMMAND, defaultLiveReadPort, preflightLiveCorpus, runLiveRagEval } from "./live";
import { TEST_PROJECT_REF, liveCorpusHarness, scriptedLiveDependencies } from "./testSupport";

function harness() {
  const fixtures = loadRagEvalFixtures();
  const built = liveCorpusHarness(fixtures);
  return { fixtures, ...built, port: defaultLiveReadPort(built.client as unknown as ExperienceServiceClient) };
}

async function expectStale(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof RagEvalConfigurationError);
    assert.match(error.message, pattern);
    assert.ok(error.message.includes(SEED_COMMAND), "names the seed command");
    return true;
  });
}

describe("rag-eval live preflight", () => {
  it("resolves anchors from the manifest identities and the retained exports", async () => {
    const h = harness();
    const index = await preflightLiveCorpus({ manifest: h.manifest, fixtures: h.fixtures, projectRef: TEST_PROJECT_REF, port: h.port });
    for (const entry of h.manifest.fixtures) {
      const corpus = index.bySource.get(entry.source_id)!;
      const active = entry.revisions.find((revision) => revision.role === "active")!;
      assert.equal(corpus.active.revision_id, active.revision_id);
      for (const anchor of [...corpus.expected.values(), ...corpus.distractors.values()].flat()) {
        assert.equal(anchor.revision_id, active.revision_id);
        assert.equal(anchor.approved_content_hash, active.approved_content_hash);
      }
      const latest = entry.revisions.find((revision) => revision.role === "latest-unindexed");
      if (latest) assert.equal(index.revisions.get(identityKey({ source_id: entry.source_id, ...latest }))?.role, "latest-unindexed");
    }
    assert.deepEqual(h.client.mutations(), []);
  });

  it("fails with a configuration error naming seed when the manifest is missing or from another project", async () => {
    const h = harness();
    await expectStale(preflightLiveCorpus({ manifest: null, fixtures: h.fixtures, projectRef: TEST_PROJECT_REF, port: h.port }), /no corpus manifest/);
    await expectStale(preflightLiveCorpus({ manifest: h.manifest, fixtures: h.fixtures, projectRef: "zyxwvutsrqponmlkjihg", port: h.port }), /seeded into project/);
  });

  it("fails when a manifest source is not active on its revision or not indexed", async () => {
    const notActive = harness();
    notActive.sources[0].active_revision_id = "some-other-revision";
    await expectStale(preflightLiveCorpus({ manifest: notActive.manifest, fixtures: notActive.fixtures, projectRef: TEST_PROJECT_REF, port: notActive.port }), /is not active on revision/);

    const notIndexed = harness();
    notIndexed.revisions.find((row) => row.status === "indexed")!.status = "indexing";
    await expectStale(preflightLiveCorpus({ manifest: notIndexed.manifest, fixtures: notIndexed.fixtures, projectRef: TEST_PROJECT_REF, port: notIndexed.port }), /is not indexed/);

    const deleted = harness();
    deleted.sources[1].deleted_at = "2026-02-01T00:00:00.000Z";
    await expectStale(preflightLiveCorpus({ manifest: deleted.manifest, fixtures: deleted.fixtures, projectRef: TEST_PROJECT_REF, port: deleted.port }), /could not be read/);

    const r2Indexed = harness();
    r2Indexed.revisions.find((row) => row.status === "approved")!.status = "indexed";
    await expectStale(preflightLiveCorpus({ manifest: r2Indexed.manifest, fixtures: r2Indexed.fixtures, projectRef: TEST_PROJECT_REF, port: r2Indexed.port }), /no longer the latest approved, unindexed revision/);
  });

  it("detects fixtures that changed, disappeared, or were added since seeding", async () => {
    const changed = harness();
    changed.fixtures[0].experience.paragraphs[1] = `${changed.fixtures[0].experience.paragraphs[1]} Extra.`;
    await expectStale(preflightLiveCorpus({ manifest: changed.manifest, fixtures: changed.fixtures, projectRef: TEST_PROJECT_REF, port: changed.port }), /changed since it was seeded/);

    const fewer = harness();
    await expectStale(preflightLiveCorpus({ manifest: fewer.manifest, fixtures: fewer.fixtures.slice(1), projectRef: TEST_PROJECT_REF, port: fewer.port }), /fixture set differs/);

    const schema = harness();
    await expectStale(
      preflightLiveCorpus({ manifest: { ...schema.manifest, fixture_schema_version: "rag-eval-fixture-v0" }, fixtures: schema.fixtures, projectRef: TEST_PROJECT_REF, port: schema.port }),
      /fixture schema/,
    );

    const thresholdOnly = harness();
    thresholdOnly.fixtures[0].thresholds.live.retrieval_recall = 0.9;
    await preflightLiveCorpus({ manifest: thresholdOnly.manifest, fixtures: thresholdOnly.fixtures, projectRef: TEST_PROJECT_REF, port: thresholdOnly.port });
  });

  it("fails when an export no longer carries the manifest identity", async () => {
    const h = harness();
    const active = h.manifest.fixtures[0].revisions.find((revision) => revision.role === "active")!;
    active.approved_content_hash = "sha256:tampered";
    await expectStale(preflightLiveCorpus({ manifest: h.manifest, fixtures: h.fixtures, projectRef: TEST_PROJECT_REF, port: h.port }), /export-identity-mismatch/);
  });
});

describe("rag-eval live run", () => {
  it("marks the report live and non-deterministic, and evaluates without writing", async () => {
    const h = harness();
    const scripted = scriptedLiveDependencies(h.fixtures);
    const report = await runLiveRagEval({
      fixtures: h.fixtures,
      manifest: h.manifest,
      projectRef: TEST_PROJECT_REF,
      port: h.port,
      dependenciesFor: scripted.dependenciesFor,
      clock: () => Date.UTC(2026, 10, 14),
    });
    assert.equal(report.mode, "live");
    assert.equal(report.live, true);
    assert.equal(report.deterministic, false);
    assert.match(report.run_id, /^live-20261114T000000000Z$/);
    assert.equal(report.status, "pass");
    assert.ok(report.fixtures.every((fixture) => fixture.cited_revisions.every((revision) => revision.role === "active")));
    assert.deepEqual(h.client.mutations(), []);
  });

  it("refuses to start live evaluation without the live flag or on another project", () => {
    const ref = "abcdefghijklmnopqrst";
    assert.throws(() => assertLiveProject({ RAG_EVAL_ALLOWED_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` }), RagEvalConfigurationError);
    assert.throws(() => assertLiveProject({ RAG_EVAL_LIVE: "1", RAG_EVAL_ALLOWED_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }), RagEvalConfigurationError);
    assert.equal(assertLiveProject({ RAG_EVAL_LIVE: "1", RAG_EVAL_ALLOWED_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` }), ref);
  });
});
