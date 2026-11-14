import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as evidenceServer from "../../evidenceServer";
import { RagEvalConfigurationError } from "../adapters";
import { hashFixtureCorpusContent } from "../fixtureSchema";
import { loadRagEvalFixtures } from "../fixtures";
import { memoryManifestStore, newManifest } from "../manifest";
import { fixtureFileName } from "../offlineExport";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "../versions";
import { resetCorpus, seedCorpus, teardownCorpus, type CorpusContext } from "./commands";
import { FakeIngestion } from "./fakeIngestion";

const REF = "abcdefghijklmnopqrst";
const LIVE_ENV = { RAG_EVAL_LIVE: "1", RAG_EVAL_ALLOWED_PROJECT_REF: REF, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` };

function setup(env: Record<string, string | undefined> = LIVE_ENV) {
  const fake = new FakeIngestion();
  const store = memoryManifestStore();
  let portsCreated = 0;
  const context: CorpusContext = {
    env,
    port: () => {
      portsCreated += 1;
      return fake.port();
    },
    store,
    fixtures: loadRagEvalFixtures(),
    clock: () => Date.UTC(2026, 10, 14),
  };
  return { fake, store, context, portsCreated: () => portsCreated };
}

const genericCalls: string[] = [];
const genericOriginals: Array<[string, unknown]> = [];
beforeEach(() => {
  genericCalls.length = 0;
  const target = evidenceServer as unknown as Record<string, unknown>;
  for (const name of ["insertProjectEvidence", "deleteProjectEvidence", "searchProjectEvidence"]) {
    genericOriginals.push([name, target[name]]);
    target[name] = () => {
      genericCalls.push(name);
      throw new Error("generic documents must not be touched");
    };
  }
});
afterEach(() => {
  const target = evidenceServer as unknown as Record<string, unknown>;
  for (const [name, original] of genericOriginals.splice(0)) target[name] = original;
});

describe("rag-eval corpus guards", () => {
  const refusals: Array<[string, Record<string, string | undefined>]> = [
    ["live flag missing", { ...LIVE_ENV, RAG_EVAL_LIVE: undefined }],
    ["allowed ref missing", { ...LIVE_ENV, RAG_EVAL_ALLOWED_PROJECT_REF: undefined }],
    ["project mismatch", { ...LIVE_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }],
    ["Supabase URL missing", { ...LIVE_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined }],
  ];

  for (const [label, env] of refusals) {
    it(`refuses every command before any write when the ${label}`, async () => {
      for (const run of [(c: CorpusContext) => seedCorpus(c), teardownCorpus, (c: CorpusContext) => resetCorpus({ ...c, env: { ...c.env, RAG_EVAL_ALLOW_RESET: "1" } })]) {
        const { fake, store, context, portsCreated } = setup(env);
        store.write(newManifest(REF, "2026-01-01T00:00:00.000Z"));
        await assert.rejects(run(context), RagEvalConfigurationError);
        assert.equal(portsCreated(), 0, "no ingestion client was created");
        assert.deepEqual(fake.calls, []);
        assert.ok(store.read(), "the manifest is untouched");
      }
    });
  }

  it("requires the extra reset flag on top of the shared guards", async () => {
    const { fake, context, portsCreated } = setup();
    fake.addExisting("user-upload.docx");
    await assert.rejects(resetCorpus(context), /RAG_EVAL_ALLOW_RESET=1/);
    assert.equal(portsCreated(), 0);
    assert.equal(fake.sources.size, 1);
  });

  it("never imports the corpus module from the deterministic command", () => {
    const root = join(process.cwd(), "app/lib/ragQualityEvals");
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const [, specifier] of text.matchAll(/from "(\.[^"]+)"/g)) {
        const base = resolve(dirname(file), specifier);
        const candidates = [`${base}.ts`, join(base, "index.ts")];
        const next = candidates.find((candidate) => {
          try {
            readFileSync(candidate);
            return true;
          } catch {
            return false;
          }
        });
        if (next && next.startsWith(root)) visit(next);
      }
    };
    visit(join(root, "cli/offline.ts"));
    const reached = [...seen].map((file) => file.slice(root.length + 1));
    assert.ok(reached.includes("runner.ts"));
    assert.deepEqual(reached.filter((file) => file.startsWith("corpus/") || file === "live.ts" || file === "guards.ts" || file === "manifest.ts"), []);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.doesNotMatch(pkg.scripts["test:rag-eval"] + pkg.scripts["eval:rag"], /RAG_EVAL_|corpus\.js/);
  });
});

describe("rag-eval corpus seed", () => {
  it("seeds every fixture through upload, extract, parse, approve, and index, and writes the manifest", async () => {
    const { fake, store, context } = setup();
    const { manifest } = await seedCorpus(context);
    const fixtures = loadRagEvalFixtures();

    assert.equal(manifest.project_ref, REF);
    assert.equal(manifest.fixture_schema_version, RAG_EVAL_FIXTURE_SCHEMA_VERSION);
    assert.equal(manifest.seeded_at, "2026-11-14T00:00:00.000Z");
    assert.deepEqual(store.read(), manifest);
    assert.deepEqual(manifest.fixtures.map((entry) => entry.fixture_id), fixtures.map((fixture) => fixture.fixture_id));

    for (const entry of manifest.fixtures) {
      const fixture = fixtures.find((candidate) => candidate.fixture_id === entry.fixture_id)!;
      assert.equal(entry.fixture_hash, hashFixtureCorpusContent(fixture));
      assert.equal(entry.file_name, fixtureFileName(fixture));
      assert.match(entry.file_name, /^rag-eval__/);
      const active = entry.revisions.find((revision) => revision.role === "active")!;
      const source = fake.sources.get(entry.source_id)!;
      assert.equal(source.active, active.revision_id);
      assert.deepEqual([active.active, active.indexed], [true, true]);
      assert.equal(active.approved_content_hash, source.revisions.find((revision) => revision.id === active.revision_id)!.hash);

      // Per-source call order: upload, extract, parse, approve at the parsed version, then index until published.
      const r1 = active.revision_id;
      const calls = fake.calls.filter((call) => call.includes(entry.source_id) || call.includes(r1) || call === `upload ${entry.file_name}`);
      assert.deepEqual(calls.slice(0, 6), [`upload ${entry.file_name}`, `extract ${entry.source_id}`, `parse ${entry.source_id}`, `approve ${r1}@1`, `index ${r1}`, `index ${r1}`]);
    }
  });

  it("acknowledges unassigned blocks with a saved draft before approving, using the saved version", async () => {
    const { fake, context } = setup();
    fake.unassignedBlocks = ["block-0001"];
    context.fixtures = context.fixtures.filter((fixture) => fixture.fixture_id === "strong-match");
    const { manifest } = await seedCorpus(context);
    const r1 = manifest.fixtures[0].revisions[0].revision_id;
    assert.deepEqual(fake.calls.filter((call) => call.includes(r1)), [`getDraft ${r1}`, `saveDraft ${r1}@1`, `approve ${r1}@2`, `index ${r1}`, `index ${r1}`]);
  });

  it("approves R2 without indexing it for the active-vs-latest plan, and records both identities", async () => {
    const { fake, context } = setup();
    context.fixtures = context.fixtures.filter((fixture) => fixture.fixture_id === "active-vs-latest");
    const { manifest } = await seedCorpus(context);
    const [entry] = manifest.fixtures;
    const [r1, r2] = entry.revisions;
    assert.deepEqual([r1.role, r1.active, r1.indexed], ["active", true, true]);
    assert.deepEqual([r2.role, r2.active, r2.indexed], ["latest-unindexed", false, false]);
    assert.notEqual(r1.approved_content_hash, r2.approved_content_hash);
    assert.deepEqual(fake.calls.filter((call) => call.includes(r2.revision_id) || call.startsWith("createDraft")), [
      `createDraftFromApproved ${r1.revision_id}`,
      `getDraft ${r2.revision_id}`,
      `saveDraft ${r2.revision_id}@1`,
      `approve ${r2.revision_id}@2`,
    ]);
    assert.equal(fake.calls.some((call) => call === `index ${r2.revision_id}`), false, "R2 is never indexed");
    const source = fake.sources.get(entry.source_id)!;
    assert.equal(source.active, r1.revision_id);
    const r2Summary = (source.revisions.find((revision) => revision.id === r2.revision_id)!.canonical as { experiences: Array<{ evidence_items: Array<{ summary: string }> }> }).experiences[0].evidence_items[0].summary;
    assert.match(r2Summary, /\(revised after review\)$/);
  });

  it("refuses while a manifest exists, and --replace tears the manifest sources down first", async () => {
    const { fake, store, context } = setup();
    const first = await seedCorpus(context);
    const callsAfterFirst = fake.calls.length;
    await assert.rejects(seedCorpus(context), /manifest already exists/);
    assert.equal(fake.calls.length, callsAfterFirst, "refusal performs no calls");

    const second = await seedCorpus(context, { replace: true });
    const newCalls = fake.calls.slice(callsAfterFirst);
    const firstUpload = newCalls.findIndex((call) => call.startsWith("upload"));
    assert.deepEqual(newCalls.slice(0, firstUpload), first.manifest.fixtures.map((entry) => `delete ${entry.source_id}`));
    assert.ok(second.replaced?.manifest_removed);
    assert.equal(fake.sources.size, second.manifest.fixtures.length);
    assert.deepEqual(store.read(), second.manifest);
  });

  it("deletes the partial source and keeps earlier fixtures in the manifest when seeding fails", async () => {
    const { fake, store, context } = setup();
    fake.indexBatches = 99;
    context.maxIndexCalls = 3;
    await assert.rejects(seedCorpus(context), /not indexed after 3 index calls/);
    assert.equal(fake.sources.size, 0, "the partial source was deleted");
    assert.equal(store.read(), null, "no fixture completed, so no manifest was written");
  });
});

describe("rag-eval corpus teardown and reset", () => {
  it("deletes manifest sources, keeps the manifest while cleanup is pending, and is idempotent", async () => {
    const { fake, store, context } = setup();
    const { manifest } = await seedCorpus(context);
    const pending = manifest.fixtures[0].source_id;
    fake.pendingDeletes.set(pending, 1);

    const first = await teardownCorpus(context);
    assert.equal(first.manifest_removed, false);
    assert.deepEqual(first.results.filter((result) => result.status === "cleanup-pending").map((result) => result.source_id), [pending]);
    assert.deepEqual(store.read()!.fixtures.map((entry) => entry.source_id), [pending]);

    const second = await teardownCorpus(context);
    assert.equal(second.manifest_removed, true);
    assert.equal(store.read(), null);
    assert.equal(fake.sources.size, 0);

    const callsBefore = fake.calls.length;
    const third = await teardownCorpus(context);
    assert.deepEqual(third, { results: [], manifest_removed: false });
    assert.equal(fake.calls.length, callsBefore, "teardown without a manifest makes no calls");

    // A manifest source that is already gone counts as deleted.
    store.write({ ...manifest, fixtures: [manifest.fixtures[1]] });
    const fourth = await teardownCorpus(context);
    assert.equal(fourth.results[0].status, "already-deleted");
    assert.equal(fourth.manifest_removed, true);
    assert.deepEqual(genericCalls, []);
  });

  it("reset deletes every experience source, not just the corpus, and never touches generic documents", async () => {
    const { fake, store, context } = setup({ ...LIVE_ENV, RAG_EVAL_ALLOW_RESET: "1" });
    await seedCorpus(context);
    fake.addExisting("someone-elses-upload.docx");
    const result = await resetCorpus(context);
    assert.equal(fake.sources.size, 0);
    assert.equal(result.results.length, 7);
    assert.ok(result.results.some((entry) => entry.fixture_id === null), "non-corpus sources are deleted too");
    assert.equal(result.manifest_removed, true);
    assert.equal(store.read(), null);
    assert.deepEqual(genericCalls, []);
  });

  it("binds only experience ingestion functions in the default port", () => {
    const text = readFileSync(join(process.cwd(), "app/lib/ragQualityEvals/corpus/ingestionPort.ts"), "utf8");
    assert.doesNotMatch(text, /evidenceServer|ProjectEvidence|\/api\/(upload|documents)|documentExtraction/);
    const imports = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(imports, ["../../experience/apiService", "./commands"]);
  });
});
