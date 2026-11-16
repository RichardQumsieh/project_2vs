import { describe, expect, it } from "vitest";
import {
  decryptFileAttachment,
  inspectAndEncryptFileAttachment,
  sanitizeAttachmentName,
} from "./file-attachment";
import { asBufferSource } from "./bytes";

const textEncoder = new TextEncoder();

function createStoredZip(entries: Array<{ name: string; contents: string }>) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const contents = textEncoder.encode(entry.contents);
    const local = new Uint8Array(30 + name.length + contents.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(26, name.length, true);
    localView.setUint32(18, contents.length, true);
    localView.setUint32(22, contents.length, true);
    local.set(name, 30);
    local.set(contents, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, contents.length, true);
    centralView.setUint32(24, contents.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  const parts = [...locals, ...centrals, end];
  const zip = new Uint8Array(
    parts.reduce((size, part) => size + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    zip.set(part, offset);
    offset += part.byteLength;
  }
  return new Blob([asBufferSource(zip)], { type: "application/zip" });
}

describe("file attachment safety and encryption", () => {
  it("normalizes names and blocks unsupported or path-like filenames", () => {
    expect(sanitizeAttachmentName("C:\\fakepath\\lecture notes.pdf")).toBe("lecture notes.pdf");
    expect(() => sanitizeAttachmentName(".hidden.pdf")).toThrow("safe name");
    expect(() => sanitizeAttachmentName("report.pdf.exe")).toThrow("Allowed files");
    expect(() => sanitizeAttachmentName("index.html")).toThrow("Allowed files");
  });

  it("validates PDF signatures instead of trusting the extension", async () => {
    await expect(
      inspectAndEncryptFileAttachment(new File(["MZ fake executable"], "report.pdf")),
    ).rejects.toThrow("do not match a valid PDF");
  });

  it("checks Office ZIP structure, detects external links, and encrypts bytes", async () => {
    const archive = createStoredZip([
      {
        name: "[Content_Types].xml",
        contents: '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      { name: "word/document.xml", contents: "<document/>" },
      {
        name: "word/_rels/document.xml.rels",
        contents: '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
      },
    ]);
    const original = new Uint8Array(await archive.arrayBuffer());
    const prepared = await inspectAndEncryptFileAttachment(
      new File([original], "report.docx"),
    );
    expect(prepared.containsExternalLinks).toBe(true);
    expect(prepared.mime).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(prepared.ciphertext).not.toEqual(original);
    if (!(prepared.ciphertext.buffer instanceof ArrayBuffer)) {
      throw new Error("Expected an ArrayBuffer-backed encrypted payload.");
    }
    const decrypted = await decryptFileAttachment(
      prepared.ciphertext.buffer,
      prepared.key,
      prepared.nonce,
    );
    expect(new Uint8Array(await decrypted.arrayBuffer())).toEqual(original);
  });

  it("rejects macro-enabled and malformed Office containers", async () => {
    const activeArchive = createStoredZip([
      { name: "[Content_Types].xml", contents: "<Types/>" },
      { name: "word/document.xml", contents: "<document/>" },
      { name: "word/vbaProject.bin", contents: "macro" },
    ]);
    await expect(
      inspectAndEncryptFileAttachment(
        new File([await activeArchive.arrayBuffer()], "report.docx"),
      ),
    ).rejects.toThrow("Macro-enabled");
    await expect(
      inspectAndEncryptFileAttachment(new File(["not a zip"], "report.docx")),
    ).rejects.toThrow("invalid or unsupported ZIP");
  });
});
