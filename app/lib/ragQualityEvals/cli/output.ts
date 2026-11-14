import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderRagEvalMarkdown, type RagEvalReport } from "../report";
import { RAG_EVAL_OUTPUT_DIR } from "../versions";

/** Writes `<mode>-report.json` and `.md` into the ignored output directory and returns their paths. */
export function writeReportFiles(report: RagEvalReport, directory = RAG_EVAL_OUTPUT_DIR) {
  mkdirSync(directory, { recursive: true });
  const jsonPath = join(directory, `${report.mode}-report.json`);
  const markdownPath = join(directory, `${report.mode}-report.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderRagEvalMarkdown(report));
  return { jsonPath, markdownPath };
}

export function parseFlags(argv: string[]) {
  return {
    json: argv.includes("--json"),
    noWrite: argv.includes("--no-write"),
  };
}
