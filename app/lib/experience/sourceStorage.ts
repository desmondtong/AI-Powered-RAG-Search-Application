import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "../supabaseServer";
import type { SourceWorkflowStatus } from "./contracts";

export const EXPERIENCE_SOURCES_BUCKET = "experience-sources";

export type ExperienceSourceBytes = ArrayBuffer | Uint8Array | Buffer;
export type ExperienceSourceUploadState = "uploaded" | "already-uploaded";

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  name?: string;
  status?: number | string;
  statusCode?: number | string;
}

interface RpcResponse {
  data: unknown;
  error: SupabaseErrorLike | null;
}

interface StorageUploadResponse {
  data: unknown;
  error: SupabaseErrorLike | null;
}

export interface ExperienceSourceStorageClient {
  rpc(functionName: string, args?: Record<string, unknown>): Promise<RpcResponse>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: false },
      ): Promise<StorageUploadResponse>;
    };
  };
}

interface ExperienceSourceRow {
  id: string;
  original_byte_sha256: string;
  original_file_name: string;
  original_file_type: string;
  original_file_size: number;
  storage_bucket: string;
  storage_path: string;
  status: string;
  storage_uploaded_at: string | null;
}

export interface ExperienceSourceStorageInput {
  bytes: ExperienceSourceBytes;
  fileName: string;
  fileType?: string | null;
}

export interface ExperienceSourceReservation {
  id: string;
  originalByteSha256: string;
  originalFileName: string;
  originalFileType: string;
  originalFileSize: number;
  status: SourceWorkflowStatus;
  storage: {
    bucket: typeof EXPERIENCE_SOURCES_BUCKET;
    path: string;
    uploadedAt: string | null;
  };
}

export interface StoredExperienceSource extends ExperienceSourceReservation {
  uploadState: ExperienceSourceUploadState;
}

function requireNonEmptyText(value: string | null | undefined, name: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} must be non-empty text.`);
  }
  return trimmed;
}

function toBuffer(bytes: ExperienceSourceBytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function hashExperienceSourceBytes(bytes: ExperienceSourceBytes) {
  return createHash("sha256").update(toBuffer(bytes)).digest("hex");
}

function extensionForStoragePath(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,16})$/);
  return match?.[1] ?? "bin";
}

export function buildExperienceSourceStoragePath(byteSha256: string, fileName: string) {
  const normalizedHash = requireNonEmptyText(byteSha256, "byteSha256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error("byteSha256 must be a 64-character hex SHA-256 digest.");
  }
  return `sources/sha256/${normalizedHash.slice(0, 2)}/${normalizedHash}/original.${extensionForStoragePath(fileName)}`;
}

function normalizeRpcRow(data: unknown): ExperienceSourceRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Experience source reservation returned no row.");
  }
  return row as ExperienceSourceRow;
}

function toReservation(row: ExperienceSourceRow): ExperienceSourceReservation {
  if (row.storage_bucket !== EXPERIENCE_SOURCES_BUCKET) {
    throw new Error("Experience source reservation returned an unexpected storage bucket.");
  }
  return {
    id: row.id,
    originalByteSha256: row.original_byte_sha256,
    originalFileName: row.original_file_name,
    originalFileType: row.original_file_type,
    originalFileSize: row.original_file_size,
    status: row.status as SourceWorkflowStatus,
    storage: {
      bucket: EXPERIENCE_SOURCES_BUCKET,
      path: row.storage_path,
      uploadedAt: row.storage_uploaded_at,
    },
  };
}

function errorMessage(error: SupabaseErrorLike) {
  return error.message || error.code || error.name || "Unknown Supabase error";
}

function isDuplicateStorageObjectError(error: SupabaseErrorLike) {
  const status = String(error.statusCode ?? error.status ?? "");
  const text = [error.code, error.name, error.message].filter(Boolean).join(" ").toLowerCase();
  return status === "409" || text.includes("already exists") || text.includes("duplicate");
}

function getStorageClient(client?: ExperienceSourceStorageClient) {
  return client ?? (getSupabaseAdminClient() as unknown as ExperienceSourceStorageClient);
}

export async function reserveExperienceSource(
  input: ExperienceSourceStorageInput,
  client?: ExperienceSourceStorageClient,
): Promise<ExperienceSourceReservation> {
  const supabase = getStorageClient(client);
  const buffer = toBuffer(input.bytes);
  if (buffer.byteLength === 0) {
    throw new Error("Experience source file must not be empty.");
  }

  const fileName = requireNonEmptyText(input.fileName, "fileName");
  const fileType = input.fileType?.trim() || "application/octet-stream";
  const byteSha256 = hashExperienceSourceBytes(buffer);
  const storagePath = buildExperienceSourceStoragePath(byteSha256, fileName);

  const { data, error } = await supabase.rpc("reserve_experience_source", {
    p_original_byte_sha256: byteSha256,
    p_original_file_name: fileName,
    p_original_file_type: fileType,
    p_original_file_size: buffer.byteLength,
    p_storage_bucket: EXPERIENCE_SOURCES_BUCKET,
    p_storage_path: storagePath,
  });

  if (error) {
    throw new Error(`Failed to reserve experience source: ${errorMessage(error)}`);
  }

  return toReservation(normalizeRpcRow(data));
}

async function reconcileExperienceSourceStorage(
  source: ExperienceSourceReservation,
  client: ExperienceSourceStorageClient,
): Promise<ExperienceSourceReservation> {
  const { data, error } = await client.rpc("reconcile_experience_source_storage", {
    p_source_id: source.id,
    p_original_byte_sha256: source.originalByteSha256,
    p_storage_bucket: source.storage.bucket,
    p_storage_path: source.storage.path,
  });

  if (error) {
    throw new Error(`Failed to reconcile experience source storage: ${errorMessage(error)}`);
  }

  return toReservation(normalizeRpcRow(data));
}

export async function storeExperienceSourceFile(
  input: ExperienceSourceStorageInput,
  client?: ExperienceSourceStorageClient,
): Promise<StoredExperienceSource> {
  const supabase = getStorageClient(client);
  const buffer = toBuffer(input.bytes);
  const reserved = await reserveExperienceSource({ ...input, bytes: buffer }, supabase);
  let uploadState: ExperienceSourceUploadState = "uploaded";

  const { error } = await supabase.storage.from(reserved.storage.bucket).upload(reserved.storage.path, buffer, {
    contentType: reserved.originalFileType,
    upsert: false,
  });

  if (error) {
    if (!isDuplicateStorageObjectError(error)) {
      throw new Error(`Failed to upload private experience source: ${errorMessage(error)}`);
    }
    uploadState = "already-uploaded";
  }

  const reconciled = await reconcileExperienceSourceStorage(reserved, supabase);
  return { ...reconciled, uploadState };
}
