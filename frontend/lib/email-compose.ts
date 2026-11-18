const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const domainTypos: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "outloo.com": "outlook.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "icoud.com": "icloud.com",
  "icloud.co": "icloud.com",
};

function markupPattern() {
  return /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
}

export function isEmailAddress(value: string) {
  return (
    value.length <= 320 &&
    !/[\r\n\u0000]/.test(value) &&
    emailPattern.test(value)
  );
}

export function emailTypoWarnings(addresses: readonly string[]) {
  const warnings: string[] = [];
  for (const address of addresses) {
    const domain = address.split("@")[1]?.toLowerCase();
    if (!domain) {
      continue;
    }
    const suggestion = domainTypos[domain];
    if (suggestion) {
      warnings.push(
        `${address} looks like a typo. Did you mean @${suggestion}?`,
      );
    }
  }
  return warnings;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function decodeAttr(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function sanitizeEmailHtml(input: string) {
  const withoutBlocks = input
    .replace(/\u0000/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    );
  return withoutBlocks.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tag, attrs) => {
    const name = String(tag).toLowerCase();
    if (name === "br") {
      return "<br>";
    }
    if (name === "strong" || name === "em" || name === "b" || name === "i") {
      const normalized = name === "b" ? "strong" : name === "i" ? "em" : name;
      return full.startsWith("</") ? `</${normalized}>` : `<${normalized}>`;
    }
    if (name === "a") {
      if (full.startsWith("</")) {
        return "</a>";
      }
      const hrefMatch =
        /\bhref\s*=\s*"([^"]*)"/i.exec(String(attrs)) ??
        /\bhref\s*=\s*'([^']*)'/i.exec(String(attrs));
      const href = decodeAttr(hrefMatch?.[1] ?? "");
      if (!isSafeHttpUrl(href)) {
        return "";
      }
      return `<a href="${escapeAttr(href)}">`;
    }
    return "";
  });
}

function renderMarkupToken(token: string) {
  if (token.startsWith("**") && token.endsWith("**")) {
    return `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
  }
  if (token.startsWith("*") && token.endsWith("*")) {
    return `<em>${escapeHtml(token.slice(1, -1))}</em>`;
  }
  const link = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
  if (link && isSafeHttpUrl(link[2]) && !/["'<>]/.test(link[2])) {
    return `<a href="${link[2]}">${escapeHtml(link[1])}</a>`;
  }
  return escapeHtml(token);
}

export function markupToEmailHtml(source: string) {
  const value = source.replace(/\u0000/g, "").replace(/\r\n/g, "\n");
  let html = "";
  let last = 0;
  for (const match of value.matchAll(markupPattern())) {
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(last, index)).replace(/\n/g, "<br>");
    html += renderMarkupToken(match[0]);
    last = index + match[0].length;
  }
  html += escapeHtml(value.slice(last)).replace(/\n/g, "<br>");
  return sanitizeEmailHtml(html);
}

export function markupToPlainText(source: string) {
  return source
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .trim();
}

export function emailHasMarkup(source: string) {
  return /\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(
    source,
  );
}

export function prepareOutboundEmail(source: string): {
  text: string;
  html?: string;
  contentType: "text/plain" | "text/html";
} {
  const text = markupToPlainText(source);
  if (!emailHasMarkup(source)) {
    return { text, contentType: "text/plain" };
  }
  const html = markupToEmailHtml(source);
  if (!html.trim()) {
    return { text, contentType: "text/plain" };
  }
  return { text, html, contentType: "text/html" };
}

export function wrapComposerSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: "bold" | "italic" | "link",
) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  let insertion = selected;
  let nextStart = start;
  let nextEnd = end;
  if (kind === "bold") {
    const label = selected || "bold";
    insertion = `**${label}**`;
    nextStart = start + 2;
    nextEnd = nextStart + label.length;
  } else if (kind === "italic") {
    const label = selected || "italic";
    insertion = `*${label}*`;
    nextStart = start + 1;
    nextEnd = nextStart + label.length;
  } else {
    const label = selected || "link";
    insertion = `[${label}](https://)`;
    nextStart = start + label.length + 3;
    nextEnd = nextStart + "https://".length;
  }
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    start: nextStart,
    end: nextEnd,
  };
}
