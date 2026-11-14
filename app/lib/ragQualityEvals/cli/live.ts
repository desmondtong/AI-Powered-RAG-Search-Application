/**
 * Live eval command (`npm run eval:rag:live`). Opt-in: refuses unless RAG_EVAL_LIVE=1 and RAG_EVAL_ALLOWED_PROJECT_REF
 * matches the project in NEXT_PUBLIC_SUPABASE_URL. Runs real JD-fit against the resident seeded corpus and only reads.
 */
import { loadRagEvalFixtures } from "../fixtures";
import { assertLiveProject } from "../guards";
import { runLiveRagEval } from "../live";
import { fileManifestStore } from "../manifest";
import { renderRagEvalMarkdown } from "../report";
import { parseFlags, writeReportFiles } from "./output";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const projectRef = assertLiveProject(process.env);
  const report = await runLiveRagEval({ fixtures: loadRagEvalFixtures(), manifest: fileManifestStore().read(), projectRef });
  process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : renderRagEvalMarkdown(report));
  if (!flags.noWrite) {
    const files = writeReportFiles(report);
    process.stderr.write(`Report written to ${files.jsonPath} and ${files.markdownPath}\n`);
  }
  process.exitCode = report.status === "pass" ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exitCode = 2;
});
