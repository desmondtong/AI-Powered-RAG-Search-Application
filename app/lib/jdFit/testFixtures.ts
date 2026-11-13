import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import type { JdFitModelClient, JdFitModelResponse } from "./generation";

export interface HitOptions {
  chunkRowId: string;
  text: string;
  sourceId?: string;
  revisionId?: string;
  approvedContentHash?: string;
  logicalExperienceId?: string;
  logicalChunkId?: string | null;
  evidenceLogicalIds?: string[];
  blockId?: string;
  start?: number;
  similarity?: number;
  fileName?: string;
}

export function makeHit(options: HitOptions): ApprovedExperienceSearchResult {
  const sourceId = options.sourceId ?? "11111111-1111-4111-8111-111111111111";
  const revisionId = options.revisionId ?? "22222222-2222-4222-8222-222222222222";
  const logicalExperienceId = options.logicalExperienceId ?? "exp-atlas";
  const logicalParentId = `${logicalExperienceId}:parent-1`;
  const start = options.start ?? 0;
  const blockId = options.blockId ?? "b1";
  return {
    id: options.chunkRowId,
    parent_id: `parent-row-${logicalExperienceId}`,
    child_text: options.text,
    embedding_text: `Experience: ${logicalExperienceId}\n${options.text}`,
    metadata: {
      source_span: { block_id: blockId, start, end: start + options.text.length, text: options.text },
      evidence_logical_ids: options.evidenceLogicalIds ?? [`${logicalExperienceId}:ev-1`],
    },
    chunk_index: 0,
    similarity: options.similarity ?? 0.8,
    source_id: sourceId,
    revision_id: revisionId,
    approved_content_hash: options.approvedContentHash ?? `sha256:${revisionId}`,
    logical_experience_id: logicalExperienceId,
    logical_parent_id: logicalParentId,
    logical_chunk_id: options.logicalChunkId === undefined ? `${logicalExperienceId}:chunk-${options.chunkRowId}` : options.logicalChunkId,
    parent: {
      id: `parent-row-${logicalExperienceId}`,
      source_document_id: sourceId,
      source_file_name: options.fileName ?? "experience.docx",
      source_file_type: "docx",
      parent_text: `Project context for ${logicalExperienceId}. ${options.text}`,
      metadata: {},
      created_at: "2026-11-13T00:00:00.000Z",
      updated_at: "2026-11-13T00:00:00.000Z",
    },
  };
}

export function jsonResponse(value: unknown, finishReason = "STOP"): JdFitModelResponse {
  return { text: JSON.stringify(value), candidates: [{ finishReason }] };
}

export type ScriptedPhase = "requirements" | "report";

export interface ScriptedModelCall {
  phase: ScriptedPhase;
  contents: string;
  config: Record<string, unknown>;
  model: string;
}

/** Model client that answers each phase from its own queue, identified by the prompt-version marker. */
export class ScriptedModelClient implements JdFitModelClient {
  readonly calls: ScriptedModelCall[] = [];
  private readonly queues: Record<ScriptedPhase, Array<JdFitModelResponse | Error>>;

  constructor(queues: Partial<Record<ScriptedPhase, Array<JdFitModelResponse | Error>>>) {
    this.queues = { requirements: [...(queues.requirements ?? [])], report: [...(queues.report ?? [])] };
  }

  models = {
    generateContent: async (request: { model: string; contents: string; config: Record<string, unknown> }) => {
      const phase: ScriptedPhase = request.contents.includes("TASK_VERSION: jd-fit-report") ? "report" : "requirements";
      this.calls.push({ phase, contents: request.contents, config: request.config, model: request.model });
      const next = this.queues[phase].shift();
      if (!next) {
        throw new Error(`No scripted ${phase} response left.`);
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };

  phaseCalls(phase: ScriptedPhase) {
    return this.calls.filter((call) => call.phase === phase);
  }
}

export interface SearchCall {
  query: string;
  options: Record<string, unknown>;
}

export function scriptedSearch(resultsByQuery: Record<string, ApprovedExperienceSearchResult[]>) {
  const calls: SearchCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const search = async (query: string, options: object) => {
    calls.push({ query, options: { ...options } as Record<string, unknown> });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return resultsByQuery[query] ?? [];
  };
  return {
    search,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}
