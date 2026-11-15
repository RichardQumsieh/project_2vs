import { afterEach, describe, expect, it, vi } from "vitest";
import { getAutomaticResearchQuery, searchWeb } from "./research";

describe("automatic web research", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("recognizes standalone factual or explicitly research-oriented questions", () => {
    expect(getAutomaticResearchQuery("What is photosynthesis?")).toBe(
      "What is photosynthesis?",
    );
    expect(getAutomaticResearchQuery("Search the web for current Mars missions")).toBe(
      "current Mars missions",
    );
    expect(getAutomaticResearchQuery("ابحث عن أبحاث النوم")).toBe("أبحاث النوم");
  });

  it("does not search conversational advice, private identifiers, or oversized prompts", () => {
    expect(getAutomaticResearchQuery("What should I reply to my friend?")).toBeNull();
    expect(getAutomaticResearchQuery("ماذا أفعل الآن؟")).toBeNull();
    expect(getAutomaticResearchQuery("Is my partner being honest?")).toBeNull();
    expect(getAutomaticResearchQuery("Find evidence for r@example.com")).toBeNull();
    expect(getAutomaticResearchQuery("What is " + "x".repeat(400))).toBeNull();
  });

  it("sends only the standalone query to the authenticated research endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sources: [
            {
              title: "Sleep",
              url: "https://www.example.org/sleep",
              excerpt: "  Sleep is a biological state.  ",
            },
            {
              title: "Bad URL",
              url: "javascript:alert(1)",
              excerpt: "Should not be accepted",
            },
            {
              title: "Credentials",
              url: "https://user:pass@example.org",
              excerpt: "Should not be accepted",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sources = await searchWeb("What is sleep?");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(requestUrl).pathname).toBe("/research/search");
    expect(requestInit.credentials).toBe("include");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      query: "What is sleep?",
    });
    expect(sources).toEqual([
      {
        title: "Sleep",
        url: "https://www.example.org/sleep",
        excerpt: "Sleep is a biological state.",
      },
    ]);
  });

  it("rejects malformed, failed, and cancelled requests explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 503 })));
    await expect(searchWeb("sleep")).rejects.toThrow("status 503");

    const controller = new AbortController();
    controller.abort();
    await expect(searchWeb("sleep", { signal: controller.signal })).rejects.toThrow(
      "Research cancelled",
    );
  });
});
