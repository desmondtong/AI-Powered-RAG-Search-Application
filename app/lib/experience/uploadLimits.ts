/**
 * The largest experience file the server accepts. Lives in its own dependency-free module so the drop zone can
 * check a file before sending it, while the server's validation (extractionValidation.ts) stays authoritative and
 * reads the same value.
 */
export const EXPERIENCE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
