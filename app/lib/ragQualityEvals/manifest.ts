import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION, RAG_EVAL_MANIFEST_VERSION, RAG_EVAL_OUTPUT_DIR } from "./versions";

export const DEFAULT_MANIFEST_PATH = join(RAG_EVAL_OUTPUT_DIR, "manifest.json");

const ManifestRevisionSchema = z
  .object({
    revision_id: z.string().min(1),
    approved_content_hash: z.string().min(1),
    role: z.enum(["active", "latest-unindexed"]),
    active: z.boolean(),
    indexed: z.boolean(),
  })
  .strict();

const ManifestFixtureSchema = z
  .object({
    fixture_id: z.string().min(1),
    fixture_hash: z.string().min(1),
    file_name: z.string().min(1),
    source_id: z.string().min(1),
    revisions: z.array(ManifestRevisionSchema).min(1),
  })
  .strict();

export const CorpusManifestSchema = z
  .object({
    manifest_version: z.literal(RAG_EVAL_MANIFEST_VERSION),
    fixture_schema_version: z.string().min(1),
    project_ref: z.string().min(1),
    seeded_at: z.string().min(1),
    fixtures: z.array(ManifestFixtureSchema),
  })
  .strict();

export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;
export type CorpusManifestFixture = z.infer<typeof ManifestFixtureSchema>;
export type CorpusManifestRevision = z.infer<typeof ManifestRevisionSchema>;

export function newManifest(projectRef: string, seededAt: string): CorpusManifest {
  return { manifest_version: RAG_EVAL_MANIFEST_VERSION, fixture_schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION, project_ref: projectRef, seeded_at: seededAt, fixtures: [] };
}

/** Local file store for the manifest. Tests use an in-memory store with the same shape. */
export interface ManifestStore {
  read(): CorpusManifest | null;
  write(manifest: CorpusManifest): void;
  remove(): void;
  readonly location: string;
}

export function fileManifestStore(path = DEFAULT_MANIFEST_PATH): ManifestStore {
  return {
    location: path,
    read() {
      if (!existsSync(path)) return null;
      return CorpusManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    },
    write(manifest) {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(CorpusManifestSchema.parse(manifest), null, 2)}\n`);
      renameSync(temporary, path);
    },
    remove() {
      rmSync(path, { force: true });
    },
  };
}

export function memoryManifestStore(initial: CorpusManifest | null = null): ManifestStore & { current: CorpusManifest | null } {
  const store = {
    location: "memory",
    current: initial ? CorpusManifestSchema.parse(structuredClone(initial)) : null,
    read() {
      return store.current ? structuredClone(store.current) : null;
    },
    write(manifest: CorpusManifest) {
      store.current = CorpusManifestSchema.parse(structuredClone(manifest));
    },
    remove() {
      store.current = null;
    },
  };
  return store;
}
