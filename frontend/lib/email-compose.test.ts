import { describe, expect, it } from "vitest";
import {
  emailTypoWarnings,
  isEmailAddress,
  prepareOutboundEmail,
  sanitizeEmailHtml,
  wrapComposerSelection,
} from "./email-compose";

describe("email compose", () => {
  it("accepts normal addresses and warns on common domain typos", () => {
    expect(isEmailAddress("ada@example.com")).toBe(true);
    expect(isEmailAddress("Ada <ada@example.com>")).toBe(false);
    expect(isEmailAddress("ada@example.com\nBcc: eve@evil.test")).toBe(false);
    expect(emailTypoWarnings(["a@gmial.com", "b@outloo.com"])).toEqual([
      "a@gmial.com looks like a typo. Did you mean @gmail.com?",
      "b@outloo.com looks like a typo. Did you mean @outlook.com?",
    ]);
    expect(emailTypoWarnings(["ada@gmail.com"])).toEqual([]);
  });

  it("turns bold, italic, and links into safe HTML", () => {
    const prepared = prepareOutboundEmail(
      'Hello **team** and *notes*.\nSee [the doc](https://example.com/a?x=1&y=2).',
    );
    expect(prepared.contentType).toBe("text/html");
    expect(prepared.text).toContain("Hello team and notes.");
    expect(prepared.html).toContain("<strong>team</strong>");
    expect(prepared.html).toContain("<em>notes</em>");
    expect(prepared.html).toContain(
      '<a href="https://example.com/a?x=1&amp;y=2">the doc</a>',
    );
    expect(prepared.html).toContain("<br>");
    expect(prepared.html).not.toContain("<script");
    expect(prepared.html && sanitizeEmailHtml(prepared.html)).toBe(prepared.html);
  });

  it("keeps plain messages as text and strips scripts from HTML", () => {
    expect(prepareOutboundEmail("See you then.")).toEqual({
      text: "See you then.",
      contentType: "text/plain",
    });
    const hostile = sanitizeEmailHtml(
      '<script>alert(1)</script><strong onclick="x">ok</strong><a href="javascript:alert(1)">bad</a>',
    );
    expect(hostile).toContain("<strong>ok</strong>");
    expect(hostile).toContain("bad");
    expect(hostile.toLowerCase()).not.toContain("<script");
    expect(hostile).not.toContain("javascript:");
    expect(hostile).not.toContain("onclick");
  });

  it("wraps the composer selection", () => {
    expect(wrapComposerSelection("Hello", 0, 5, "bold").value).toBe("**Hello**");
    expect(wrapComposerSelection("Hello", 0, 5, "italic").value).toBe("*Hello*");
    const link = wrapComposerSelection("Docs", 0, 4, "link");
    expect(link.value).toBe("[Docs](https://)");
    expect(link.value.slice(link.start, link.end)).toBe("https://");
  });
});
