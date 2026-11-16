import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  assertOutgoingLinksSafe,
  extractLinks,
  isPublicReputationUrl,
  youtubeEmbedUrl,
} from "./url-safety";

describe("message URL safety", () => {
  it("detects explicit, naked, and defanged URLs without linking deceptive credentials", () => {
    const links = extractLinks(
      "Visit https://example.com/path, example.org/docs and hxxps://bad[.]example.net/login.",
    );
    expect(links.map((link) => link.url)).toEqual([
      "https://example.com/path",
      "https://example.org/docs",
      "https://bad.example.net/login",
    ]);
    expect(extractLinks("https://trusted.example@evil.com/").at(0)?.issue)
      .toContain("credentials");
    expect(extractLinks("Send report.pdf and visit customdomain.unknownsuffix/").map((link) => link.issue))
      .toEqual([expect.stringContaining("unrecognized domain ending")]);
    expect(extractLinks("evil.com.exe")[0]?.issue).toContain("unrecognized domain ending");
  });

  it("does not send private, local, or IP-based URLs to reputation services", () => {
    expect(isPublicReputationUrl("https://example.com/")).toBe(true);
    expect(isPublicReputationUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isPublicReputationUrl("http://printer.local/")).toBe(false);
    expect(isPublicReputationUrl("http://intranet/")).toBe(false);
  });

  it("creates embeds only for valid HTTPS YouTube video links", () => {
    const embed = "https://www.youtube-nocookie.com/embed/abcdefghijk";
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe(embed);
    expect(youtubeEmbedUrl("https://youtu.be/abcdefghijk?t=30")).toBe(embed);
    expect(youtubeEmbedUrl("https://m.youtube.com/shorts/abcdefghijk")).toBe(embed);
    expect(youtubeEmbedUrl("https://youtube.com.evil.example/watch?v=abcdefghijk"))
      .toBeNull();
    expect(youtubeEmbedUrl("http://www.youtube.com/watch?v=abcdefghijk")).toBeNull();
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("blocks outgoing links until reputation checks report clean", async () => {
    const check = vi.spyOn(api, "checkUrlSafety").mockResolvedValue({
      results: [{
        url: "https://safe-for-send.example.org/",
        status: "clean",
        threatTypes: [],
      }],
    });
    await expect(assertOutgoingLinksSafe(
      "See https://safe-for-send.example.org/",
    )).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledOnce();

    check.mockResolvedValue({
      results: [{
        url: "https://bad-for-send.example.org/",
        status: "threat",
        threatTypes: ["MALWARE"],
      }],
    });
    await expect(assertOutgoingLinksSafe(
      "See https://bad-for-send.example.org/",
    )).rejects.toThrow("Sending blocked");
    check.mockRestore();
  });
});
