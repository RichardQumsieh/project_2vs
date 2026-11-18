const defaultMax = 100_000;

function decodeNumericEntity(value: string) {
  const code = Number(value);
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
    return "";
  }
  return String.fromCodePoint(code);
}

/** Visible text from an HTML mail or event body. Tags and scripts are dropped. */
export function htmlToPlainText(html: string, max = defaultMax) {
  const stripped = html
    .replace(/\u0000/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(/<\s*(script|style)[^>]*>[\s\S]*$/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|h[1-6]|li|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => decodeNumericEntity(digits))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clampPlainText(stripped, max);
}

export function clampPlainText(value: string, max = defaultMax) {
  const cleaned = value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (cleaned.length > max) {
    return { text: cleaned.slice(0, max), truncated: true };
  }
  return { text: cleaned, truncated: false };
}
