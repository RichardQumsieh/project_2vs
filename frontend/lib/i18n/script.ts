export function scriptCounts(text: string) {
  const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return { arabic, latin };
}

export function dominantScript(text: string): "arabic" | "latin" | "mixed" | "other" {
  const { arabic, latin } = scriptCounts(text);
  if (arabic > 0 && latin > 0) return "mixed";
  if (arabic > latin) return "arabic";
  if (latin > arabic) return "latin";
  return "other";
}