import { NextResponse } from "next/server";
import { buildDocumentContext, extractTextFromGenericDocument, splitTextIntoChunks } from "../../lib/documentExtraction";
import { getErrorMessage } from "../../lib/errors";
import { createEmbedding } from "../../lib/gemini";
import { getSupabaseAdminClient } from "../../lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const file = (await req.formData()).get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const documentId = crypto.randomUUID();
    const uploadDate = new Date().toISOString();
    const filePath = `${documentId}.${file.name.split(".").pop() || "bin"}`;

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: storageError } = await supabase.storage.from("documents").upload(filePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (storageError) {
      const msg = storageError.message || "Unknown storage error";
      if (msg.includes("row-level security") || msg.includes("RLS")) {
        return NextResponse.json(
          {
            success: false,
            error: `Storage RLS error: ${msg}. Ensure SUPABASE_SERVICE_ROLE_KEY is set.`,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: `Failed to store file: ${msg}`,
        },
        { status: 500 },
      );
    }

    // Get public URL for the file
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(filePath);

    // Extract text from file
    const text = await extractTextFromGenericDocument(file);
    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Could not extract text from file",
        },
        { status: 400 },
      );
    }

    const documentContext = buildDocumentContext(file.name, text);
    const chunks = splitTextIntoChunks(text);

    // Process each chunk: generate embedding and store in database
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Generate a 1536-dimensional Gemini embedding to match the pgvector schema.
      const embeddingInput = `${documentContext.text}\n\n${chunk}`;
      const embedding = await createEmbedding(embeddingInput, "RETRIEVAL_DOCUMENT");

      // Store chunk with embedding in database
      const { error } = await supabase.from("documents").insert({
        content: chunk,
        metadata: {
          source: file.name,
          document_id: documentId,
          file_name: file.name,
          file_type: file.type || file.name.split(".").pop(),
          file_size: file.size,
          document_title: documentContext.title,
          document_header: documentContext.subtitle,
          document_context: documentContext.text,
          upload_date: uploadDate,
          chunk_index: i,
          total_chunks: chunks.length,
          file_path: filePath,
          file_url: urlData.publicUrl,
        },
        embedding: JSON.stringify(embedding),
      });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      documentId,
      fileName: file.name,
      chunks: chunks.length,
      textLength: text.length,
      fileUrl: urlData.publicUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, "Failed to process file"),
      },
      { status: 500 },
    );
  }
}
