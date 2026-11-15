import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readApprovedRevisionContent,
  searchApprovedExperienceEvidence,
  type ApprovedRevisionContentClient,
} from "../experience/approvedSearch";
import { JD_FIT_MAX_OUTPUT_TOKENS } from "./config";
import { evaluateJobDescription } from "./evaluate";
import type { JdFitLabelLookup, JdFitSearch } from "./retrieval";
import { ScriptedModelClient, jsonResponse, makeHit } from "./testFixtures";

const root = process.cwd();

function jdFitSources() {
  const libDir = join(root, "app/lib/jdFit");
  const files = readdirSync(libDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "testFixtures.ts")
    .map((name) => join("app/lib/jdFit", name));
  files.push("app/api/jd-fit/route.ts");
  return files.map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
}

const FORBIDDEN = [
  // retired generic search and its helpers, kept to catch reintroduction
  "generateAnswer",
  "/api/search",
  "match_documents",
  "match_document_chunks",
  "searchProjectEvidence",
  "evidenceServer",
  // retained history used for discovery
  "getExperienceRevisionExport",
  "latest_approved_revision_id",
  // ingestion mutation paths
  "apiService",
  "draftPersistence",
  "embeddingPreparation",
  "sourceStorage",
  "/api/experiences",
  "approve_experience_revision",
  "publish_experience_revision",
  "stage_experience_embeddings",
  "acquire_experience_source_execution",
  "complete_experience_source_execution",
  "create_experience_draft_from_approved",
  "update_experience_revision_draft",
  "delete_experience_source",
  "reserve_experience_source",
  "reconcile_experience_source_storage",
  "insert_project_evidence",
  "deleteProjectEvidence",
  ".storage",
];

describe("JD-fit isolation", () => {
  it("never references generic search, retained-history discovery, or ingestion mutation code", () => {
    for (const { file, text } of jdFitSources()) {
      for (const token of FORBIDDEN) {
        assert.equal(text.includes(token), false, `${file} must not reference ${token}`);
      }
    }
  });

  it("imports only the approved-search helper from ingestion and nothing from the shared Gemini embedding helper", () => {
    for (const { file, text } of jdFitSources()) {
      const imports = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
      for (const specifier of imports) {
        if (specifier.includes("/experience/")) {
          assert.equal(specifier, "../experience/approvedSearch", `${file} imports ${specifier}`);
        }
        assert.notEqual(specifier, "../gemini", `${file} must not import the shared Gemini embedding helper`);
        assert.equal(specifier.includes("supabase"), false, `${file} must not import a Supabase client directly`);
      }
    }
  });

  it("finds no generic upload, search, or document route left in the app", () => {
    for (const route of ["app/api/upload/route.ts", "app/api/search/route.ts", "app/api/documents/route.ts"]) {
      assert.equal(existsSync(join(root, route)), false, `${route} must not exist`);
    }
  });

  it("keeps the JD-fit output token limit on its own setting", () => {
    assert.equal(JD_FIT_MAX_OUTPUT_TOKENS, 16_384);
  });

  it("performs only the approved-search RPC during a full evaluation", async () => {
    const rpcCalls: string[] = [];
    const hit = makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." });
    const client = {
      rpc: async (fn: string) => {
        rpcCalls.push(fn);
        return {
          data: [
            {
              ...hit,
              parent_source_document_id: hit.parent.source_document_id,
              parent_source_file_name: hit.parent.source_file_name,
              parent_source_file_type: hit.parent.source_file_type,
              parent_text: hit.parent.parent_text,
              parent_metadata: hit.parent.metadata,
              parent_created_at: hit.parent.created_at,
              parent_updated_at: hit.parent.updated_at,
            },
          ],
          error: null,
        };
      },
    };
    const search: JdFitSearch = (query, options) =>
      searchApprovedExperienceEvidence(query, { ...options, client, embed: async () => Array.from({ length: 1536 }, () => 0.01) });
    const model = new ScriptedModelClient({
      requirements: [jsonResponse({ requirements: [{ text: "TypeScript APIs", importance: "required", retrieval_query: "TypeScript API" }] })],
      report: [jsonResponse({ assessments: [{ requirement_id: "R1", fit: "strong", rationale: "E1 shows it.", evidence_handles: ["E1"] }] })],
    });

    const tableCalls: string[] = [];
    const labelClient: ApprovedRevisionContentClient = {
      from(table) {
        tableCalls.push(`from:${table}`);
        return {
          select(columns) {
            tableCalls.push(`select:${columns}`);
            return {
              in(column, values) {
                tableCalls.push(`in:${column}:${values.join(",")}`);
                return {
                  in(column2, values2) {
                    tableCalls.push(`in:${column2}:${values2.join(",")}`);
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    const labelLookup: JdFitLabelLookup = (revisionIds, sourceIds) =>
      readApprovedRevisionContent(revisionIds, sourceIds, { client: labelClient });

    const report = await evaluateJobDescription({ jdText: "Backend engineer" }, { client: model, search, labelLookup });
    assert.equal(report.status, "evaluated");
    assert.deepEqual(rpcCalls, ["match_approved_experience_chunks"]);
    assert.deepEqual(tableCalls, [
      "from:experience_revisions",
      "select:id, source_id, approved_json",
      `in:id:${hit.revision_id}`,
      `in:source_id:${hit.source_id}`,
    ]);
  });

  it("keeps the citation label lookup to a single select", () => {
    const text = readFileSync(join(root, "app/lib/experience/approvedSearch.ts"), "utf8");
    const start = text.indexOf("export async function readApprovedRevisionContent");
    assert.ok(start > 0, "readApprovedRevisionContent exists");
    const body = text.slice(start);
    assert.equal((body.match(/\.select\(/g) ?? []).length, 1);
    for (const mutation of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", ".storage"]) {
      assert.equal(body.includes(mutation), false, `label lookup must not call ${mutation}`);
    }
  });
});
