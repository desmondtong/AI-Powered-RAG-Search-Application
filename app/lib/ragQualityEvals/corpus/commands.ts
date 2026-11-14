/**
 * Corpus lifecycle commands: the only code in the eval harness that writes. Every command checks its guards before
 * touching the ingestion port, and every write goes through the accepted ingestion service functions.
 */
import { RagEvalConfigurationError } from "../adapters";
import { hashFixtureCorpusContent, type RagEvalFixture } from "../fixtureSchema";
import { assertLiveProject, assertResetAllowed, type RagEvalEnv } from "../guards";
import { newManifest, type CorpusManifest, type CorpusManifestFixture, type ManifestStore } from "../manifest";
import { DOCX_MIME_TYPE, fixtureFileName } from "../offlineExport";
import { buildMinimalDocx } from "./docx";

/** The ingestion operations corpus commands use, shaped like the accepted service functions' results. */
export interface IngestionPort {
  upload(file: File): Promise<{ source: { id: string; status: string }; upload_state: string }>;
  extract(sourceId: string): Promise<{ extraction: { warnings: string[] } }>;
  parse(sourceId: string): Promise<{ revision_id: string; draft_version: number; omitted_block_coverage: { unreferencedBlocks: string[] } }>;
  getDraft(sourceId: string, revisionId: string): Promise<{ canonical_revision: Record<string, unknown>; draft_version: number }>;
  saveDraft(sourceId: string, body: { revision_id: string; expected_draft_version: number; draft: unknown }): Promise<{ draft_version: number }>;
  approve(sourceId: string, body: { revision_id: string; expected_draft_version: number }): Promise<{ revision_id: string; approved_content_hash: string }>;
  index(sourceId: string, body: { revision_id: string }): Promise<{ status: string }>;
  createDraftFromApproved(sourceId: string, body: { approved_revision_id: string }): Promise<{ revision_id: string; draft_version: number }>;
  deleteSource(sourceId: string): Promise<{ status: string; cleanup_pending: boolean }>;
  listSources(): Promise<{ sources: Array<{ id: string; file_name: string; status: string }> }>;
}

export interface CorpusContext {
  env: RagEvalEnv;
  /** Created only after the guards pass, so a refused command never constructs a client. */
  port: () => IngestionPort;
  store: ManifestStore;
  fixtures: RagEvalFixture[];
  clock?: () => number;
  log?: (line: string) => void;
  /** Maximum index calls per revision; indexing may take several batches. */
  maxIndexCalls?: number;
}

export interface DeletionResult {
  source_id: string;
  fixture_id: string | null;
  status: "deleted" | "already-deleted" | "cleanup-pending" | "failed";
  message?: string;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : null;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function deleteOne(port: IngestionPort, sourceId: string, fixtureId: string | null): Promise<DeletionResult> {
  try {
    const result = await port.deleteSource(sourceId);
    return { source_id: sourceId, fixture_id: fixtureId, status: result.cleanup_pending ? "cleanup-pending" : "deleted" };
  } catch (error) {
    if (errorCode(error) === "source-not-found") return { source_id: sourceId, fixture_id: fixtureId, status: "already-deleted" };
    return { source_id: sourceId, fixture_id: fixtureId, status: "failed", message: errorText(error) };
  }
}

const settled = (result: DeletionResult) => result.status === "deleted" || result.status === "already-deleted";

export interface TeardownResult {
  results: DeletionResult[];
  manifest_removed: boolean;
}

/** Deletes every manifest source. The manifest is kept, listing only unfinished sources, until all deletes succeed. */
export async function teardownCorpus(context: CorpusContext): Promise<TeardownResult> {
  assertLiveProject(context.env);
  const manifest = context.store.read();
  if (!manifest) {
    context.log?.("No corpus manifest; nothing to tear down.");
    return { results: [], manifest_removed: false };
  }
  return teardownManifest(context, manifest, context.port());
}

async function teardownManifest(context: CorpusContext, manifest: CorpusManifest, port: IngestionPort): Promise<TeardownResult> {
  const results: DeletionResult[] = [];
  for (const entry of manifest.fixtures) {
    const result = await deleteOne(port, entry.source_id, entry.fixture_id);
    context.log?.(`${entry.fixture_id}: ${result.status}${result.message ? ` (${result.message})` : ""}`);
    results.push(result);
  }
  const remaining = manifest.fixtures.filter((entry) => !settled(results.find((result) => result.source_id === entry.source_id)!));
  if (remaining.length === 0) {
    context.store.remove();
    return { results, manifest_removed: true };
  }
  context.store.write({ ...manifest, fixtures: remaining });
  context.log?.(`${remaining.length} source(s) are cleanup-pending or failed; the manifest keeps them. Run teardown again to retry.`);
  return { results, manifest_removed: false };
}

export interface ResetResult {
  results: DeletionResult[];
  manifest_removed: boolean;
}

/** Deletes every experience source in the allowed project. Generic documents are never touched. */
export async function resetCorpus(context: CorpusContext): Promise<ResetResult> {
  assertLiveProject(context.env);
  assertResetAllowed(context.env);
  const port = context.port();
  const manifest = context.store.read();
  const fixtureBySource = new Map(manifest?.fixtures.map((entry) => [entry.source_id, entry.fixture_id]) ?? []);
  const { sources } = await port.listSources();
  const results: DeletionResult[] = [];
  for (const source of sources) {
    const result = await deleteOne(port, source.id, fixtureBySource.get(source.id) ?? null);
    context.log?.(`${source.file_name} (${source.id}): ${result.status}${result.message ? ` (${result.message})` : ""}`);
    results.push(result);
  }
  const clean = results.every(settled);
  if (clean) context.store.remove();
  return { results, manifest_removed: clean };
}

const DOCX_TYPE = DOCX_MIME_TYPE;

async function indexUntilPublished(port: IngestionPort, sourceId: string, revisionId: string, maxCalls: number) {
  for (let call = 1; call <= maxCalls; call += 1) {
    const result = await port.index(sourceId, { revision_id: revisionId });
    if (result.status === "indexed") return call;
  }
  throw new Error(`Revision ${revisionId} was not indexed after ${maxCalls} index calls.`);
}

/** Approves the parsed draft, saving review acknowledgements first only when approval would otherwise refuse it. */
async function approveParsedDraft(
  port: IngestionPort,
  sourceId: string,
  parsed: { revision_id: string; draft_version: number; omitted_block_coverage: { unreferencedBlocks: string[] } },
  warnings: string[],
  log?: (line: string) => void,
) {
  let version = parsed.draft_version;
  const needsAck = parsed.omitted_block_coverage.unreferencedBlocks.length > 0 || warnings.length > 0;
  if (needsAck) {
    const draft = await port.getDraft(sourceId, parsed.revision_id);
    const canonical = draft.canonical_revision as { review_acknowledgements?: Record<string, boolean> };
    const saved = await port.saveDraft(sourceId, {
      revision_id: parsed.revision_id,
      expected_draft_version: version,
      draft: {
        ...canonical,
        review_acknowledgements: {
          warnings: warnings.length > 0 || Boolean(canonical.review_acknowledgements?.warnings),
          unassigned_blocks: parsed.omitted_block_coverage.unreferencedBlocks.length > 0 || Boolean(canonical.review_acknowledgements?.unassigned_blocks),
        },
      },
    });
    version = saved.draft_version;
    log?.(`  acknowledged ${parsed.omitted_block_coverage.unreferencedBlocks.length} unassigned block(s) and ${warnings.length} warning(s) before approval`);
  }
  return port.approve(sourceId, { revision_id: parsed.revision_id, expected_draft_version: version });
}

/** Creates R2 from the approved R1, applies the fixture's grounded summary edit, saves, and approves it unindexed. */
async function seedLatestUnindexed(port: IngestionPort, sourceId: string, r1: string, suffix: string) {
  const created = await port.createDraftFromApproved(sourceId, { approved_revision_id: r1 });
  const draft = await port.getDraft(sourceId, created.revision_id);
  const canonical = structuredClone(draft.canonical_revision) as { experiences: Array<{ evidence_items: Array<{ summary: string }> }> };
  const item = canonical.experiences.flatMap((experience) => experience.evidence_items)[0];
  if (!item) throw new Error(`R2 for source ${sourceId} has no evidence item to edit.`);
  item.summary = `${item.summary}${suffix}`;
  const saved = await port.saveDraft(sourceId, { revision_id: created.revision_id, expected_draft_version: created.draft_version, draft: canonical });
  return port.approve(sourceId, { revision_id: created.revision_id, expected_draft_version: saved.draft_version });
}

async function seedFixture(context: CorpusContext, port: IngestionPort, fixture: RagEvalFixture): Promise<CorpusManifestFixture> {
  const fileName = fixtureFileName(fixture);
  const bytes = buildMinimalDocx(fixture.experience.paragraphs);
  const uploaded = await port.upload(new File([new Uint8Array(bytes)], fileName, { type: DOCX_TYPE }));
  const sourceId = uploaded.source.id;
  if (uploaded.upload_state !== "uploaded") {
    throw new RagEvalConfigurationError(
      `${fixture.fixture_id}: ${fileName} already exists as source ${sourceId} (${uploaded.source.status}). Run teardown or reset first.`,
    );
  }
  context.log?.(`${fixture.fixture_id}: uploaded ${fileName} as ${sourceId}`);
  try {
    const extracted = await port.extract(sourceId);
    const parsed = await port.parse(sourceId);
    const r1 = await approveParsedDraft(port, sourceId, parsed, extracted.extraction.warnings, context.log);
    const indexCalls = await indexUntilPublished(port, sourceId, r1.revision_id, context.maxIndexCalls ?? 20);
    context.log?.(`  R1 ${r1.revision_id} approved and indexed (${indexCalls} index call(s))`);
    const revisions: CorpusManifestFixture["revisions"] = [
      { revision_id: r1.revision_id, approved_content_hash: r1.approved_content_hash, role: "active", active: true, indexed: true },
    ];
    if (fixture.revision_plan.kind === "active-r1-latest-r2-unindexed") {
      const r2 = await seedLatestUnindexed(port, sourceId, r1.revision_id, fixture.revision_plan.r2_evidence_summary_suffix);
      context.log?.(`  R2 ${r2.revision_id} approved, not indexed`);
      revisions.push({ revision_id: r2.revision_id, approved_content_hash: r2.approved_content_hash, role: "latest-unindexed", active: false, indexed: false });
    }
    return { fixture_id: fixture.fixture_id, fixture_hash: hashFixtureCorpusContent(fixture), file_name: fileName, source_id: sourceId, revisions };
  } catch (error) {
    const cleanup = await deleteOne(port, sourceId, fixture.fixture_id);
    context.log?.(`${fixture.fixture_id}: seeding failed (${errorText(error)}); partial source ${cleanup.status}`);
    throw error;
  }
}

export interface SeedResult {
  manifest: CorpusManifest;
  replaced: TeardownResult | null;
}

/**
 * Seeds every fixture through the accepted ingestion workflow and writes the manifest after each fixture, so a
 * failed seed leaves a manifest that `teardown` can clean up. Refuses while a manifest exists unless `replace` is set.
 */
export async function seedCorpus(context: CorpusContext, options: { replace?: boolean } = {}): Promise<SeedResult> {
  const projectRef = assertLiveProject(context.env);
  const existing = context.store.read();
  if (existing && !options.replace) {
    throw new RagEvalConfigurationError(
      `A corpus manifest already exists at ${context.store.location} (${existing.fixtures.length} fixture(s), seeded ${existing.seeded_at}). Run teardown, or seed with --replace.`,
    );
  }
  const port = context.port();
  let replaced: TeardownResult | null = null;
  if (existing) {
    replaced = await teardownManifest(context, existing, port);
    if (!replaced.manifest_removed) {
      throw new RagEvalConfigurationError("Replace stopped: some existing corpus sources could not be deleted. Run teardown again first.");
    }
  }

  const clock = context.clock ?? Date.now;
  const manifest = newManifest(projectRef, new Date(clock()).toISOString());
  const fixtures = [...context.fixtures].sort((left, right) => left.fixture_id.localeCompare(right.fixture_id));
  for (const fixture of fixtures) {
    manifest.fixtures.push(await seedFixture(context, port, fixture));
    context.store.write(manifest);
  }
  return { manifest, replaced };
}
