/**
 * Which words of a search to paint in the rows, and where they fall.
 *
 * The copy's index matches word prefixes, case and accents aside, so the
 * paint does the same: a term marks every word it starts. The words are
 * the plain ones and the values of `from:`, `to:`, `cc:`, and `subject:`;
 * a filter — `has:attachment`, `before:`, `in:` — names no text, and a
 * word taken away with `-` is not in the row to paint.
 */

const FILTER_KEYS = new Set([
  "has", "before", "after", "newer_than", "older_than", "in", "label", "is", "filename",
  "larger", "smaller", "size", "category", "list", "deliveredto", "bcc", "rfc822msgid",
]);
const COLUMN_KEYS = new Set(["from", "to", "cc", "subject"]);
const WORD_CHAR = /[\p{L}\p{N}]/u;
const TRIM_EDGES = /^[^\p{L}\p{N}@._-]+|[^\p{L}\p{N}@._-]+$/gu;

/** One character, lower-cased with its accent taken off: "É" → "e". */
function foldChar(c: string): string {
  const folded = Array.from(c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return folded[0] ?? c;
}

function fold(text: string): string {
  return Array.from(text).map(foldChar).join("");
}

/** Words split on spaces, except that a quoted span stays one word. */
function splitSearch(q: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const c of q) {
    if (c === '"') {
      quoted = !quoted;
      cur += c;
      continue;
    }
    if (/\s/.test(c) && !quoted) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** The terms to paint, folded, in the order typed, each once. */
export function searchHighlightTerms(query: string): string[] {
  const out: string[] = [];
  for (const raw of splitSearch(query)) {
    if (raw === "OR" || raw === "AND" || raw.startsWith("-")) continue;
    let value = raw;
    const colon = raw.indexOf(":");
    if (colon > 0 && !raw.startsWith('"')) {
      const key = raw.slice(0, colon).toLowerCase();
      if (FILTER_KEYS.has(key)) continue;
      if (COLUMN_KEYS.has(key)) value = raw.slice(colon + 1);
    }
    const phrase = value.startsWith('"');
    const text = phrase
      ? value.slice(1).replace(/"$/, "").trim()
      : value.replace(TRIM_EDGES, "");
    const term = fold(text);
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

/**
 * Where the terms fall in `text`, as [start, end) over its characters
 * (code points, so an emoji counts once). Only at the start of a word,
 * as the index matches; overlapping finds are merged.
 */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  if (!text || !terms.length) return [];
  const chars = Array.from(text).map(foldChar);
  const found: [number, number][] = [];
  for (const term of terms) {
    const needle = Array.from(term);
    if (!needle.length) continue;
    for (let i = 0; i + needle.length <= chars.length; i++) {
      if (i > 0 && WORD_CHAR.test(chars[i - 1])) continue;
      let hit = true;
      for (let k = 0; k < needle.length; k++) {
        if (chars[i + k] !== needle[k]) {
          hit = false;
          break;
        }
      }
      if (hit) found.push([i, i + needle.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** The name the search words are painted under: `::highlight(dh-search-hit)`. */
export const SEARCH_HIT_HIGHLIGHT = "dh-search-hit";

/**
 * Ranges over the search words in the text under `root`, at word starts as
 * in the rows. Text in scripts and styles is left alone. A word split over
 * two text nodes is not found, which mail almost never does.
 */
export function searchHitRanges(root: Node, terms: string[]): Range[] {
  const doc = root.ownerDocument ?? (root as Document);
  if (!terms.length || !doc?.createTreeWalker) return [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out: Range[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement?.tagName;
    if (parent === "SCRIPT" || parent === "STYLE" || parent === "NOSCRIPT") continue;
    const text = node.nodeValue ?? "";
    const ranges = highlightRanges(text, terms);
    if (!ranges.length) continue;
    // Code points to UTF-16 offsets: an emoji before a hit counts twice.
    const offsets: number[] = [0];
    for (const c of Array.from(text)) offsets.push(offsets[offsets.length - 1] + c.length);
    for (const [start, end] of ranges) {
      const range = doc.createRange();
      range.setStart(node, offsets[start]);
      range.setEnd(node, offsets[end]);
      out.push(range);
    }
  }
  return out;
}

type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };

/**
 * Paint the search words under `root` with the CSS Custom Highlight API: no
 * change to the message's own markup, so React and the sender's HTML stay
 * as they are. Answers the function that takes the paint away. A browser
 * without the API shows no paint, and nothing else changes.
 */
export function paintSearchHits(root: Node, terms: string[]): () => void {
  const view = (root.ownerDocument ?? (root as Document)).defaultView as
    | (Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...r: Range[]) => unknown })
    | null;
  const registry = view?.CSS?.highlights;
  const HighlightCtor = view?.Highlight;
  if (!registry || !HighlightCtor) return () => {};
  const ranges = searchHitRanges(root, terms);
  if (!ranges.length) return () => {};
  registry.set(SEARCH_HIT_HIGHLIGHT, new HighlightCtor(...ranges));
  return () => registry.delete(SEARCH_HIT_HIGHLIGHT);
}
