import { NextResponse } from "next/server";

export class ExperienceApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ExperienceApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertSameOriginMutation(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    return;
  }

  const requestOrigin = new URL(req.url).origin;
  if (origin !== requestOrigin) {
    throw new ExperienceApiError("cross-origin-rejected", "Cross-origin experience mutations are not allowed.", 403);
  }
}

export function assertTrustedReadBoundary(req: Request): void {
  const origin = req.headers.get("origin");
  const requestOrigin = new URL(req.url).origin;
  if (origin && origin !== requestOrigin) {
    throw new ExperienceApiError("cross-origin-rejected", "Cross-origin experience reads are not allowed.", 403);
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ExperienceApiError("cross-origin-rejected", "Cross-origin experience reads are not allowed.", 403);
  }
}

export function requireExperienceSourceId(id: string | null | undefined): string {
  const value = id?.trim();
  if (!value) {
    throw new ExperienceApiError("source-id-required", "Experience source ID is required.", 400);
  }
  return value;
}

export function requireExperienceRevisionId(id: string | null | undefined): string {
  const value = id?.trim();
  if (!value) {
    throw new ExperienceApiError("revision-id-required", "Experience revision ID is required.", 400);
  }
  return value;
}

export async function getRouteSourceId(context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  return requireExperienceSourceId(params.id);
}

export async function getRouteSourceAndRevisionIds(
  context: { params: Promise<{ id?: string; revisionId?: string }> },
) {
  const params = await context.params;
  return {
    sourceId: requireExperienceSourceId(params.id),
    revisionId: requireExperienceRevisionId(params.revisionId),
  };
}

export function safeErrorResponse(error: unknown) {
  if (error instanceof ExperienceApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "Experience request failed.";
  return NextResponse.json(
    {
      error: {
        code: "experience-request-failed",
        message,
      },
    },
    { status: 500 },
  );
}

export function experienceJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
