function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const JD_FIT_MODEL =
  process.env.JD_FIT_MODEL || process.env.GEMINI_GENERATION_MODEL || "gemini-flash-lite-latest";
export const JD_FIT_REQUIREMENT_PROMPT_VERSION = "jd-fit-requirements-v1";
export const JD_FIT_REPORT_PROMPT_VERSION = "jd-fit-report-v1";
export const JD_FIT_VALIDATION_VERSION = "jd-fit-validation-v1";

export const JD_FIT_MAX_JD_CHARACTERS = readPositiveInt("JD_FIT_MAX_JD_CHARACTERS", 20_000);
export const JD_FIT_MAX_REQUIREMENTS = readPositiveInt("JD_FIT_MAX_REQUIREMENTS", 20);
export const JD_FIT_MATCHES_PER_REQUIREMENT = readPositiveInt("JD_FIT_MATCHES_PER_REQUIREMENT", 8);
export const JD_FIT_CONTEXT_CHARACTERS = readPositiveInt("JD_FIT_CONTEXT_CHARACTERS", 16_000);
export const JD_FIT_DEADLINE_MS = readPositiveInt("JD_FIT_DEADLINE_MS", 120_000);
export const JD_FIT_MAX_OUTPUT_TOKENS = readPositiveInt("JD_FIT_MAX_OUTPUT_TOKENS", 16_384);
export const JD_FIT_RETRIEVAL_CONCURRENCY = 4;
export const JD_FIT_MATCH_THRESHOLD = -1;
export const JD_FIT_MAX_RATIONALE_CHARACTERS = 1_200;
