import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBraveSources } from "../src/research-provider.js";

describe("Brave result validation", () => {
  it("limits results and snippets and accepts only safe HTTPS links", () => {
    const sources = extractBraveSources({
      web: {
        results: [
          {
            title: "  Result 1  ",
            url: "https://example.org/article",
            description: "  Useful   source excerpt ",
          },
          {
            title: "Unsafe scheme",
            url: "javascript:alert(1)",
            description: "Ignored",
          },
          {
            title: "Credentials",
            url: "https://user:pass@example.org",
            description: "Ignored",
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            title: `Result ${index + 2}`,
            url: `https://example.org/${index}`,
            description: "x".repeat(1_500),
          })),
        ],
      },
    });

    assert.equal(sources?.length, 4);
    assert.deepEqual(sources?.[0], {
      title: "Result 1",
      url: "https://example.org/article",
      excerpt: "Useful source excerpt",
    });
    assert.equal(sources?.[1]?.excerpt.length, 1_200);
  });

  it("ignores malformed provider entries and rejects an unsupported response shape", () => {
    assert.deepEqual(
      extractBraveSources({
        web: {
          results: [
            null,
            { title: "missing fields" },
            {
              title: "Valid",
              url: "https://example.org/",
              description: "Excerpt",
            },
          ],
        },
      }),
      [{ title: "Valid", url: "https://example.org/", excerpt: "Excerpt" }],
    );
    assert.equal(extractBraveSources({ results: [] }), null);
    assert.equal(extractBraveSources({ web: { results: [] } })?.length, 0);
  });
});
