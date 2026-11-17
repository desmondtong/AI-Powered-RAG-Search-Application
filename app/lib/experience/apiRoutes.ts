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

function firstHeaderValue(req: Request, name: string): string | null {
  const value = req.headers.get(name)?.split(",")[0]?.trim();
  return value ? value : null;
}

/**
 * The origin the browser actually used. Behind a TLS-terminating front end such as Cloud Run, the server sees
 * plain HTTP and its own listen address in `req.url`, so the public scheme comes from `X-Forwarded-Proto` (set and
 * overwritten by the front end) and the public host from `X-Forwarded-Host` or `Host`, which a browser cannot
 * forge for a cross-site request. Without those headers, `req.url` decides, as before.
 */
export function publicRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = firstHeaderValue(req, "x-forwarded-host") ?? firstHeaderValue(req, "host");
  if (!host) {
    return url.origin;
  }
  const forwardedProto = firstHeaderValue(req, "x-forwarded-proto")?.toLowerCase();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : url.protocol.slice(0, -1);
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
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

  if (origin !== publicRequestOrigin(req)) {
    throw new ExperienceApiError("cross-origin-rejected", "Cross-origin experience mutations are not allowed.", 403);
  }
}

export function assertTrustedReadBoundary(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin && origin !== publicRequestOrigin(req)) {
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
