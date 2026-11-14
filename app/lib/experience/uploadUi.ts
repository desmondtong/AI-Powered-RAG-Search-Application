export type DocumentsUploadKind = "experience";

export interface DocumentsUploadConfig {
  kind: DocumentsUploadKind;
  endpoint: string;
  title: string;
  inputLabel: string;
  accept: string;
  buttonLabel: string;
  uploadingLabel: string;
  supportedLabel: string;
  supportDetail: string;
}

const UPLOAD_CONFIGS: Record<DocumentsUploadKind, DocumentsUploadConfig> = {
  experience: {
    kind: "experience",
    endpoint: "/api/experiences",
    title: "Upload Experience",
    inputLabel: "Select an experience file (PDF or DOCX)",
    accept: ".pdf,.docx",
    buttonLabel: "Upload Experience",
    uploadingLabel: "Uploading Experience...",
    supportedLabel: "Supported: PDF, DOCX",
    supportDetail: "Experience files are retained privately for source-grounded review before indexing.",
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

export function getDocumentsUploadErrorMessage(responseBody: unknown, fallback = "Upload failed") {
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

export function getDocumentsUploadSuccessMessage(
  kind: DocumentsUploadKind,
  responseBody: unknown,
  fallbackFileName: string,
) {
  const body = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : {};
  const source = body.source && typeof body.source === "object" ? (body.source as Record<string, unknown>) : {};
  const fileName = typeof source.file_name === "string" ? source.file_name : fallbackFileName;
  const nextAction = typeof body.next_action === "string" ? body.next_action : "extract";
  return `Experience "${fileName}" uploaded successfully. Next action: ${nextAction}.`;
}
