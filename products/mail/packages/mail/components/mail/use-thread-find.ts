/**
 * Find inside the open thread — what Cmd+F means everywhere else.
 *
 * Two things make this harder than a text scan.
 *
 * A thread is not one document. Plain-text messages render in this page, and
 * HTML messages render inside a sandboxed iframe with their own document. Both
 * hold text a reader can see, so both must be searched. The frames have an
 * opaque origin (no `allow-same-origin`), so this page cannot read them. It
 * sends the words to each frame instead, and the frame's own script finds and
 * paints the matches (`lib/mail/frame-script/paint.ts`). The frame sends back
 * where each match is, so all matches can go in reading order.
 *
 * Nothing may be written into an email's DOM. Wrapping matches in tags would
 * re-flow a layout the sender wrote. The CSS custom highlight API paints
 * ranges without touching the tree, so that is what this uses, here and in
 * the frames.
 */

import * as React from "react";

import { scrollParentOf } from "@/components/mail/email-frame";
import {
  MAIL_FRAME_ATTR,
  askFrame,
  frameNumber,
  postToFrame,
  type FrameMessage,
} from "@/lib/mail/frame-messages";

const ALL = "mail-find";
const ACTIVE = "mail-find-active";

/** More matches than this in one frame are not counted. */
const MAX_FRAME_HITS = 5000;

/**
 * Painted into this page when it gets a highlight.
 *
 * Not in mail.css: Turbopack's CSS parser does not know `::highlight()` and
 * drops the rule with a warning at every launch, so the page's matches had
 * no colour. A style element put in by hand is read by the browser alone.
 * The frames carry the same colours in their own script.
 */
const HIGHLIGHT_CSS = `
::highlight(${ALL}) { background-color: #fde68a; color: #1c1917; }
::highlight(${ACTIVE}) { background-color: #f59e0b; color: #1c1917; }
`;

/**
 * One match. In this page it is a range. In a frame it is the frame and the
 * match's number there. `top` is where it is in the page, for the order.
 */
type Hit =
  | { kind: "page"; range: Range; top: number }
  | { kind: "frame"; frame: HTMLIFrameElement; index: number; top: number };

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

/** The message frames in the thread. */
function mailFrames(root: HTMLElement): HTMLIFrameElement[] {
  return Array.from(root.querySelectorAll<HTMLIFrameElement>(`iframe[${MAIL_FRAME_ATTR}]`));
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
function findInRoot(node: Node, doc: Document, needle: string): Range[] {
  const nodes = textNodes(node, doc);
  if (!nodes.length) return [];

  let joined = "";
  const starts: number[] = [];
  for (const text of nodes) {
    starts.push(joined.length);
    joined += text.nodeValue ?? "";
  }

  const hay = joined.toLowerCase();
  const hits: Range[] = [];
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
      hits.push(range);
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

/** The matches a frame found, placed in the page. */
function frameHits(frame: HTMLIFrameElement, answer: FrameMessage | null): Hit[] {
  if (!answer || !Array.isArray(answer.tops)) return [];
  const box = frame.getBoundingClientRect();
  const height = frameNumber(answer.height);
  const scale = height > 0 ? box.height / height : 1;
  return answer.tops.slice(0, MAX_FRAME_HITS).map((top, index) => ({
    kind: "frame" as const,
    frame,
    index,
    top: box.top + frameNumber(top) * scale,
  }));
}

/**
 * Scroll the thread so that a point in a frame is in the middle.
 *
 * `top` and `bottom` are in the frame's pixels, and `height` is the frame's
 * own viewport height, so the ratio to the frame's box is the scale.
 */
function revealInFrame(frame: HTMLIFrameElement, answer: FrameMessage | null): void {
  const scroller = scrollParentOf(frame);
  const height = answer ? frameNumber(answer.height) : 0;
  if (!scroller || !answer || height <= 0) {
    frame.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  const box = frame.getBoundingClientRect();
  const scale = box.height / height;
  const middle = (frameNumber(answer.top) + frameNumber(answer.bottom)) / 2;
  const view = scroller.getBoundingClientRect();
  scroller.scrollTop += box.top + middle * scale - (view.top + view.height / 2);
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
  /** The page document and the frames that hold paint, to clear later. */
  const paintedRef = React.useRef<{ doc: Document | null; frames: HTMLIFrameElement[] }>({
    doc: null,
    frames: [],
  });

  const clearPaint = React.useCallback(() => {
    const painted = paintedRef.current;
    if (painted.doc) {
      highlightsOf(painted.doc)?.delete(ALL);
      highlightsOf(painted.doc)?.delete(ACTIVE);
    }
    for (const frame of painted.frames) postToFrame(frame, { type: "find-clear" });
    paintedRef.current = { doc: null, frames: [] };
  }, []);

  const needle = query.trim().toLowerCase();

  // Collect the matches and paint them all.
  React.useEffect(() => {
    const root = rootRef.current;
    clearPaint();
    if (!open || !root || needle.length < 1) {
      setHits([]);
      setIndex(0);
      return;
    }
    let cancelled = false;

    const doc = root.ownerDocument;
    const pageRanges = findInRoot(root, doc, needle);
    const highlights = highlightsOf(doc);
    const highlight = pageRanges.length ? makeHighlight(doc, pageRanges) : null;
    if (highlights && highlight) {
      ensureHighlightCss(doc);
      highlights.set(ALL, highlight);
    }
    const frames = mailFrames(root);
    paintedRef.current = { doc, frames };

    void Promise.all(
      frames.map((frame) => askFrame(frame, { type: "find", needle }, "find-result"))
    ).then((answers) => {
      if (cancelled) return;
      const found: Hit[] = pageRanges.map((range) => ({
        kind: "page" as const,
        range,
        top: range.getBoundingClientRect().top,
      }));
      answers.forEach((answer, i) => found.push(...frameHits(frames[i], answer)));
      // Reading order: the matches in the page and in the frames, top down.
      found.sort((a, b) => a.top - b.top);
      setHits(found);
      setIndex(found.length ? 1 : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [open, needle, contentKey, rootRef, clearPaint]);

  // Paint the current one on top, and scroll to it.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !hits.length || index < 1) return;
    const hit = hits[index - 1];
    if (!hit) return;
    const painted = paintedRef.current;
    if (painted.doc) highlightsOf(painted.doc)?.delete(ACTIVE);
    for (const frame of painted.frames) {
      if (hit.kind !== "frame" || frame !== hit.frame) {
        postToFrame(frame, { type: "find-show", index: -1 });
      }
    }
    if (hit.kind === "page") {
      const highlights = highlightsOf(root.ownerDocument);
      const highlight = makeHighlight(root.ownerDocument, [hit.range]);
      if (highlights && highlight) highlights.set(ACTIVE, highlight);
      const target =
        hit.range.startContainer.parentElement ??
        (hit.range.startContainer as Element | null);
      target?.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
    void askFrame(hit.frame, { type: "find-show", index: hit.index }, "find-shown").then(
      (answer) => revealInFrame(hit.frame, answer)
    );
  }, [hits, index, rootRef]);

  // Drop the paint when the bar closes or the thread goes away.
  React.useEffect(() => clearPaint, [clearPaint]);

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
