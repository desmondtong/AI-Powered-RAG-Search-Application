/**
 * Corpus commands (`npm run rag-eval:corpus -- seed [--replace] | teardown | reset`). The only writers in the eval
 * harness. Each refuses before any write unless RAG_EVAL_LIVE=1 and RAG_EVAL_ALLOWED_PROJECT_REF matches the project
 * in NEXT_PUBLIC_SUPABASE_URL; reset also needs RAG_EVAL_ALLOW_RESET=1. Never part of CI.
 */
import { resetCorpus, seedCorpus, teardownCorpus, type CorpusContext } from "../corpus/commands";
import { defaultIngestionPort } from "../corpus/ingestionPort";
import { loadRagEvalFixtures } from "../fixtures";
import { fileManifestStore } from "../manifest";

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const context: CorpusContext = {
    env: process.env,
    port: () => defaultIngestionPort(),
    store: fileManifestStore(),
    fixtures: loadRagEvalFixtures(),
    log: (line) => process.stderr.write(`${line}\n`),
  };
  let summary: unknown;
  if (command === "seed") {
    const result = await seedCorpus(context, { replace: flags.includes("--replace") });
    summary = { command, manifest: context.store.location, fixtures: result.manifest.fixtures, replaced: result.replaced };
  } else if (command === "teardown") {
    summary = { command, ...(await teardownCorpus(context)) };
  } else if (command === "reset") {
    summary = { command, ...(await resetCorpus(context)) };
  } else {
    process.stderr.write("Usage: npm run rag-eval:corpus -- seed [--replace] | teardown | reset\n");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exitCode = 1;
});
