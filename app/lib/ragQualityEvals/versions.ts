/** Version of the fixture file format. Bump when fixture fields change meaning. */
export const RAG_EVAL_FIXTURE_SCHEMA_VERSION = "rag-eval-fixture-v1";
/** Version of the runner, metrics, and finding rules. Bump when scoring changes. */
export const RAG_EVAL_RUNNER_VERSION = "rag-eval-runner-v1";
/** Version of the machine-readable report shape. */
export const RAG_EVAL_REPORT_SCHEMA_VERSION = "rag-eval-report-v1";
/** Version of the corpus manifest written by `seed`. */
export const RAG_EVAL_MANIFEST_VERSION = "rag-eval-manifest-v1";
/** Prefix on every seeded file name so corpus sources are recognizable in the project. */
export const RAG_EVAL_FILE_PREFIX = "rag-eval__";
/** Ignored local directory for the corpus manifest and report files. */
export const RAG_EVAL_OUTPUT_DIR = ".rag-eval";
