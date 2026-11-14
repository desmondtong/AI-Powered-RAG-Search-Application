import type { IngestionPort } from "./commands";

interface FakeRevision {
  id: string;
  status: "draft" | "approved" | "indexing" | "indexed";
  draft_version: number;
  canonical: Record<string, unknown>;
  hash: string | null;
}

interface FakeSource {
  id: string;
  file_name: string;
  status: string;
  revisions: FakeRevision[];
  active: string | null;
}

/**
 * In-memory stand-in for the accepted ingestion service functions, for corpus command tests. Records every call in
 * order and enforces the same preconditions the real functions do (draft versions, approved-before-index).
 */
export class FakeIngestion {
  readonly calls: string[] = [];
  readonly sources = new Map<string, FakeSource>();
  /** Source IDs whose deletion leaves Storage cleanup pending on the next delete attempt(s). */
  readonly pendingDeletes = new Map<string, number>();
  /** Index calls before a revision publishes. */
  indexBatches = 2;
  /** Unassigned blocks reported by parse, to exercise the acknowledgement save. */
  unassignedBlocks: string[] = [];
  private counter = 0;

  private next(prefix: string) {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(4, "0")}`;
  }

  private source(id: string) {
    const source = this.sources.get(id);
    if (!source) throw Object.assign(new Error(`Experience source ${id} was not found.`), { code: "source-not-found" });
    return source;
  }

  private revision(sourceId: string, revisionId: string) {
    const revision = this.source(sourceId).revisions.find((entry) => entry.id === revisionId);
    if (!revision) throw new Error(`Revision ${revisionId} not found.`);
    return revision;
  }

  /** Seeds an unrelated source directly, as if a user had uploaded it earlier. */
  addExisting(fileName: string) {
    const id = this.next("existing");
    this.sources.set(id, { id, file_name: fileName, status: "indexed", revisions: [], active: null });
    return id;
  }

  port(): IngestionPort {
    return {
      upload: async (file) => {
        this.calls.push(`upload ${file.name}`);
        const id = this.next("source");
        this.sources.set(id, { id, file_name: file.name, status: "uploaded", revisions: [], active: null });
        return { source: { id, status: "uploaded" }, upload_state: "uploaded" };
      },
      extract: async (sourceId) => {
        this.calls.push(`extract ${sourceId}`);
        this.source(sourceId).status = "extracted";
        return { extraction: { warnings: [] } };
      },
      parse: async (sourceId) => {
        this.calls.push(`parse ${sourceId}`);
        const id = this.next("rev");
        const canonical = {
          revision: { revision_id: id, status: "draft", draft_version: 1 },
          experiences: [{ evidence_items: [{ summary: "Parsed summary." }] }],
          review_acknowledgements: { warnings: false, unassigned_blocks: false },
        };
        this.source(sourceId).revisions.push({ id, status: "draft", draft_version: 1, canonical, hash: null });
        this.source(sourceId).status = "draft";
        return { revision_id: id, draft_version: 1, omitted_block_coverage: { unreferencedBlocks: [...this.unassignedBlocks] } };
      },
      getDraft: async (sourceId, revisionId) => {
        this.calls.push(`getDraft ${revisionId}`);
        const revision = this.revision(sourceId, revisionId);
        return { canonical_revision: structuredClone(revision.canonical), draft_version: revision.draft_version };
      },
      saveDraft: async (sourceId, body) => {
        this.calls.push(`saveDraft ${body.revision_id}@${body.expected_draft_version}`);
        const revision = this.revision(sourceId, body.revision_id);
        if (revision.status !== "draft" || revision.draft_version !== body.expected_draft_version) throw new Error("draft-version-conflict");
        revision.canonical = structuredClone(body.draft) as Record<string, unknown>;
        revision.draft_version += 1;
        return { draft_version: revision.draft_version };
      },
      approve: async (sourceId, body) => {
        this.calls.push(`approve ${body.revision_id}@${body.expected_draft_version}`);
        const revision = this.revision(sourceId, body.revision_id);
        if (revision.status !== "draft" || revision.draft_version !== body.expected_draft_version) throw new Error("approval-version-conflict");
        const acks = (revision.canonical.review_acknowledgements ?? {}) as { unassigned_blocks?: boolean };
        if (this.unassignedBlocks.length > 0 && !acks.unassigned_blocks) throw new Error("unassigned-blocks-unacknowledged");
        revision.status = "approved";
        revision.hash = `sha256:${revision.id}:${JSON.stringify(revision.canonical).length}`;
        this.source(sourceId).status = "approved";
        return { revision_id: revision.id, approved_content_hash: revision.hash };
      },
      index: async (sourceId, body) => {
        this.calls.push(`index ${body.revision_id}`);
        const revision = this.revision(sourceId, body.revision_id);
        if (revision.status !== "approved" && revision.status !== "indexing") throw new Error("revision-not-approved");
        const done = this.calls.filter((call) => call === `index ${body.revision_id}`).length >= this.indexBatches;
        revision.status = done ? "indexed" : "indexing";
        if (done) {
          this.source(sourceId).active = revision.id;
          this.source(sourceId).status = "indexed";
        }
        return { status: revision.status };
      },
      createDraftFromApproved: async (sourceId, body) => {
        this.calls.push(`createDraftFromApproved ${body.approved_revision_id}`);
        const approved = this.revision(sourceId, body.approved_revision_id);
        const id = this.next("rev");
        const canonical = structuredClone(approved.canonical);
        (canonical.revision as Record<string, unknown>).revision_id = id;
        this.source(sourceId).revisions.push({ id, status: "draft", draft_version: 1, canonical, hash: null });
        return { revision_id: id, draft_version: 1 };
      },
      deleteSource: async (sourceId) => {
        this.calls.push(`delete ${sourceId}`);
        this.source(sourceId);
        const pending = this.pendingDeletes.get(sourceId) ?? 0;
        if (pending > 0) {
          this.pendingDeletes.set(sourceId, pending - 1);
          return { status: "cleanup-pending", cleanup_pending: true };
        }
        this.sources.delete(sourceId);
        return { status: "deleted", cleanup_pending: false };
      },
      listSources: async () => {
        this.calls.push("list");
        return { sources: [...this.sources.values()].map((source) => ({ id: source.id, file_name: source.file_name, status: source.status })) };
      },
    };
  }
}
