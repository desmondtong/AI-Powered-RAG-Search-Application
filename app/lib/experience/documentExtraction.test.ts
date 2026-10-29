import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildDocumentContext,
  extractTextFromGenericDocument,
  normalizeExtractedText,
  splitTextIntoChunks,
} from "../documentExtraction";

const DOCX_FIXTURE_BASE64 =
  "UEsDBAoAAAAIAJ0uXV3XeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMECgAAAAAAnS5dXQAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgAnS5dXSAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMECgAAAAAAnS5dXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACACdLl1dYdlbBcgAAAAuAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sbU+xTgMxDN37FVb2Xg6GCp3u0gFExw6AxBoS04u42JETuPbvSYrYujy9J9vP7437c1zgByUHpknddb0CJMc+0GlSb6/P2wcFuVjydmHCSV0wq73ZjOvg2X1HpALVgfKwTmouJQ1aZzdjtLnjhFRnnyzRlirlpFcWn4Qd5lwfxEXf9/1ORxtImQ1Adf1gf2n0KpKpIA2KOSChBAdPx8d3wHMR60rNDNXyK3ejbjsN5YrppscLOiYPM9rWD5ZAePuykb8kjf03Nb9QSwECFAAKAAAACACdLl1d13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAAJ0uXV0AAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAACIBAABfcmVscy9QSwECFAAKAAAACACdLl1dIBuG6rIAAAAuAQAACwAAAAAAAAAAAAAAAABGAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAACdLl1dAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAAAhAgAAd29yZC9QSwECFAAKAAAACACdLl1dYdlbBcgAAAAuAQAAEQAAAAAAAAAAAAAAAABEAgAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAUABQAgAQAAOwMAAAAA";

const PDF_FIXTURE_GZIP_BASE64 = `
H4sICKvf4moCA2lucHV0LnBkZgDte3k41N37f1TKSPZ9m2TfZjVm7HtkX7JkyWAwjBlmRohKlsoSokL2B6HIrlApe4gsFcqa
lH1LQuo3Q8/z9NTz+X0/1++P3/W7fldv13vOOfe5z33fr/vc5/3H61xETbV1ZSFyCgDRxtzGB43VjZkAKBAMJDh7ApSVQYYY
vDvZAwijSMxBulgcGUME6eLQZIw2xoXgilFVBZDIRAzaGxCQFhFr4EWrwRy+uCrNS1wF26l0eaFtfYQ0D2uGX0gTXaDbz3GJ
ZnW1LxR48Ah8mPGE0asDz8gWL6SSGh9sSfV7n/ETZYYbilgreYfme9ge674mvlaTVcH77vZmW1/w03wHyb6vz4BGannY20bf
VJmHqvkE43JX7s0kEB2PATSmym9V5ns+a8qCKzhxy+TJ8ivTCnsWufKRP+gIaM83872TcpJ9DU0erJwuaMmt/sa6PKo9guU7
dfmz8dvFQFym8ly4RlrSG9ltWhE/wzAABu/6HRSlR80DAPY9IVAw9C8Z8pckof5Dkr7PQ4BICArxY8aGUYHBFidqR2sMboh5
V4sZ3ewNasxjqKzMy1ZP0QR5szHs17e7Ta9zU5OhWbyy93YI0nJfM20EDV3rBZY3us0Rdo+zJTR1zq+SLVsyO0gjeyN87Y9l
LVToEUb88ebqAqNb77fX8MSujS7/rntphDpxWeY9ehfxTkfgdY9KA9bKh/P3tGUy8zncr6zJCei9RrfHjXVijoGwwMo1e8OR
4fHZ0Pv5nH4yjpurU6OD8RpSIV+fT/BZybUv6W/tMT9FC75eVYW49+HKLAg47zipkM3IcvE96FHc6qG0OE+7oSrhpxibaBLP
+/0KlSAc5zMeLeRi1mreM2nF+8/e7GnIL4vsuJlU7VZ7/BSNk/tExrDAfLrDjJT69piww6LNyNByr3VqdZZcPe2YNY1KanRM
uKfHPgGwU4Rm8qX+YzZ8GUlOfYJrnMlhey8IqV7uUUGQQRnrVdG23+ybzy/nqIQHMb58fKVU8HBDUun+JZmlPeeMHwcjL1o5
MBgjD8TFd6MRH5ktQmd4AwBdV2Wgmfyt3cywC7ZdEp3AuvCz4S73oXgm/2Suz8ZfH4VbxbwfYVs8+9ksMW+Oj/kQb3SSlLWK
Zqs/4WzuF+eXzx9+4dr81lRIY8Jz3mZBvpwjoLKxJFCtnIdFaNDNpmmAUTnnfcyhRhj/emNiXKrVKXro5dLQLZttVNWeCiRg
8nNKfbaA2CqNJ1avp2CC7LbPj9xVyl/SxxejL0YiRjV7ViiZp6uVT39bPMZEwrr66oZnhqTTJ6uLFek9PjS0sLmvsyEgOT6k
RvrTUvxhHnqbA3BrtwZWmz3Fpfw3sxnGT9vQVVQ+EsiJnFBis2GJyt7Tgpa+gL3scPlOR5bO66MNNrhvUUkBkXYCd2Uupo7R
2Tt8rZ8r1ux0ppQvx4LnkypOb3eYJoPvsQNF2idr7zCWCU8Kn6685cIyYxP+/MT9OwKvCOpnWKRYHGMt50cTbfboD7V/6yzm
zq4N53zB66eq2Xf13BH2pZKVkgZv7ofGlz231wXx0NwG2T1lJDKnEpdXVONM1UzVt6Rxlm4H5L7uJ6oDDKAjlapllTTnDjM1
Pl6vFrqUNO47sO8YmgvXYrNR+P7gim2xhlLWdH5e4rGei9JjR64FHVgJ4pxKFGzQZJf1U/qYM8f8qvVhVld4dxtNwAXucauE
1jltgdMNkl9N3rxWc77PKBhxvvEr+FOdROgGazXEAs2zCuYLqVsON6OTln8QUl5y8ZLeUatm/LP8ENPX6wGYCtiY3H2O7NS7
9uOvHOf2Wsx59X/GF5UoXd3ULZryi3y391DxeKotjckqu3LxOOJw34ygi1JyTgyN9GfQEoxBTfa5Jv6SylLB0K2Fiw4i6rSl
J7YRnySLJvZ2yoBb5Zbqaz9ztHQaxmwBg1f6Xhp+WJeykXNreeT6KIy9a7/+TOqHqqZGRKifh4huX9TAe0/L4lYVzq5mtU6h
sVOP9fC9w11VGlLrUZy+hNteSzH5YLkMjbonlThzpvDOUDrzJO6SIyTw8f29ITkhb3FLOSf42gz5pzfZkzXbfWQatxN9v/B0
Tdtotgh94HQ6ScPDZIWLeQnwaWZ6kcs9mjk8wIbznUPmSmsW7Q8KlY2V1ZaJBToLNV9c5JnTYYQmhO7dx7v5dGCvxYf488zO
mq1wvkJNukojHbrrbVm0rVFND/jfW7xrZgRrP6J/BzhFR4oAhbqEd4eJNtxgCJKbq39czYTncY1lSngYps2N48UJuY6nBcfq
b8pws6l+Bdp9/hAm2XBJyBVwg6ntcv0DIXaZRbaN7SyDz6uDWT5f5oS6M1Ad7e7bbKHuYfhxCf2IwqZYokB5IOC1j1t7HeOi
EWp4T99cUwRvz1TT2/nWjLGyNOaGliwWH2McUYWPbUQ0n6+pL7tvOP96X9o7eODwNNdNR4/z6GcMc8tskxum1c99Yy63RsUy
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
MAgEBRAV1THRBfwvnWjjoZs1AAA=
`;

interface InsertedDocumentRow {
  content: string;
  metadata: Record<string, unknown>;
  embedding: string;
}

interface UploadCall {
  bucket: string;
  path: string;
  body: Buffer;
  options: { contentType: string; upsert: false };
}

interface EmbeddingCall {
  input: string;
  taskType: string;
}

function fileFromBytes(bytes: Buffer | string, name: string, type: string) {
  if (typeof bytes === "string") {
    return new File([bytes], name, { type });
  }

  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new File([arrayBuffer], name, { type });
}

function docxFixtureFile() {
  return fileFromBytes(
    Buffer.from(DOCX_FIXTURE_BASE64, "base64"),
    "generic.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}

function pdfFixtureFile() {
  const bytes = gunzipSync(Buffer.from(PDF_FIXTURE_GZIP_BASE64.replace(/\s/g, ""), "base64"));
  return fileFromBytes(bytes, "generic.pdf", "application/pdf");
}

function mockCompiledModule(resolvedPath: string, exports: Record<string, unknown>) {
  const mockModule = new Module(resolvedPath);
  mockModule.filename = resolvedPath;
  mockModule.loaded = true;
  mockModule.exports = exports;
  require.cache[resolvedPath] = mockModule;
}

describe("generic document extraction utilities", () => {
  it("extracts TXT bytes and builds the same generic document context", async () => {
    const text = "Generic TXT title\r\nSecond line\t \n\n\nBody";
    const extracted = await extractTextFromGenericDocument(fileFromBytes(text, "generic.txt", "text/plain"));

    assert.equal(extracted, text);
    assert.equal(normalizeExtractedText(extracted), "Generic TXT title\nSecond line\n\nBody");
    assert.deepEqual(buildDocumentContext("generic.txt", extracted), {
      title: "Generic TXT title",
      subtitle: "Second line",
      text: "File: generic.txt\nTitle: Generic TXT title\nHeader: Second line",
    });
  });

  it("extracts DOCX raw text with Mammoth", async () => {
    const extracted = await extractTextFromGenericDocument(docxFixtureFile());

    assert.match(extracted, /Generic DOCX extraction works\./);
    assert.match(extracted, /Second heading line\./);
  });

  it("extracts selectable PDF text through the existing PDF strategy", async () => {
    const extracted = normalizeExtractedText(await extractTextFromGenericDocument(pdfFixtureFile()));

    assert.match(extracted, /Generic PDF extraction works\./);
    assert.match(extracted, /Second PDF line\./);
  });

  it("rejects the same unsupported generic upload formats", async () => {
    await assert.rejects(
      () => extractTextFromGenericDocument(fileFromBytes("{}", "generic.json", "application/json")),
      /Unsupported file type\. Please upload PDF, DOCX, or TXT files\./,
    );
  });

  it("keeps generic chunking deterministic with overlap", () => {
    const text = `${"a".repeat(780)}. ${"b".repeat(120)}.`;
    const chunks = splitTextIntoChunks(text);

    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].endsWith("."));
    assert.ok(chunks[1].startsWith("a"));
    assert.equal(chunks[1].includes("b".repeat(120)), true);
  });
});

describe("generic upload route regression", () => {
  it("preserves the public success response and inserted metadata contract", async () => {
    const routePath = require.resolve("../../api/upload/route");
    const geminiPath = require.resolve("../gemini");
    const supabaseServerPath = require.resolve("../supabaseServer");
    const previousRoute = require.cache[routePath];
    const previousGemini = require.cache[geminiPath];
    const previousSupabaseServer = require.cache[supabaseServerPath];
    const uploads: UploadCall[] = [];
    const inserts: InsertedDocumentRow[] = [];
    const embeddingCalls: EmbeddingCall[] = [];

    const mockSupabase = {
      storage: {
        from(bucket: string) {
          return {
            async upload(path: string, body: Buffer, options: { contentType: string; upsert: false }) {
              uploads.push({ bucket, path, body, options });
              return { data: { path }, error: null };
            },
            getPublicUrl(path: string) {
              return { data: { publicUrl: `https://storage.example.test/${path}` } };
            },
          };
        },
      },
      from(table: string) {
        assert.equal(table, "documents");
        return {
          async insert(row: InsertedDocumentRow) {
            inserts.push(row);
            return { data: null, error: null };
          },
        };
      },
    };

    delete require.cache[routePath];
    mockCompiledModule(geminiPath, {
      async createEmbedding(input: string, taskType: string) {
        embeddingCalls.push({ input, taskType });
        return Array.from({ length: 1536 }, (_, index) => index / 1536);
      },
    });
    mockCompiledModule(supabaseServerPath, {
      getSupabaseAdminClient() {
        return mockSupabase;
      },
    });

    try {
      const { POST } = require(routePath) as { POST: (req: Request) => Promise<Response> };
      const fileText = "Generic upload title\nHeader line\nBody line";
      const formData = new FormData();
      formData.set("file", fileFromBytes(fileText, "generic.txt", "text/plain"));
      const response = await POST({ formData: async () => formData } as Request);
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(body).sort(), ["chunks", "documentId", "fileName", "fileUrl", "success", "textLength"]);
      assert.equal(body.success, true);
      assert.equal(body.fileName, "generic.txt");
      assert.equal(body.chunks, 1);
      assert.equal(body.textLength, fileText.length);
      assert.match(String(body.documentId), /^[0-9a-f-]{36}$/);
      assert.equal(body.fileUrl, `https://storage.example.test/${body.documentId}.txt`);

      assert.equal(uploads.length, 1);
      assert.equal(uploads[0].bucket, "documents");
      assert.equal(uploads[0].path, `${body.documentId}.txt`);
      assert.equal(uploads[0].body.toString("utf-8"), fileText);
      assert.deepEqual(uploads[0].options, { contentType: "text/plain", upsert: false });

      assert.equal(embeddingCalls.length, 1);
      assert.equal(embeddingCalls[0].taskType, "RETRIEVAL_DOCUMENT");
      assert.match(embeddingCalls[0].input, /File: generic\.txt\nTitle: Generic upload title\nHeader: Header line/);
      assert.match(embeddingCalls[0].input, /Body line/);

      assert.equal(inserts.length, 1);
      assert.equal(inserts[0].content, fileText);
      assert.equal(JSON.parse(inserts[0].embedding).length, 1536);
      assert.deepEqual(inserts[0].metadata, {
        source: "generic.txt",
        document_id: body.documentId,
        file_name: "generic.txt",
        file_type: "text/plain",
        file_size: fileText.length,
        document_title: "Generic upload title",
        document_header: "Header line",
        document_context: "File: generic.txt\nTitle: Generic upload title\nHeader: Header line",
        upload_date: inserts[0].metadata.upload_date,
        chunk_index: 0,
        total_chunks: 1,
        file_path: `${body.documentId}.txt`,
        file_url: body.fileUrl,
      });
      assert.doesNotThrow(() => new Date(String(inserts[0].metadata.upload_date)).toISOString());
    } finally {
      if (previousRoute) {
        require.cache[routePath] = previousRoute;
      } else {
        delete require.cache[routePath];
      }
      if (previousGemini) {
        require.cache[geminiPath] = previousGemini;
      } else {
        delete require.cache[geminiPath];
      }
      if (previousSupabaseServer) {
        require.cache[supabaseServerPath] = previousSupabaseServer;
      } else {
        delete require.cache[supabaseServerPath];
      }
    }
  });
});
