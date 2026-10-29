import {
  assertTrustedReadBoundary,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { getExperienceSourceFile } from "../../../../lib/experience/apiService";

function safeHeaderFileName(fileName: string) {
  return fileName.replace(/[^\x20-\x7E]|[\r\n"\\]/g, "_") || "experience-source";
}

function contentDisposition(fileName: string) {
  const safeName = safeHeaderFileName(fileName);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(req: Request, context: { params: { id?: string } | Promise<{ id?: string }> }) {
  try {
    assertTrustedReadBoundary(req);
    const sourceId = await getRouteSourceId(context);
    const file = await getExperienceSourceFile(sourceId);
    const body = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": file.file_type,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": contentDisposition(file.file_name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
