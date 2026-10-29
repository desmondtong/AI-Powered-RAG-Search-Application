import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import mammoth from "mammoth";
import { convertLegacyDocToDocx, DocConversionError, type DocConversionErrorCode } from "./docConversion";

const LEGACY_DOC_GZIP_BASE64 = `
H4sICDDi4moCA2lucHV0LmRvYwDtme9PW1UYx59zW0rLJpRS2WQod6wCMii/xoQxFQpjrBu0Gwi6Hy5Ay8YGLULJMPGF0Zj4
QhOML/SFiTHBVxqD+gfoG31nNDF7sXfzpYlZpvHNko36Pc89hZsCcluIYVsf8uHee3rveZ7znOec+5xzf/2l+Pbn35T9TmnS
QTZaSbrIYSoToCh14SbSVNlKMplMFSdz8lDJA3WUfWhH/+UB2ef5wAlcoADsAXvBE6BQ9blbHXPy8Mo5iuMvQTqdoBiOs/QG
ZSKliBhzfVaeWbF4n1XJ6c9ef2r+znT8FxmvACoGHlACvOBJjgmifWA/eAqUgQOgHDwNngEVSu9BHCvVuQ/HZ0EVqAY14DlQ
Cw6DOlAP/KABNIIm0AxawBHQCo6C50EbaAfH+H1GdBy8AF4EL4FO0AUCoBv0gBOgF5wEfeAUCILT4AzoBwMgBMLgLDgHBsEQ
eBkMgxHwCngVnAcXVBsv7bI5U8AaW4ERQw6XxjHxgxEavbL/+ifHZ+Nz8YmEPhKfjdT3xK/PT0djCY6J/kFZ1hMf50iQ535c
8O/+Nvqn/dvXt45FYaQRWYsHEVeAWi6sZSbS3+6/khr73YHeimNWm6ZRmlJx3OSjWp/o8skoCtRSKGijs6A7uJ+m+1z2ORAO
2inWZ3cmwGvBPBrFb5f72u3/aUsvrVQI0kQvj58+ikJnhCYxr17hkVNEJUt3ybu0QA6fwOgIBR1Q7IDicpIKDUXliOOAW9Zz
hMdfAPZHMCvriK8oLWCOliPPTZ6IVwjUiHG39D7KdGpwC+EROs7tiNVJmuN7NYxRWXc+4r0S9VaKTrZvHNbN4I5J1B9j+zyo
bYHt2wv7POyQo04hH5Xtv+QUVdzCZlHFM8UpPBdhm+RVCT9laBrm+wJimGeIMPwfpYnVfkjgL4onzS0qwOxhtIXYM054xgkL
vPCME3U6YYKXvezn9vEkxFErp6nzTmPmkucXnbSatfrVUXObCsLGzMZT28nSRWElzIbgpmkYOwejB3C8gaN8dcrmSOe1oh4r
cTyIjpymMTwpg7Glypr2LjhuUgXwJDSJ4q2fkQEwBktn2eFGJ+vQH+W6Jiy06bQDmsiaphjNoyN1k9YEl0ZRJqfSDot1DXAy
EmdLpRVz0mfwknBn3+JUPWYvdviyt+dy63bs6edjnF85cXhN2iTvSfWBfB3ZSTg/wOz7I0LqqthgylQv6Dq+0nhAvLOorStN
RWS1jXQ+sVNOtvOyadz5OtNmDZ07aevoytiStzbLBVPBsj7Ibr/72d/3QlfdX37opMPV392SOt9U+aFQ+ZVL5VEFKj/ao/Ie
mStGVL44o5r5xwMj99OU/Z0mfVbON5I/vxCiX3fBZ3c935tdo94EhdQ9Gp8ajbVt4DCXvZQaCteu/Vvm2UX8lhHq3GE6T5f3
+P8dNXjvWJhr5D3eTAJHM7xcqI6rOze4/kTbfmCWZVnHb+iLMdOzVZqxKsjJoyllafH3f4lGt3LOz0lOHms5g6T5ChLscV4h
91AIabWuVpWzXL6Wet/gFeh1JPF+5CVyKTTOv0RMT06pZYufM5ec7HpRq/+cPJYiZP8fU7n+ffMv93POeZTF5iW5gavV0/FG
6gwTBcIaVSy/7deXf+o6uByzV4JDizG7D7Tg95pmKmy0vv7l7ZObP9/81H/A/dHHWP/W3ftafh/ISyu7SMZ3DqFwm9a6m5Xv
JtnJ73+ynenfEDbsO7kdsS81gLt5y3EG798xupb5lgy8amyAqd1gi3JtdQIJ4Z0fzdp/BdAu9doy0C/tTa30m2gIWcpY1jYU
Kv2ZfP+TtrbmG+d5yIPm4X+56Sv7Xu7pm3fqU18HNpMa6E99M7SqXwdfqfMR1hVB/hVHNjbPG9Ix/iJgcfWZRfsPgdS+T946
zZn5oy0L/XLOSOzgGN7O999/Ad+vMboAJAAA
`;

const DOC_BYTES = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("doc")]);

interface ZipFixtureEntry {
  name: string;
  compressedSize?: number;
  uncompressedSize: number;
}

function legacyDocFixtureBytes() {
  return gunzipSync(Buffer.from(LEGACY_DOC_GZIP_BASE64.replace(/\s/g, ""), "base64"));
}

function writeUInt32LE(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function writeUInt16LE(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function buildDocxLikeZip(entries: ZipFixtureEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const compressedSize = entry.compressedSize ?? entry.uncompressedSize;
    const localHeader = Buffer.concat([
      writeUInt32LE(0x04034b50),
      writeUInt16LE(20),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(0),
      writeUInt32LE(compressedSize),
      writeUInt32LE(entry.uncompressedSize),
      writeUInt16LE(name.byteLength),
      writeUInt16LE(0),
      name,
      Buffer.alloc(compressedSize),
    ]);
    localParts.push(localHeader);
    centralParts.push(
      Buffer.concat([
        writeUInt32LE(0x02014b50),
        writeUInt16LE(20),
        writeUInt16LE(20),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt32LE(0),
        writeUInt32LE(compressedSize),
        writeUInt32LE(entry.uncompressedSize),
        writeUInt16LE(name.byteLength),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt32LE(0),
        writeUInt32LE(localOffset),
        name,
      ]),
    );
    localOffset += localHeader.byteLength;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    writeUInt32LE(0x06054b50),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(entries.length),
    writeUInt16LE(entries.length),
    writeUInt32LE(centralDirectory.byteLength),
    writeUInt32LE(localData.byteLength),
    writeUInt16LE(0),
  ]);

  return Buffer.concat([localData, centralDirectory, eocd]);
}

function fakeDocxBytes() {
  return buildDocxLikeZip([
    { name: "[Content_Types].xml", uncompressedSize: 12 },
    { name: "word/document.xml", uncompressedSize: 16 },
  ]);
}

async function withTempDir<T>(callback: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "doc-conversion-test-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeExecutableScript(dir: string, name: string, source: string) {
  const path = join(dir, name);
  await writeFile(path, source);
  await chmod(path, 0o755);
  return path;
}

function assertDocConversionError(error: unknown, code: DocConversionErrorCode) {
  assert.equal(error instanceof DocConversionError, true);
  assert.equal((error as DocConversionError).code, code);
}

describe("legacy DOC conversion", () => {
  it("converts a real legacy DOC fixture through LibreOffice into DOCX text", async () => {
    const converted = await convertLegacyDocToDocx({
      bytes: legacyDocFixtureBytes(),
      sourceFileName: "legacy fixture.doc",
    });
    const extracted = await mammoth.extractRawText({ buffer: converted.bytes });

    assert.equal(converted.fileName, "source.docx");
    assert.equal(converted.fileType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(extracted.value, /Legacy DOC extraction works\./);
    assert.match(extracted.value, /Second DOC line\./);
  });

  it("uses fixed temporary paths and argument arrays instead of user-controlled filenames", async () => {
    await withTempDir(async (dir) => {
      const argsPath = join(dir, "args.json");
      const fakeDocxPath = join(dir, "fake.docx");
      await writeFile(fakeDocxPath, fakeDocxBytes());
      const converterPath = await writeExecutableScript(
        dir,
        "fake-soffice.js",
        `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args));
const outputDir = args[args.indexOf("--outdir") + 1];
fs.copyFileSync(${JSON.stringify(fakeDocxPath)}, path.join(outputDir, "source.docx"));
`,
      );
      let tempRoot = "";
      const converted = await convertLegacyDocToDocx({
        bytes: DOC_BYTES,
        sourceFileName: "unsafe name; touch should-not-run.doc",
        converterPath,
        onTemporaryDirectoryCreated: (path) => {
          tempRoot = path;
        },
      });
      const args = JSON.parse(await readFile(argsPath, "utf-8")) as string[];

      assert.equal(converted.bytes.byteLength, fakeDocxBytes().byteLength);
      assert.equal(args.includes("unsafe name; touch should-not-run.doc"), false);
      assert.equal(args.at(-1)?.endsWith("/source.doc"), true);
      assert.equal(args.includes("--headless"), true);
      assert.equal(args.some((arg) => arg.startsWith("-env:UserInstallation=file://")), true);
      assert.equal(tempRoot ? existsSync(tempRoot) : true, false);
    });
  });

  it("reports absent converters and removes temporary files", async () => {
    let tempRoot = "";
    await assert.rejects(
      () =>
        convertLegacyDocToDocx({
          bytes: DOC_BYTES,
          sourceFileName: "legacy.doc",
          converterPath: "/private/tmp/missing-soffice-for-test",
          onTemporaryDirectoryCreated: (path) => {
            tempRoot = path;
          },
        }),
      (error) => {
        assertDocConversionError(error, "converter-unavailable");
        return true;
      },
    );
    assert.equal(tempRoot ? existsSync(tempRoot) : true, false);
  });

  it("reports conversion failures and timeouts with cleanup", async () => {
    await withTempDir(async (dir) => {
      const failingConverter = await writeExecutableScript(
        dir,
        "failing-soffice.js",
        `#!/usr/bin/env node
process.stderr.write("conversion exploded");
process.exit(7);
`,
      );
      let failureTempRoot = "";
      await assert.rejects(
        () =>
          convertLegacyDocToDocx({
            bytes: DOC_BYTES,
            sourceFileName: "legacy.doc",
            converterPath: failingConverter,
            onTemporaryDirectoryCreated: (path) => {
              failureTempRoot = path;
            },
          }),
        (error) => {
          assertDocConversionError(error, "conversion-failed");
          return true;
        },
      );
      assert.equal(failureTempRoot ? existsSync(failureTempRoot) : true, false);

      const hangingConverter = await writeExecutableScript(
        dir,
        "hanging-soffice.js",
        `#!/usr/bin/env node
setTimeout(() => {}, 10000);
`,
      );
      let timeoutTempRoot = "";
      await assert.rejects(
        () =>
          convertLegacyDocToDocx({
            bytes: DOC_BYTES,
            sourceFileName: "legacy.doc",
            converterPath: hangingConverter,
            timeoutMs: 20,
            onTemporaryDirectoryCreated: (path) => {
              timeoutTempRoot = path;
            },
          }),
        (error) => {
          assertDocConversionError(error, "conversion-timeout");
          return true;
        },
      );
      assert.equal(timeoutTempRoot ? existsSync(timeoutTempRoot) : true, false);
    });
  });
});
