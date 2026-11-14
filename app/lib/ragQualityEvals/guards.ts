import { RagEvalConfigurationError } from "./adapters";

export type RagEvalEnv = Record<string, string | undefined>;

/** Parses the project ref from a Supabase URL such as `https://<ref>.supabase.co`. */
export function projectRefFromSupabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Live evaluation and every corpus command need `RAG_EVAL_LIVE=1`. */
export function assertLiveEnabled(env: RagEvalEnv) {
  if (env.RAG_EVAL_LIVE !== "1") {
    throw new RagEvalConfigurationError("Refusing to run: set RAG_EVAL_LIVE=1 to enable live evaluation or corpus commands.");
  }
}

/** The configured Supabase project must be the explicitly allowed test project. Returns the project ref. */
export function assertAllowedProject(env: RagEvalEnv): string {
  const allowed = env.RAG_EVAL_ALLOWED_PROJECT_REF?.trim();
  if (!allowed) {
    throw new RagEvalConfigurationError("Refusing to run: set RAG_EVAL_ALLOWED_PROJECT_REF to the test project's ref.");
  }
  const configured = projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!configured) {
    throw new RagEvalConfigurationError("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is missing or is not a Supabase project URL.");
  }
  if (configured !== allowed) {
    throw new RagEvalConfigurationError(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL points at project ${configured}, but RAG_EVAL_ALLOWED_PROJECT_REF is ${allowed}.`,
    );
  }
  return configured;
}

/** Guards every corpus command and live evaluation share. Returns the allowed project ref. */
export function assertLiveProject(env: RagEvalEnv): string {
  assertLiveEnabled(env);
  return assertAllowedProject(env);
}

/** `reset` deletes every experience source, so it needs its own flag on top of the shared guards. */
export function assertResetAllowed(env: RagEvalEnv) {
  if (env.RAG_EVAL_ALLOW_RESET !== "1") {
    throw new RagEvalConfigurationError("Refusing to reset: set RAG_EVAL_ALLOW_RESET=1 in addition to RAG_EVAL_LIVE=1.");
  }
}
