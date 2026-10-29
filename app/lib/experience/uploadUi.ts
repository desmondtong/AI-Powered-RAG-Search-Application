export type DocumentsUploadKind = "generic" | "experience";

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
  generic: {
    kind: "generic",
    endpoint: "/api/upload",
    title: "Upload Generic Document",
    inputLabel: "Select a file (PDF, DOCX, or TXT)",
    accept: ".pdf,.docx,.txt",
    buttonLabel: "Upload Document",
    uploadingLabel: "Uploading and Processing...",
    supportedLabel: "Supported: PDF, DOCX, TXT",
    supportDetail: "Files will be processed and embedded for generic RAG search.",
  },
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

export function getDocumentsUploadConfig(kind: DocumentsUploadKind = "generic") {
  return UPLOAD_CONFIGS[kind];
}

export function isDocumentsUploadSuccess(kind: DocumentsUploadKind, responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") {
    return false;
  }
  const body = responseBody as Record<string, unknown>;
  if (kind === "generic") {
    return body.success === true;
  }
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
  if (kind === "generic") {
    const fileName = typeof body.fileName === "string" ? body.fileName : fallbackFileName;
    const chunks = typeof body.chunks === "number" ? body.chunks : 0;
    return `File "${fileName}" uploaded successfully! Processed ${chunks} chunks.`;
  }

  const source = body.source && typeof body.source === "object" ? (body.source as Record<string, unknown>) : {};
  const fileName = typeof source.file_name === "string" ? source.file_name : fallbackFileName;
  const nextAction = typeof body.next_action === "string" ? body.next_action : "extract";
  return `Experience "${fileName}" uploaded successfully. Next action: ${nextAction}.`;
}
