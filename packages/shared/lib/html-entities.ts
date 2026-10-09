/** Decode HTML entities in text-only contexts (Gmail snippets, stripped HTML). */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return (
    text
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Last, so "&amp;#39;" does not double-decode.
      .replace(/&amp;/g, "&")
  );
}
