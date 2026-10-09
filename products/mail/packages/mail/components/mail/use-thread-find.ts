"use client";

/**
 * Find inside the open thread — what Cmd+F means everywhere else.
 *
 * Two things make this harder than a text scan.
 *
 * A thread is not one document. Plain-text messages render in this page, and
 * HTML messages render inside a sandboxed iframe with their own document. Both
 * hold text a reader can see, so both must be searched. The frames carry
 * `allow-same-origin`, so their content is reachable from here.
 *
 * Nothing may be written into an email's DOM. Wrapping matches in tags would
 * re-flow a layout the sender wrote, and the frames run a hash-pinned link
 * bridge that a mutation could disturb. The CSS custom highlight API paints
 * ranges without touching the tree, so that is what this uses. The frames'
 * CSP allows `style-src 'unsafe-inline'`, which is what lets the highlight
 * colours be put into each frame.
 */

import * as React from "react";

const ALL = "mail-find";
const ACTIVE = "mail-find-active";

/**
 * Painted into every document that gets a highlight, the page included.
 *
 * Not in mail.css: Turbopack's CSS parser does not know `::highlight()` and
 * drops the rule with a warning at every launch, so the page's matches had
 * no colour. A style element put in by hand is read by the browser alone.
 */
const HIGHLIGHT_CSS = `
::highlight(${ALL}) { background-color: #fde68a; color: #1c1917; }
::highlight(${ACTIVE}) { background-color: #f59e0b; color: #1c1917; }
`;

type Hit = { range: Range; doc: Document };

type HighlightWindow = Window & {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS?: { highlights?: Map<string, unknown> };
};

function highlightsOf(doc: Document): Map<string, unknown> | null {
  const view = doc.defaultView as HighlightWindow | null;
  return view?.CSS?.highlights ?? null;
}

function makeHighlight(doc: Document, ranges: Range[]): unknown | null {
  const view = doc.defaultView as HighlightWindow | null;
  if (!view?.Highlight) return null;
  return new view.Highlight(...ranges);
}

/** Documents holding thread text: this page, plus every reachable email frame. */
function searchRoots(root: HTMLElement): { node: Node; doc: Document }[] {
  const out: { node: Node; doc: Document }[] = [{ node: root, doc: root.ownerDocument }];
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    let doc: Document | null = null;
    try {
      // Cross-origin or not yet loaded — skip rather than throw.
      doc = frame.contentDocument;
    } catch {
      doc = null;
    }
    if (doc?.body) out.push({ node: doc.body, doc });
  }
  return out;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

/** Visible text nodes under a root, in reading order. */
function textNodes(node: Node, doc: Document): Text[] {
  const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      const text = candidate.nodeValue;
      if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
      const parent = candidate.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      // A collapsed quote or a hidden pane holds text no one is looking at.
      if (!parent.offsetParent && parent.tagName !== "BODY") {
        const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
        if (style && (style.display === "none" || style.visibility === "hidden")) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    out.push(current as Text);
    current = walker.nextNode();
  }
  return out;
}

/**
 * Every match under one root, as ranges.
 *
 * The nodes are joined into one string first, so a match still counts when it
 * runs across an element boundary — `<b>Kas</b>per` is one hit, not none.
 */
function findInRoot(node: Node, doc: Document, needle: string): Hit[] {
  const nodes = textNodes(node, doc);
  if (!nodes.length) return [];

  let joined = "";
  const starts: number[] = [];
  for (const text of nodes) {
    starts.push(joined.length);
    joined += text.nodeValue ?? "";
  }

  const hay = joined.toLowerCase();
  const hits: Hit[] = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    // Which node holds an offset, and where inside it.
    const locate = (offset: number): { node: Text; offset: number } => {
      let low = 0;
      let high = nodes.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (starts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return { node: nodes[low], offset: offset - starts[low] };
    };
    try {
      const from = locate(at);
      const to = locate(end - 1);
      const range = doc.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      hits.push({ range, doc });
    } catch {
      /* a node changed under us — drop this hit */
    }
    at = hay.indexOf(needle, at + Math.max(needle.length, 1));
  }
  return hits;
}

/** Put the highlight colours into a document, once. */
function ensureHighlightCss(doc: Document): void {
  if (doc.querySelector("style[data-dh-find]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-dh-find", "1");
  style.textContent = HIGHLIGHT_CSS;
  doc.head?.appendChild(style);
}

function clearHighlights(docs: Document[]): void {
  for (const doc of docs) {
    const highlights = highlightsOf(doc);
    highlights?.delete(ALL);
    highlights?.delete(ACTIVE);
  }
}

/** Bring a match into view, in its own document and then in this one. */
function revealHit(hit: Hit, root: HTMLElement): void {
  const target =
    hit.range.startContainer.parentElement ??
    (hit.range.startContainer as Element | null);
  target?.scrollIntoView({ block: "center", inline: "nearest" });
  if (hit.doc === root.ownerDocument) return;
  // Inside a frame: the page still has to scroll to the frame itself.
  const frame = Array.from(root.querySelectorAll("iframe")).find((f) => {
    try {
      return f.contentDocument === hit.doc;
    } catch {
      return false;
    }
  });
  frame?.scrollIntoView({ block: "center", inline: "nearest" });
}

export function useThreadFind({
  rootRef,
  contentKey,
  enabled = true,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  /** Re-runs the search when the thread or its rendered messages change. */
  contentKey: string;
  /** False when no thread is open, so Cmd+F is left alone. */
  enabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [index, setIndex] = React.useState(0);
  const touchedDocsRef = React.useRef<Document[]>([]);

  const needle = query.trim().toLowerCase();

  // Collect the matches and paint them all.
  React.useEffect(() => {
    const root = rootRef.current;
    clearHighlights(touchedDocsRef.current);
    touchedDocsRef.current = [];
    if (!open || !root || needle.length < 1) {
      setHits([]);
      setIndex(0);
      return;
    }

    const roots = searchRoots(root);
    const found: Hit[] = [];
    for (const entry of roots) {
      found.push(...findInRoot(entry.node, entry.doc, needle));
    }

    const byDoc = new Map<Document, Range[]>();
    for (const hit of found) {
      const list = byDoc.get(hit.doc) ?? [];
      list.push(hit.range);
      byDoc.set(hit.doc, list);
    }
    for (const [doc, ranges] of byDoc) {
      const highlights = highlightsOf(doc);
      const highlight = makeHighlight(doc, ranges);
      if (!highlights || !highlight) continue; // no custom highlight support
      ensureHighlightCss(doc);
      highlights.set(ALL, highlight);
      touchedDocsRef.current.push(doc);
    }

    setHits(found);
    setIndex(found.length ? 1 : 0);
  }, [open, needle, contentKey, rootRef]);

  // Paint the current one on top, and scroll to it.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !hits.length || index < 1) return;
    const hit = hits[index - 1];
    if (!hit) return;
    for (const doc of touchedDocsRef.current) highlightsOf(doc)?.delete(ACTIVE);
    const highlights = highlightsOf(hit.doc);
    const highlight = makeHighlight(hit.doc, [hit.range]);
    if (highlights && highlight) highlights.set(ACTIVE, highlight);
    revealHit(hit, root);
  }, [hits, index, rootRef]);

  // Drop the paint when the bar closes or the thread goes away.
  React.useEffect(() => {
    return () => clearHighlights(touchedDocsRef.current);
  }, []);

  const step = React.useCallback(
    (by: number) => {
      setIndex((prev) => {
        if (!hits.length) return 0;
        const next = prev + by;
        if (next < 1) return hits.length;
        if (next > hits.length) return 1;
        return next;
      });
    },
    [hits.length]
  );

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // Cmd/Ctrl+F. Bound here rather than with the list shortcuts, because the
  // bar and its state live with the thread. Shift is left free: the page uses
  // Cmd+Shift+F to reach the mail search box.
  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "f") return;
      // The desktop shell has no find bar of its own, so nothing is displaced.
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  // A thread that closes takes its find bar with it.
  React.useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  return {
    open,
    openFind: () => setOpen(true),
    close,
    query,
    setQuery,
    count: hits.length,
    index,
    next: () => step(1),
    prev: () => step(-1),
  };
}
