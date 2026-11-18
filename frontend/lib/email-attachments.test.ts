import { describe, expect, it } from "vitest";
import {
  readEmailAttachmentFile,
  validateOutboundAttachments,
} from "./email-attachments";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes() {
  const binary = atob(pngBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

describe("email attachments", () => {
  it("accepts a real image and rejects scripts, mismatches, and oversize metadata", async () => {
    const file = new File([pngBytes()], "pixel.png", { type: "image/png" });
    const read = await readEmailAttachmentFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.attachment.filename).toBe("pixel.png");
    expect(read.attachment.contentType).toBe("image/png");
    const checked = validateOutboundAttachments([read.attachment]);
    expect(checked.ok).toBe(true);

    const svg = await readEmailAttachmentFile(
      new File(["<svg><script>alert(1)</script></svg>"], "icon.svg", {
        type: "image/svg+xml",
      }),
    );
    expect(svg.ok).toBe(false);

    const htmlNamedPdf = await readEmailAttachmentFile(
      new File(["<script>alert(1)</script>"], "notes.pdf", { type: "text/html" }),
    );
    expect(htmlNamedPdf.ok).toBe(false);

    const scriptPdf = validateOutboundAttachments([
      {
        filename: "notes.pdf",
        contentType: "application/pdf",
        size: "%PDF-1.4\n<script>alert(1)</script>".length,
        contentBase64: btoa("%PDF-1.4\n<script>alert(1)</script>"),
      },
    ]);
    expect(scriptPdf.ok).toBe(false);

    expect(
      validateOutboundAttachments([
        { ...read.attachment, size: read.attachment.size + 1 },
      ]).ok,
    ).toBe(false);
    expect(
      validateOutboundAttachments([
        {
          ...read.attachment,
          filename: "pixel.png.js",
        },
      ]).ok,
    ).toBe(false);
  });
});
