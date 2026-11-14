/**
 * Deterministic eval command (`npm run eval:rag`). Imports only fixtures, the runner, and the report renderer: never
 * the corpus commands, the live mode, or any client factory. Needs no API keys or Supabase variables.
 */
import { loadRagEvalFixtures } from "../fixtures";
import { renderRagEvalMarkdown } from "../report";
import { runOfflineRagEval } from "../runner";
import { parseFlags, writeReportFiles } from "./output";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const report = await runOfflineRagEval(loadRagEvalFixtures());
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
