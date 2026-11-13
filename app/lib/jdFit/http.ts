import { NextResponse } from "next/server";
import { JdFitError, type JdFitErrorResponse } from "./contracts";
import { evaluateJobDescription, type EvaluateJobDescriptionDependencies } from "./evaluate";

/**
 * Rejects requests another website made the browser send. Mirrors the experience routes' trusted-read check
 * (Origin must match; Sec-Fetch-Site must be same-origin or a direct navigation) without editing ingestion code.
 */
export function assertSameOriginJdFitRequest(req: Request): void {
  const requestOrigin = new URL(req.url).origin;
  const origin = req.headers.get("origin");
  if (origin && origin !== requestOrigin) {
    throw new JdFitError("cross-origin-rejected", "Cross-origin JD-fit requests are not allowed.", 403);
  }
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new JdFitError("cross-origin-rejected", "Cross-origin JD-fit requests are not allowed.", 403);
  }
}

/** Stable error body. Unknown errors are reported generically so internal details never reach the browser. */
export function jdFitErrorBody(error: unknown): { status: number; body: JdFitErrorResponse } {
  if (error instanceof JdFitError) {
    const details = Object.keys(error.details).length > 0 ? publicDetails(error.details) : undefined;
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(details ? { details } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "jd-fit-failed", message: "JD-fit evaluation failed. Try again.", retryable: true } },
  };
}

const PUBLIC_DETAIL_KEYS = new Set(["stage", "length", "max", "count", "fields", "finishReason", "blockReason"]);

function publicDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details).filter(([key]) => PUBLIC_DETAIL_KEYS.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Handles one POST /api/jd-fit request. Dependencies are injectable for tests; the route passes none. */
export async function handleJdFitRequest(req: Request, dependencies: EvaluateJobDescriptionDependencies = {}) {
  try {
    assertSameOriginJdFitRequest(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new JdFitError("invalid-request", "JD-fit request must be a JSON object with a jdText string.", 400);
    }
    return NextResponse.json(await evaluateJobDescription(body, dependencies));
  } catch (error) {
    const { status, body } = jdFitErrorBody(error);
    if (status >= 500) {
      console.error("JD-fit evaluation failed:", error instanceof JdFitError ? error.code : "unexpected error");
    }
    return NextResponse.json(body, { status });
  }
}
