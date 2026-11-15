import { DROP_ZONE } from "./workspace/copy";

export type DocumentsUploadKind = "experience";

export interface DocumentsUploadConfig {
  kind: DocumentsUploadKind;
  endpoint: string;
  title: string;
  body: string;
  hint: string;
  browseLabel: string;
  uploadingLabel: string;
  accept: string;
}

const UPLOAD_CONFIGS: Record<DocumentsUploadKind, DocumentsUploadConfig> = {
  experience: {
    kind: "experience",
    endpoint: "/api/experiences",
    title: DROP_ZONE.title,
    body: DROP_ZONE.body,
    hint: DROP_ZONE.hint,
    browseLabel: DROP_ZONE.browse,
    uploadingLabel: DROP_ZONE.uploading,
    accept: DROP_ZONE.accept,
  },
};

export function getDocumentsUploadConfig(kind: DocumentsUploadKind = "experience") {
  return UPLOAD_CONFIGS[kind];
}

export function isDocumentsUploadSuccess(kind: DocumentsUploadKind, responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") {
    return false;
  }
  const body = responseBody as Record<string, unknown>;
  return typeof body.source === "object" && body.source !== null && !body.error;
}

export function getDocumentsUploadErrorMessage(responseBody: unknown, fallback = "Upload failed. Try again.") {
  if (!responseBody || typeof responseBody !== "object") {
    return fallback;
  }
  const error = (responseBody as Record<string, unknown>).error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
}

/** The uploaded source's ID, or null when the body has none. */
export function uploadedSourceId(responseBody: unknown): string | null {
  const source = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>).source : null;
  const id = source && typeof source === "object" ? (source as Record<string, unknown>).id : null;
  return typeof id === "string" && id ? id : null;
}

/**
 * Whether the file page should run extract then parse on arrival. Only a genuinely new upload that is still
 * `uploaded` qualifies; a byte-identical re-upload (`already-uploaded`) opens the existing file as it is.
 */
export function shouldAutostart(responseBody: unknown): boolean {
  if (!responseBody || typeof responseBody !== "object") return false;
  const body = responseBody as Record<string, unknown>;
  const source = body.source && typeof body.source === "object" ? (body.source as Record<string, unknown>) : null;
  return body.upload_state === "uploaded" && source?.status === "uploaded" && uploadedSourceId(body) !== null;
}

/** sessionStorage key the upload handler sets and the file page consumes once to start extract then parse. */
export function autostartKey(sourceId: string) {
  return `jdfit:autostart:${sourceId}`;
}
