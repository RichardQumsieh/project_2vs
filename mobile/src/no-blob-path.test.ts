import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  return readdirSync(path).flatMap((entry) => sourceFiles(join(path, entry)));
}

const forbidden = [
  /new\s+Blob\s*\(/,
  /createObjectURL\s*\(/,
  /decryptPhotoBytes\s*\(/,
  /decryptVideoBytes\s*\(/,
  /decryptVoiceNoteBytes\s*\(/,
  /decryptFileAttachment\s*\(/,
  /blobToBytes\s*\(/,
  /body\s*:\s*ciphertext\.buffer/,
  /body\s*:\s*ciphertext\b/,
];

describe("mobile binary media path", () => {
  it("does not construct a Blob from binary data or pass an ArrayBuffer to fetch", () => {
    const files = sourceFiles(join(__dirname)).concat(sourceFiles(join(__dirname, "..", "App.tsx")))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) hits.push(`${file} matches ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
