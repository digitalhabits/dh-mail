"use client";

import { placeBubbleBar } from "@/lib/bubble-bar-place";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Vendored without sourceMappingURL (package CSS 404s the .map under Next).
import "@/styles/quill.snow.css";
import "@/styles/quill.bubble.css";
import { readClipboardText } from "@/lib/native-shell";
import {
  copyImageToClipboard,
  ImageContextMenu,
  ImageCropDialog,
} from "./ImageActions";

/** The slice of Quill's API the editor handle needs. */
type QuillEditor = {
  getSelection: (focus?: boolean) => { index: number; length: number } | null;
  deleteText: (index: number, length: number, source?: string) => void;
  insertText: (index: number, text: string, source?: string) => void;
  insertEmbed: (
    index: number,
    type: string,
    value: unknown,
    source?: string
  ) => void;
  setSelection: (index: number, length?: number, source?: string) => void;
  getLength: () => number;
  getLeaf: (index: number) => [{ parent?: unknown } | null, number];
  getIndex: (blot: { parent?: unknown }) => number;
  focus: () => void;
  format: (name: string, value: unknown, source?: string) => void;
  formatText: (
    index: number,
    length: number,
    formats: Record<string, unknown>,
    source?: string
  ) => void;
  getFormat: () => Record<string, unknown>;
  /** The element the words are written in. */
  root: HTMLElement;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  /** Re-read the document and the selection from the DOM. */
  update: (source?: string) => void;
  /** Bubble theme only: the floating B/I/U bar. */
  theme?: {
    tooltip?: {
      root: HTMLElement;
      position: (reference: unknown) => unknown;
    };
  };
};

/**
 * How much CSS `zoom` on an ancestor has scaled this element.
 *
 * `getBoundingClientRect` answers in screen pixels. `offsetWidth` answers
 * in the element's own pixels, before the zoom. Quill writes `left`/`top`
 * in the second space and reads the first, so a card at 118% puts the
 * formatting bubble in the empty space under the words — or under the
 * Send row, where it cannot be seen. The image overlay already divides
 * the same way.
 */
function cssZoomScale(el: HTMLElement): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return {
    x: el.offsetWidth ? box.width / el.offsetWidth : 1,
    y: el.offsetHeight ? box.height / el.offsetHeight : 1,
  };
}

type QuillRange = { index: number; length: number };

/**
 * Quill 2 maps both Enter and Shift+Enter to a new block. Register a BR embed
 * so Shift+Enter can insert a soft linebreak inside the current paragraph.
 */
let softBreakRegistered = false;

function registerSoftBreak(Quill: {
  import: (name: string) => unknown;
  // Quill's register has several overloads; keep this loose for the dynamic import.
  register: (...args: never[]) => void;
  imports?: Record<string, unknown>;
}) {
  if (softBreakRegistered || Quill.imports?.["formats/softbreak"]) {
    softBreakRegistered = true;
    return;
  }

  const Parchment = Quill.import("parchment") as {
    EmbedBlot: {
      // Prototype shape varies across Quill typings — only need a constructable base.
      new (...args: unknown[]): object;
      blotName?: string;
      tagName?: string;
      className?: string;
      value?: (node: HTMLElement) => unknown;
    };
  };

  class SoftBreakBlot extends Parchment.EmbedBlot {
    static blotName = "softbreak";
    static tagName = "BR";
    static className = "ql-softbreak";

    length() {
      return 1;
    }

    value() {
      return true;
    }

    static value() {
      return true;
    }
  }

  Quill.register(SoftBreakBlot as never);
  softBreakRegistered = true;
}

let inlineStylesRegistered = false;

/**
 * Font and size written as inline styles, not as class names.
 *
 * Quill ships `font` and `size` as classes — `ql-font-serif`, `ql-size-large`
 * — which say nothing without Quill's own stylesheet. A sent message carries
 * no stylesheet, so the receiving mail app would show the class and none of
 * the styling. These write the CSS property itself, which travels.
 *
 * Neither takes a whitelist. Browsers rewrite `font-family` and `font-size`
 * when they parse them, so a listed value can come back in a form that is no
 * longer on the list — and a reopened draft would quietly lose its styling.
 */
function registerInlineStyles(Quill: {
  import: (name: string) => unknown;
  register: (...args: never[]) => void;
}) {
  if (inlineStylesRegistered) return;

  const Parchment = Quill.import("parchment") as {
    Scope: { INLINE: unknown };
    StyleAttributor: new (
      attrName: string,
      keyName: string,
      options: { scope: unknown }
    ) => unknown;
  };

  const inline = { scope: Parchment.Scope.INLINE };
  Quill.register(
    new Parchment.StyleAttributor("font", "font-family", inline) as never,
    true as never
  );
  Quill.register(
    new Parchment.StyleAttributor("size", "font-size", inline) as never,
    true as never
  );
  inlineStylesRegistered = true;
}

/** Insert a soft linebreak; double-BR at block end so the caret can sit after it. */
function shiftEnterSoftBreak(
  this: { quill: QuillEditor },
  range: QuillRange
) {
  const quill = this.quill;
  if (range.length) {
    quill.deleteText(range.index, range.length, "user");
  }
  const [currentLeaf] = quill.getLeaf(range.index);
  const [nextLeaf] = quill.getLeaf(range.index + 1);
  quill.insertEmbed(range.index, "softbreak", true, "user");
  // Browsers ignore a trailing <br> at the end of a block — insert a second
  // so the break is visible and the caret has somewhere to land.
  if (
    nextLeaf == null ||
    (currentLeaf != null &&
      nextLeaf != null &&
      currentLeaf.parent !== nextLeaf.parent)
  ) {
    quill.insertEmbed(range.index, "softbreak", true, "user");
  }
  quill.setSelection(range.index + 1, 0, "silent");
  return false;
}

/** `this` inside a Quill toolbar handler. */
type ToolbarHandlerContext = {
  quill: QuillEditor & {
    getText: (index: number, length: number) => string;
    format: (name: string, value: unknown, source?: string) => void;
    /** Where a range is drawn, in the container's own pixels. */
    getBounds: (index: number, length?: number) => unknown;
    theme?: {
      tooltip?: {
        edit: (mode: string, preview?: string) => void;
        position?: (reference: unknown) => unknown;
        root?: HTMLElement;
        textbox?: HTMLInputElement;
      };
    };
  };
};

/**
 * Already says how to reach it.
 *
 * `://` is required rather than a bare colon, because a scheme may contain
 * dots and `example.com:8443/path` is therefore a legal-looking one — it is
 * a host and a port, and treating it as a scheme left it without https.
 * `mailto:` and `tel:` are named, being the two that carry no authority.
 */
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

/**
 * `example.org`, `digitalhabits.org/demo`, `sub.example.co.uk/a?b=c`.
 *
 * Deliberately not the app's own link finder: that one only matches
 * addresses that already carry http:// or https://, because its job is to
 * find links inside a sentence, where a bare domain is too easy to imagine.
 * Here the writer has selected the text and asked for a link, so the guess
 * is invited — and it is only a guess: it fills the box, and they still
 * have to press Apply.
 */
const BARE_ADDRESS =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?::\d+)?(?:[/?#]\S*)?$/i;

/**
 * The address a selection is already offering, if it is offering one.
 *
 * Text like `digitalhabits.org/demo` is the address — retyping it with a
 * scheme on the front is work the writer has already done. The whole
 * selection has to be the link and nothing else, so a sentence that mentions
 * a domain still opens an empty box.
 */
function urlFromSelection(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return "";
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  // An address is a person, not a site. Quill would link it as a relative
  // path, which goes nowhere.
  if (trimmed.includes("@")) return "";
  return BARE_ADDRESS.test(trimmed) ? `https://${trimmed}` : "";
}

/**
 * Replaces Quill's default link handler, which prefills the URL box with the
 * selected text as-is. Ours opens the box on the address that text means when
 * it means one, and empty otherwise, with the selection shown as a label
 * (rendered via CSS from `data-selection`).
 */
function linkToolbarHandler(this: ToolbarHandlerContext, value: boolean) {
  const quill = this.quill;
  if (!value) {
    quill.format("link", false, "user");
    return;
  }
  const range = quill.getSelection();
  if (!range || !range.length) return;
  const tooltip = quill.theme?.tooltip;
  if (!tooltip) return;

  /*
    The box is pinned to the words.

    `edit` only shows it; it would stand wherever it last stood, which is
    where the last link was made — or the top of the editor, in a box that
    has made none. So it is placed from the selection's bounds after it is
    shown (shown first, or it is centred on a width of nothing), the way
    the link preview places itself, and the correction that keeps it in
    the window runs off this write as it runs off Quill's own.

    The words are tinted before the box takes the focus, because the
    browser's own highlight goes with the focus and the reader would be
    left typing an address for words they can no longer see. And the box
    goes above the words when the window has no room below them — Quill
    flips against the editor's own bottom, and a compose panel is taller
    than the window it scrolls in.
  */
  paintLinkHighlight(quill);
  const text = quill.getText(range.index, range.length).trim();
  tooltip.edit("link", urlFromSelection(text));
  if (tooltip.textbox) tooltip.textbox.placeholder = "https://…";

  const bounds = quill.getBounds(range.index, range.length) as
    | LinkBounds
    | null;
  const root = tooltip.root;
  if (bounds && root && tooltip.position) {
    // Quill's own placement, for the left and the clamping to the sides.
    // Its top is not kept: Quill flips the box against the editor's own
    // bottom, and a one-line message has an editor a few lines tall — so
    // the box went above the words, or over them once the flip class was
    // taken off. Below the words unless the window has no room there.
    tooltip.position(bounds);
    const scrolled = quill.root.scrollTop;
    root.classList.remove("ql-flip");
    root.style.top = `${bounds.bottom + scrolled}px`;
    const rect = root.getBoundingClientRect();
    if (rect.bottom + 10 > window.innerHeight - 8) {
      root.style.top = `${bounds.top + scrolled - root.offsetHeight}px`;
      root.classList.add("ql-flip");
    }
    // Where the words are, in the box's own pixels, for the caret — read
    // back by the correction that writes the box's left (see rescale).
    root.dataset.anchorX = String(bounds.left + bounds.width / 2);
  }
}

/** What Quill's `getBounds` answers, as far as the link box needs it. */
type LinkBounds = {
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

/**
 * Tint the selected words, so they stay visible while the link box holds
 * the focus. One patch per line the selection crosses, laid in the
 * editor's container over the text — thin enough to read through.
 */
function paintLinkHighlight(quill: { root: HTMLElement }): void {
  const container = quill.root.parentElement;
  if (!container) return;
  clearLinkHighlight(container);
  const sel = quill.root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const { x: scaleX, y: scaleY } = cssZoomScale(container);
  const box = container.getBoundingClientRect();
  for (const rect of Array.from(sel.getRangeAt(0).getClientRects())) {
    if (rect.width === 0 || rect.height === 0) continue;
    const mark = document.createElement("div");
    mark.className = "rte-link-highlight";
    mark.style.left = `${(rect.left - box.left) / scaleX + container.scrollLeft}px`;
    mark.style.top = `${(rect.top - box.top) / scaleY + container.scrollTop}px`;
    mark.style.width = `${rect.width / scaleX}px`;
    mark.style.height = `${rect.height / scaleY}px`;
    container.appendChild(mark);
  }
}

function clearLinkHighlight(container: ParentNode): void {
  container
    .querySelectorAll(".rte-link-highlight")
    .forEach((el) => el.remove());
}

type ReactQuillInstance = { getEditor: () => QuillEditor };

/**
 * What a paste is not allowed to bring with it.
 *
 * A mail pasted out of Outlook carries its own type size, its own text
 * colour and whatever it was highlighted with — none of which is about
 * what the words say, and all of which lands in a message written in a
 * different face at a different size. Bold, italic, links and lists are
 * the author's meaning and stay.
 */
const PASTE_DROPPED_FORMATS = ["size", "color", "background"] as const;

/**
 * The same delta, with those formats taken off every run in it.
 *
 * Quill hands a matcher the delta it built for one node. Attributes left
 * as an empty object make an op that formats nothing, so the key goes when
 * the last of them does.
 */
function stripPastedFormats(delta: {
  ops?: Array<{ attributes?: Record<string, unknown> }>;
}) {
  for (const op of delta.ops ?? []) {
    if (!op.attributes) continue;
    for (const name of PASTE_DROPPED_FORMATS) delete op.attributes[name];
    if (!Object.keys(op.attributes).length) delete op.attributes;
  }
  return delta;
}

/**
 * A DOM range at a point on the screen.
 *
 * Two names for one thing. `caretPositionFromPoint` is the standard, and
 * `caretRangeFromPoint` is what WebKit has — which is the engine the Mac
 * app runs in.
 */
function caretRangeFromPoint(
  doc: Document,
  clientX: number,
  clientY: number
): Range | null {
  const legacy = (
    doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }
  ).caretRangeFromPoint;
  if (typeof legacy === "function") return legacy.call(doc, clientX, clientY);
  const standard = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint;
  if (typeof standard !== "function") return null;
  const position = standard.call(doc, clientX, clientY);
  if (!position) return null;
  const range = doc.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

export type RichTextEditorHandle = {
  /** Insert text at the cursor (replacing any selection) and refocus. */
  insertText: (text: string) => void;
  /**
   * Where the caret is, counted in characters from the start.
   *
   * For handing a half-written message from one box to another: what was
   * being written matters, and so does the place in it that was being
   * written. Null when the box does not have the caret.
   */
  getCaret: () => number | null;
  /** Put the caret back, clamped to what is actually there. */
  setCaret: (index: number) => void;
  /** Take the caret, leaving it where it last was. */
  focus: () => void;
  /**
   * Put a picture where the caret is.
   *
   * Held as a `data:` URI, which is the only thing an editor can show
   * without a server behind it. What goes out is not this — see
   * `extractInlineImages`, which turns each one into a part of the message
   * before it is sent.
   */
  insertImage: (dataUrl: string) => void;
  /**
   * Put the caret at a point on the screen, in client coordinates.
   *
   * For a file dragged over the message: the writer aims at a place in the
   * text, so the caret must follow the pointer and show where the picture
   * will go. What is dropped then goes in at the caret, which is what
   * `insertImage` writes to.
   *
   * False when the point is not in the text.
   */
  caretToPoint: (clientX: number, clientY: number) => boolean;
  /**
   * Apply an inline format to the selection, or `false` to take it off.
   *
   * For controls that cannot live in the toolbar element itself. Quill binds
   * its own buttons at mount, from inside that element, so anything in a
   * popover — which is drawn elsewhere and only when it opens — has to reach
   * the editor this way instead.
   */
  format: (name: string, value: string | boolean) => void;
  /** The inline formats at the selection, for showing which one is on. */
  activeFormats: () => Record<string, unknown>;
};

/**
 * Warm up the lazily-loaded Quill chunk (e.g. when the mail page mounts) so
 * the editor mounts instantly when a composer opens, instead of flashing a
 * half-built card while the chunk downloads.
 */
export function preloadRichTextEditor(): void {
  void import("react-quill-new").then(({ Quill }) => {
    registerSoftBreak(Quill);
    registerInlineStyles(Quill);
  });
}

// next/dynamic doesn't forward refs, so thread the instance ref through a
// regular prop on a small wrapper component.
/**
 * Corner handles on a picture in the message, to drag it to a size.
 *
 * A click on the picture selects it: a border, and a round teal-ringed
 * handle on each corner — the same handle the reading pane's own picture
 * wears. Dragging a corner sets the width, from 80px up to the width of
 * the box; the height follows the picture's own shape. The size is written
 * onto the picture as its width attribute, which is what the mail sends —
 * see sizeInlineImages, which leaves a picture alone once it says a width.
 *
 * The release goes through Quill as a format, so undo knows about it and
 * the change lands in the draft like anything typed.
 */
function ImageResizeOverlay({
  wrapperRef,
  quillRef,
}: {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  quillRef: React.MutableRefObject<ReactQuillInstance | null>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    setBox((prev) => {
      if (!img || !wrapper || !img.isConnected) return null;
      const wr = wrapper.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const { x: scaleX, y: scaleY } = cssZoomScale(wrapper);
      const next = {
        left: (ir.left - wr.left) / scaleX,
        top: (ir.top - wr.top) / scaleY,
        width: ir.width / scaleX,
        height: ir.height / scaleY,
      };
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
      )
        return prev;
      return next;
    });
  }, [img, wrapperRef]);

  // Select on a click on a picture; let go on a click anywhere else.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLImageElement &&
        target.closest(".ql-editor")
      ) {
        setImg(target);
        return;
      }
      if (target instanceof Element && target.closest("[data-image-resize]"))
        return;
      setImg(null);
    };
    wrapper.addEventListener("click", onClick);
    return () => wrapper.removeEventListener("click", onClick);
  }, [wrapperRef]);

  // Follow the picture while it is selected, and let go when it goes.
  useEffect(() => {
    if (!img) {
      setBox(null);
      return;
    }
    measure();
    // The caret sits beside the picture and draws at the line's height —
    // the picture's height — which reads as a black bar against it while
    // the corners are being dragged. Out of sight while one is selected;
    // a click on the words deselects and brings it back.
    const editorEl = img.closest(".ql-editor") as HTMLElement | null;
    if (editorEl) editorEl.style.caretColor = "transparent";
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    const onScroll = () => measure();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImg(null);
    };
    // The words moving under it moves it too — reposition on every edit,
    // and let go if the picture itself was deleted.
    const editor = quillRef.current?.getEditor();
    const onEdit = () => {
      if (!img.isConnected) setImg(null);
      else measure();
    };
    editor?.on("text-change", onEdit);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      ro.disconnect();
      if (editorEl) editorEl.style.caretColor = "";
      editor?.off("text-change", onEdit);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [img, measure, quillRef]);

  const startResize = (corner: "nw" | "ne" | "sw" | "se") =>
    (event: React.PointerEvent) => {
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget as HTMLElement;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // No capture is a looser drag, not a dead one: the move and the
        // release still arrive while the pointer stays on the handle.
      }
      const startX = event.clientX;
      // offsetWidth is in the card's own pixels, the same pixels the width
      // attribute means. The pointer moves in screen pixels, so its travel
      // is divided by the zoom before the two are added.
      const startWidth = img.offsetWidth;
      const visual = img.getBoundingClientRect().width;
      const scale = startWidth ? visual / startWidth : 1;
      // Dragging a right corner out grows the picture; a left corner, in.
      const sign = corner.includes("e") ? 1 : -1;
      const editorEl = img.closest(".ql-editor") as HTMLElement | null;
      const room = editorEl
        ? editorEl.clientWidth -
          parseFloat(getComputedStyle(editorEl).paddingLeft || "0") -
          parseFloat(getComputedStyle(editorEl).paddingRight || "0")
        : startWidth;
      let width = startWidth;
      const onMove = (move: PointerEvent) => {
        width = Math.round(
          Math.min(
            Math.max(startWidth + (sign * (move.clientX - startX)) / scale, 80),
            room
          )
        );
        img.setAttribute("width", String(width));
        img.removeAttribute("height");
        measure();
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        // Through Quill, so the size is a real edit: it lands in the draft
        // and undo can take it back.
        void import("react-quill-new").then(({ Quill }) => {
          const editor = quillRef.current?.getEditor();
          const find = (
            Quill as unknown as { find?: (node: Node) => unknown }
          ).find;
          if (!editor || !find) return;
          const blot = find.call(Quill, img);
          if (!blot) return;
          try {
            const index = editor.getIndex(blot as { parent?: unknown });
            editor.formatText(index, 1, { width: String(width) }, "user");
          } catch {
            /* the picture left the document mid-drag */
          }
        });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    };

  if (!box) return null;
  const corners: Array<{
    key: "nw" | "ne" | "sw" | "se";
    style: React.CSSProperties;
    cursor: string;
  }> = [
    { key: "nw", style: { left: -9, top: -9 }, cursor: "nwse-resize" },
    { key: "ne", style: { right: -9, top: -9 }, cursor: "nesw-resize" },
    { key: "sw", style: { left: -9, bottom: -9 }, cursor: "nesw-resize" },
    { key: "se", style: { right: -9, bottom: -9 }, cursor: "nwse-resize" },
  ];
  return (
    <div
      data-image-resize
      className="rich-text-editor-image-resize"
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "2px solid #14b8a6",
          borderRadius: 2,
        }}
      />
      {corners.map((corner) => (
        <button
          key={corner.key}
          type="button"
          aria-label="Resize the picture"
          onPointerDown={startResize(corner.key)}
          style={{
            position: "absolute",
            ...corner.style,
            height: 18,
            width: 18,
            borderRadius: 9999,
            border: "2px solid #14b8a6",
            background: "rgba(255,255,255,0.95)",
            cursor: corner.cursor,
            pointerEvents: "auto",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

/**
 * A right-click on a picture in the message: copy it, or crop it.
 *
 * The crop is written back through Quill as one edit — the old picture out,
 * the cut one in at the same place — so undo brings the whole picture back.
 * A picture that was given a width keeps its scale: half the width cropped
 * away is half the width on the page.
 */
function ImageActions({
  wrapperRef,
  quillRef,
}: {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  quillRef: React.MutableRefObject<ReactQuillInstance | null>;
}) {
  const [menu, setMenu] = useState<{
    img: HTMLImageElement;
    x: number;
    y: number;
  } | null>(null);
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLImageElement) ||
        !target.closest(".ql-editor")
      )
        return;
      event.preventDefault();
      setMenu({ img: target, x: event.clientX, y: event.clientY });
    };
    wrapper.addEventListener("contextmenu", onContextMenu);
    return () => wrapper.removeEventListener("contextmenu", onContextMenu);
  }, [wrapperRef]);

  const dismissMenu = useCallback(() => setMenu(null), []);

  const replace = useCallback(
    (img: HTMLImageElement, dataUrl: string, keptWidth: number) => {
      void import("react-quill-new").then(({ Quill }) => {
        const editor = quillRef.current?.getEditor();
        const find = (Quill as unknown as { find?: (node: Node) => unknown })
          .find;
        if (!editor || !find || !img.isConnected) return;
        const blot = find.call(Quill, img);
        if (!blot) return;
        const width = Number(img.getAttribute("width"));
        try {
          const index = editor.getIndex(blot as { parent?: unknown });
          editor.deleteText(index, 1, "user");
          editor.insertEmbed(index, "image", dataUrl, "user");
          if (width > 0) {
            editor.formatText(
              index,
              1,
              { width: String(Math.max(1, Math.round(width * keptWidth))) },
              "user"
            );
          }
          editor.setSelection(index + 1, 0, "user");
        } catch {
          /* the picture left the document while the crop window was open */
        }
      });
    },
    [quillRef]
  );

  return (
    <>
      {menu ? (
        <ImageContextMenu
          at={{ x: menu.x, y: menu.y }}
          onDismiss={dismissMenu}
          onCopy={() => copyImageToClipboard(menu.img)}
          onCrop={() => setCropping(menu.img)}
        />
      ) : null}
      {cropping ? (
        <ImageCropDialog
          image={cropping}
          onCancel={() => setCropping(null)}
          onCrop={(dataUrl, keptWidth) => {
            replace(cropping, dataUrl, keptWidth);
            setCropping(null);
          }}
        />
      ) : null}
    </>
  );
}

const ReactQuill = dynamic(
  async () => {
    const { default: RQ, Quill } = await import("react-quill-new");
    registerSoftBreak(Quill);
    registerInlineStyles(Quill);
    function ReactQuillWithRef({
      quillRef,
      ...props
    }: React.ComponentProps<typeof RQ> & {
      quillRef: React.MutableRefObject<ReactQuillInstance | null>;
    }) {
      return <RQ ref={quillRef as never} {...props} />;
    }
    return ReactQuillWithRef;
  },
  {
    ssr: false,
    // Quiet spacer roughly matching the mounted editor, so the composer card
    // doesn't flash a skeleton if the chunk isn't cached yet.
    loading: () => <div className="min-h-[100px] w-full" />,
  }
);

type RichTextEditorProps = {
  value?: string;
  /**
   * Uncontrolled mode: seeds the editor once and never resets it from props.
   * Use for live typing surfaces (e.g. mail compose) where feeding Quill's
   * output back as `value` would make it re-parse and drop trailing spaces.
   */
  defaultValue?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
  /**
   * Id of a parent-rendered element to use as the Quill toolbar (must contain
   * `.ql-*` buttons and exist before the editor mounts). Lets the composer
   * place the formatting buttons in its own footer row.
   */
  toolbarId?: string;
  /**
   * Which toolbar the editor wears.
   *
   * "snow" is the bar above the box, which is right where there is room for
   * one. "bubble" has no bar at all: the controls appear over a selection,
   * for a window small enough that a permanent toolbar would be most of it.
   */
  variant?: "snow" | "bubble";
  /** Receives an imperative handle (e.g. for inserting emoji at the cursor). */
  handleRef?: React.MutableRefObject<RichTextEditorHandle | null>;
  /**
   * Enter sends, and starts no line.
   *
   * For a chat box, where Enter has always meant send and shift-Enter has
   * always meant a new line. Left unset, Enter does what it does in a mail
   * composer: it starts a paragraph.
   */
  onEnter?: () => void;
};

export function RichTextEditor({
  value,
  defaultValue,
  onChange,
  placeholder = "Write your message here...",
  className = "",
  minHeight = 100,
  toolbarId,
  variant = "snow",
  handleRef,
  onEnter,
}: RichTextEditorProps) {
  const quillRef = useRef<ReactQuillInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /**
   * Cmd+Shift+V pastes the words and nothing else.
   *
   * In a browser the key fires a paste of its own — WebKit reads it as
   * "paste and match style" — so this was written as a note for the paste
   * about to arrive: take `text/plain` and put it in as typing.
   *
   * In the desktop app nothing fires. That reading of the key belongs to
   * the Edit menu, and the menu the app is given has Paste on it and not
   * Paste and Match Style, so the keystroke reaches the page and stops
   * there: no paste, no event, nothing pasted at all.
   *
   * So the key does the paste itself, out of the clipboard, and the note
   * stays for the environments where a paste does follow. Where there is no
   * clipboard to read — Firefox does not offer one to a page — nothing is
   * prevented and the old path is what happens.
   *
   * The desktop app is asked first, and asked through the shell rather than
   * through the page. A page reading its own clipboard puts a Paste button
   * on screen in WebKit: press the shortcut, then press a button to confirm
   * the thing you just asked for. The app owns the pasteboard and needs no
   * permission to look at it.
   */
  const plainPasteRef = useRef(false);
  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    const root = editor?.root;
    if (!root) return;
    /** The words, dropped in at the caret as if they had been typed. */
    const typeIn = (text: string) => {
      const quill = quillRef.current?.getEditor();
      if (!quill || !text) return;
      const range = quill.getSelection(true);
      const index = range?.index ?? Math.max(quill.getLength() - 1, 0);
      if (range?.length) quill.deleteText(index, range.length, "user");
      quill.insertText(index, text, "user");
      quill.setSelection(index + text.length, 0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "v") return;
      // The note, for a paste that may follow this key.
      plainPasteRef.current = true;
      // And the paste itself, for where one does not. The shell first: no
      // button to press. Then the page's own clipboard, for a browser.
      event.preventDefault();
      void readClipboardText()
        .then((text) => text ?? navigator.clipboard?.readText?.())
        .then((text) => {
          if (typeof text !== "string") throw new Error("no clipboard");
          plainPasteRef.current = false;
          typeIn(text);
        })
        .catch(() => {
          // Nothing readable — leave the note set, in case the webview
          // issues a paste after all.
        });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!plainPasteRef.current) return;
      plainPasteRef.current = false;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      // Nothing to put in is nothing to do — and letting Quill have the
      // event would paste the formatted copy the shortcut refused.
      event.preventDefault();
      event.stopPropagation();
      typeIn(text);
    };
    const clear = () => {
      plainPasteRef.current = false;
    };
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("paste", onPaste, true);
    root.addEventListener("keyup", clear);
    return () => {
      root.removeEventListener("keydown", onKeyDown, true);
      root.removeEventListener("paste", onPaste, true);
      root.removeEventListener("keyup", clear);
    };
  });

  /**
   * An outside toolbar's buttons act on this editor, and on no other.
   *
   * Quill's toolbar module puts a click listener on each `ql-` button when an
   * editor is built, and nothing takes it off when the editor goes. The
   * composer's toolbar outlives its editor: development builds every editor
   * twice, and a draft that loads builds the box again. So one press ran the
   * listener of every editor the toolbar had served, oldest first — and an
   * old one, putting its own saved selection back into its detached copy,
   * took the selection out of the box being written in. The editor on the
   * page then found nothing selected and did nothing: a bold line would not
   * go un-bold, and italic and underline did not work either.
   *
   * So the press is caught on the toolbar, on the way down, before any of
   * those listeners hears it, and done here for the editor on the page.
   * Buttons without a `ql-` class, the emoji picker and Aa, are left alone.
   */
  useEffect(() => {
    if (!toolbarId) return;
    const toolbar = document.getElementById(toolbarId);
    if (!toolbar) return;
    const onClick = (event: MouseEvent) => {
      const button =
        event.target instanceof Element ? event.target.closest("button") : null;
      if (!button || !toolbar.contains(button)) return;
      const format = [...button.classList]
        .find((name) => name.startsWith("ql-"))
        ?.slice("ql-".length);
      if (!format) return;
      const editor = quillRef.current?.getEditor() as unknown as
        | {
            focus: () => void;
            format: (name: string, value: unknown, source: string) => void;
            getModule: (name: string) => unknown;
            getSelection: () => unknown;
          }
        | undefined;
      if (!editor) return;
      event.preventDefault();
      event.stopPropagation();
      const toolbarModule = editor.getModule("toolbar") as
        | {
            handlers?: Record<string, (value: unknown) => void>;
            update?: (range: unknown) => void;
          }
        | undefined;
      // What Quill's own listener would have done, for this editor only.
      const value = button.classList.contains("ql-active")
        ? false
        : button.value || !button.hasAttribute("value");
      editor.focus();
      const handler = toolbarModule?.handlers?.[format];
      if (handler) handler.call(toolbarModule, value);
      else editor.format(format, value, "user");
      toolbarModule?.update?.(editor.getSelection());
    };
    toolbar.addEventListener("click", onClick, true);
    return () => toolbar.removeEventListener("click", onClick, true);
  });

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      insertText: (text) => {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        // getSelection(true) focuses the editor and restores the caret the
        // user left behind before clicking the toolbar.
        const range = editor.getSelection(true);
        const index = range?.index ?? Math.max(editor.getLength() - 1, 0);
        if (range?.length) editor.deleteText(index, range.length, "user");
        editor.insertText(index, text, "user");
        editor.setSelection(index + text.length, 0);
      },
      getCaret: () => {
        const editor = quillRef.current?.getEditor();
        // Not getSelection(true): asking would focus the box and give an
        // answer about a caret the reader never put there.
        return editor?.getSelection()?.index ?? null;
      },
      setCaret: (index) => {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        // Quill counts a trailing newline of its own, so the last place a
        // caret can sit is one before the end.
        const last = Math.max(editor.getLength() - 1, 0);
        editor.setSelection(Math.max(0, Math.min(index, last)), 0);
      },
      focus: () => {
        quillRef.current?.getEditor()?.focus();
      },
      insertImage: (dataUrl) => {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        // getSelection(true) focuses the editor and restores the caret the
        // writer left behind before reaching for the clipboard.
        const range = editor.getSelection(true);
        const index = range?.index ?? Math.max(editor.getLength() - 1, 0);
        if (range?.length) editor.deleteText(index, range.length, "user");
        editor.insertEmbed(index, "image", dataUrl, "user");
        // After the picture, not on it: the next thing typed is a caption
        // or the rest of the sentence, and neither belongs inside it.
        editor.setSelection(index + 1, 0);
      },
      caretToPoint: (clientX, clientY) => {
        const editor = quillRef.current?.getEditor();
        if (!editor) return false;
        const doc = editor.root.ownerDocument;
        const range = caretRangeFromPoint(doc, clientX, clientY);
        if (!range || !editor.root.contains(range.startContainer)) return false;
        // Focus first. A selection in an element that does not have the
        // focus draws no caret, and the caret is the whole point of this.
        editor.root.focus({ preventScroll: true });
        const selection = doc.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();
        selection.addRange(range);
        // Quill keeps its own idea of where the caret is, and it reads it
        // from the DOM. Without this the insert lands where the caret was
        // before the drag.
        editor.update();
        return true;
      },
      format: (name, value) => {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        // The popover holds the focus while it is open. getSelection(true)
        // takes it back and restores the range the writer selected before
        // reaching for the menu, which is what the format is meant for.
        editor.getSelection(true);
        editor.format(name, value, "user");
      },
      activeFormats: () =>
        quillRef.current?.getEditor()?.getFormat() ?? {},
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  /**
   * Sit Quill's tooltips where the words are after CSS zoom.
   *
   * Quill's own `position` uses `getBounds`, which is screen pixels, then
   * writes those numbers onto absolutely placed elements inside the zoomed
   * card. At 118% the bubble bar lands in the empty space under the words,
   * and the link editor lands below the toolbar and out of the card. The
   * image overlay already divides the scale back out.
   */
  useEffect(() => {
    let cancelled = false;
    let unbind = () => {};
    let tries = 0;

    const bind = () => {
      if (cancelled) return;
      const editor = quillRef.current?.getEditor() as QuillEditor | undefined;
      const tooltip = editor?.theme?.tooltip;
      if (!editor || !tooltip?.root || !tooltip.position) {
        // The editor arrives by a dynamic import, and on a cold dev server
        // that is longer than the sixty frames this used to wait — after
        // which nothing here was bound, and the link box stood wherever
        // Quill left it, off the card's edge. A slow poll, for as long as
        // the component lives.
        if (tries++ < 600) window.setTimeout(bind, 100);
        return;
      }

      /*
       * The link editor and the snow preview, corrected in place.
       *
       * Quill writes these tooltips' left/top itself, in screen pixels,
       * and inside a zoomed card that lands below and right of the words
       * — at 118% the link box sat under the toolbar and ran out of the
       * card. The numbers Quill wrote are divided by the zoom and held
       * inside the card. Only what Quill wrote: our own write is
       * recognised and left to stand, or the observer would divide it
       * again on every pass.
       */
      let written: { left: string; top: string } | null = null;
      /** Which side of the words `place` last put the bubble bar on. */
      let lastFlipped = false;
      const rescale = () => {
        const root = tooltip.root;
        const parent =
          (root.offsetParent as HTMLElement | null) ?? editor.root.parentElement;
        // The tinted words go with the link box (see paintLinkHighlight).
        if (
          parent &&
          (root.classList.contains("ql-hidden") ||
            !root.classList.contains("ql-editing"))
        ) {
          clearLinkHighlight(parent);
        }
        if (root.classList.contains("ql-hidden")) return;
        /*
          The bubble bar is placed by `place` below, in the box's own
          pixels, and its link field opens in the bar's place — nothing
          about it needs correcting. Quill does drop `ql-flip` as the field
          opens, which turned the bar's offset the other way and put the
          field over the words; the side `place` chose is put back.
        */
        if (variant === "bubble") {
          if (
            root.classList.contains("ql-editing") &&
            root.classList.contains("ql-flip") !== lastFlipped
          ) {
            root.classList.toggle("ql-flip", lastFlipped);
          }
          return;
        }
        if (
          written &&
          root.style.left === written.left &&
          root.style.top === written.top
        ) {
          return;
        }
        if (!parent) return;
        const { x: scaleX, y: scaleY } = cssZoomScale(parent);
        const rawLeft = parseFloat(root.style.left || "0");
        const rawTop = parseFloat(root.style.top || "0");
        const maxLeft = Math.max(0, parent.clientWidth - root.offsetWidth);
        const left = Math.min(Math.max(0, rawLeft / scaleX), maxLeft);
        /*
          Held inside the window, not inside the box.

          The box is often shorter than this editor — a reply composer is
          eighty pixels tall and the link editor is a hundred and thirty —
          so holding it inside the box is not possible, and what was meant
          all along was inside the window. Kept in the box, it was drawn
          against the foot of the composer and cut off there; kept in the
          window, it sits over the conversation instead, which is what a
          popover bigger than its box has to do.

          The composer stands aside while it is open — see the `:has`
          rules in mail.css — so an offset above the box now shows rather
          than being clipped away.
        */
        const parentRect = parent.getBoundingClientRect();
        const margin = 8;
        const heightNow = root.offsetHeight * scaleY;
        const lowest =
          (window.innerHeight - margin - heightNow - parentRect.top) / scaleY;
        const highest = (margin - parentRect.top) / scaleY;
        const wanted = rawTop / scaleY;
        const top =
          lowest >= highest
            ? Math.min(Math.max(wanted, highest), lowest)
            : highest;
        written = { left: `${left}px`, top: `${top}px` };
        root.style.left = written.left;
        root.style.top = written.top;
        // The caret points at the words wherever the box was held to.
        const anchor = parseFloat(root.dataset.anchorX ?? "");
        if (Number.isFinite(anchor)) {
          const inset = 18;
          const caret = Math.min(
            Math.max(anchor / scaleX - left, inset),
            Math.max(inset, root.offsetWidth - inset)
          );
          root.style.setProperty("--rte-caret-x", `${caret}px`);
        }
      };

      const place = () => {
        const root = tooltip.root;
        if (
          root.classList.contains("ql-hidden") ||
          root.classList.contains("ql-editing")
        ) {
          return;
        }
        const sel = editor.root.ownerDocument.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        if (!editor.root.contains(sel.anchorNode)) return;
        const selRect = sel.getRangeAt(0).getBoundingClientRect();
        if (selRect.width === 0 && selRect.height === 0) return;
        const parent =
          (root.offsetParent as HTMLElement | null) ?? editor.root.parentElement;
        if (!parent) return;
        const parentRect = parent.getBoundingClientRect();
        const { x: scaleX, y: scaleY } = cssZoomScale(parent);
        const left =
          (selRect.left + selRect.width / 2 - parentRect.left) / scaleX -
          root.offsetWidth / 2;
        const placed = placeBubbleBar({
          selTop: selRect.top,
          selBottom: selRect.bottom,
          parentTop: parentRect.top,
          parentBottom: parentRect.bottom,
          barHeight: root.offsetHeight,
          scaleY,
        });
        lastFlipped = placed.flipped;
        root.classList.toggle("ql-flip", placed.flipped);
        const heldLeft = Math.max(0, left);
        root.style.left = `${heldLeft}px`;
        root.style.top = `${placed.top}px`;
        // The caret points at the words even when the bar is held at the
        // editor's edge — the same aim the link box takes (see rescale).
        const inset = 18;
        const caret = Math.min(
          Math.max(
            (selRect.left + selRect.width / 2 - parentRect.left) / scaleX -
              heldLeft,
            inset
          ),
          Math.max(inset, root.offsetWidth - inset)
        );
        root.style.setProperty("--rte-caret-x", `${caret}px`);
      };

      const original = tooltip.position.bind(tooltip);
      tooltip.position = (reference: unknown) => {
        const shift = original(reference);
        if (variant === "bubble") place();
        rescale();
        return shift;
      };
      if (variant === "bubble") editor.on("selection-change", place);
      // The link editor opens without a `position` call, so the class flip
      // and Quill's style writes are watched as well.
      const observer = new MutationObserver(rescale);
      observer.observe(tooltip.root, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      unbind = () => {
        tooltip.position = original;
        if (variant === "bubble") editor.off("selection-change", place);
        observer.disconnect();
      };
    };

    bind();
    return () => {
      cancelled = true;
      unbind();
    };
  }, [variant]);

  /*
   * Through a ref, never straight into `modules`.
   *
   * Quill is built from `modules` once; a new object rebuilds the editor and
   * loses the caret with it. A send handler is rebuilt on almost every
   * keystroke — it reads the draft — so binding it directly would rebuild
   * the box as fast as it could be typed in.
   */
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const modules = useMemo(
    () => ({
      /*
        Quill's own drop handling, turned off. Its Uploader writes a dropped
        picture straight into the text, full size and with no cap on the
        bytes — beside the composer's handler, which also inserted one. One
        drop, two pictures. The module keeps its listener (which stops the
        browser navigating to a dropped file), but its handler does nothing.

        The handler, not the mimetypes list: Quill folds these options into
        the module's defaults with lodash merge, and merge skips an empty
        array — `mimetypes: []` left the defaults standing and the double
        insert with them. A function replaces a function.
      */
      uploader: {
        handler() {},
      },
      /*
        Every element a paste brings in loses the formats above on its way
        into the message — see PASTE_DROPPED_FORMATS. A matcher rather than
        a scrub afterwards: this is the delta Quill is about to apply, so
        nothing wrong is ever in the document to be undone.
      */
      clipboard: {
        matchers: [
          [
            1 /* Node.ELEMENT_NODE — the constant is not in scope on the
                 server, and this module is parsed there. */,
            (_node: unknown, delta: { ops?: Array<{ attributes?: Record<string, unknown> }> }) =>
              stripPastedFormats(delta),
          ],
        ],
      },
      toolbar: {
        container: toolbarId
          ? `#${toolbarId}`
          : // The same set either way. Which toolbar a box wears is about
            // the room it has, not about what can be done in it — a
            // narrow box was offering four of the six and no way to reach
            // the other two.
            [
              ["bold", "italic", "underline"],
              [{ list: "ordered" }, { list: "bullet" }],
              ["link"],
            ],
        handlers: { link: linkToolbarHandler },
      },
      /*
        Undo undoes what the reader did, and nothing else.

        Quill records every change by default, ours included — and this
        editor is seeded through the wrapper's `setContents`, which is a
        change like any other. So the stack opened with a step that was not
        the reader's, and the first Cmd+Z spent itself on that instead of on
        the sentence they had just written.

        `userOnly` leaves the seeding out of it. The keys are bound here as
        well, because a binding of ours is the one that runs: it says what
        the key does in the box the caret is in, whatever the window around
        it would otherwise do with it.
      */
      history: { userOnly: true },
      keyboard: {
        bindings: {
          undo: {
            key: "z",
            shortKey: true,
            shiftKey: false,
            handler(this: { quill: QuillEditor }) {
              (this.quill as unknown as { history?: { undo: () => void } })
                .history?.undo();
              return false;
            },
          },
          redo: {
            key: "z",
            shortKey: true,
            shiftKey: true,
            handler(this: { quill: QuillEditor }) {
              (this.quill as unknown as { history?: { redo: () => void } })
                .history?.redo();
              return false;
            },
          },
          /*
            Cmd+K opens the link editor on the selection, the way every
            editor with a link button also answers the key for it. Quill
            binds bold, italic and underline itself and not this one, so
            the button was the only way in and the key did nothing.

            With nothing selected there is nothing to make a link of:
            `true` hands the key back, rather than swallowing it into a
            box where it now means nothing.
          */
          openLink: {
            key: "k",
            shortKey: true,
            handler(this: ToolbarHandlerContext) {
              const range = this.quill.getSelection();
              if (!range || !range.length) return true;
              linkToolbarHandler.call(this, true);
              return false;
            },
          },
          softBreak: {
            key: "Enter",
            shiftKey: true,
            handler: shiftEnterSoftBreak,
          },
          // Returning false stops Quill's own Enter, so nothing is typed
          // into a box that is being emptied and sent. Without a handler
          // set, this hands straight back to Quill.
          send: {
            key: "Enter",
            shiftKey: false,
            handler: () => {
              const send = onEnterRef.current;
              if (!send) return true;
              send();
              return false;
            },
          },
        },
      },
    }),
    [toolbarId, variant]
  );

  const formats = [
    "bold",
    "italic",
    "underline",
    "list",
    "link",
    "softbreak",
    "strike",
    // Quill writes this one as <sub> and <sup>, which every mail app draws
    // without being told how — the same reason strike is safe to offer.
    "script",
    "font",
    "size",
    "color",
    "background",
    // A picture pasted into the message. Quill drops any format not named
    // here, so without it an inserted image vanished on the next keystroke.
    "image",
  ];

  return (
    <div
      ref={wrapperRef}
      className={`rich-text-editor rich-text-editor-${variant} ${className}`}
      style={{
        ["--editor-min-height" as string]: `${minHeight}px`,
        position: "relative",
      }}
    >
      <ImageResizeOverlay wrapperRef={wrapperRef} quillRef={quillRef} />
      <ImageActions wrapperRef={wrapperRef} quillRef={quillRef} />
      <ReactQuill
        quillRef={quillRef}
        theme={variant}
        {...(defaultValue !== undefined
          ? { defaultValue }
          : { value: value ?? "" })}
        /*
          On every change react-quill-new works out the editor's "semantic
          HTML" — a walk of the whole document — to keep its own copy of
          the value. What goes to the parent is the editor's innerHTML, so
          that walk was done on each keystroke and thrown away. With this
          off, its copy is the innerHTML too, which is also what comes back
          as `value`, so the two agree.
        */
        useSemanticHTML={false}
        onChange={(content, _delta, source, editor) => {
          // Quill emits source "api" when React updates the value prop. If we
          // propagate that, parent state changes → new value → another "api"
          // event → infinite loop and a frozen tab (Chrome "Page Unresponsive").
          if (source !== "user") return;
          onChange(editor.getHTML() || content);
        }}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
      />
      <style>{`
        .rich-text-editor .ql-container {
          min-height: var(--editor-min-height, 100px);
          font-size: 14px;
          font-family: Helvetica, Arial, sans-serif;
          border-bottom-left-radius: 0.375rem;
          border-bottom-right-radius: 0.375rem;
        }
        .rich-text-editor-snow .ql-toolbar {
          border-top-left-radius: 0.375rem;
          border-top-right-radius: 0.375rem;
          background: #faf8f5;
          padding: 4px 6px;
          display: flex;
          align-items: center;
        }
        .rich-text-editor-snow .ql-toolbar.ql-snow .ql-formats {
          margin-right: 8px;
          display: inline-flex;
          align-items: center;
        }
        .rich-text-editor-snow .ql-toolbar button {
          width: 22px;
          height: 20px;
          padding: 2px 3px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .rich-text-editor-snow .ql-toolbar button svg {
          width: 15px;
          height: 15px;
        }
        .rich-text-editor .ql-editor {
          min-height: var(--editor-min-height, 100px);
          font-family: Helvetica, Arial, sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #222;
        }
        /* A paragraph is a line. Enter moves one line down, the way it
           does in every mail client, and a blank line is Enter pressed
           twice. The mail goes out saying margin zero on each paragraph
           — see client-email-html — so this box shows what will arrive. */
        .rich-text-editor .ql-editor p {
          margin: 0;
          line-height: 1.5;
        }
        .rich-text-editor .ql-editor ul,
        .rich-text-editor .ql-editor ol {
          margin: 0 0 16px 18px;
          padding: 0;
        }
        .rich-text-editor .ql-editor li {
          margin: 0 0 8px 0;
        }
        .rich-text-editor .ql-editor a {
          color: #1d4ed8;
          text-decoration: underline;
        }
        .rich-text-editor .ql-editor.ql-blank::before {
          font-style: normal;
          color: #9ca3af;
        }
        /* Link tooltip: a soft card instead of Quill's bare grey strip. */
        /* Our display: flex below would otherwise beat Quill's own hide rule. */
        .rich-text-editor .ql-snow .ql-tooltip.ql-hidden {
          display: none;
        }
        /*
          Pinned to the words, not to the box.

          Quill centres it under the selection and the correction in the
          component keeps it in the window. Its left used to be forced to
          the editor's edge, which put it under To and Subject in a
          two-line message and nowhere near the words in a long one.
        */
        .rich-text-editor .ql-snow .ql-tooltip {
          right: auto !important;
          transform: none !important;
          z-index: 100;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          width: 340px;
          max-width: calc(100% - 24px);
          padding: 14px 16px;
          border: none;
          border-radius: 14px;
          background: #fff;
          box-shadow:
            0 10px 32px rgba(28, 25, 23, 0.16),
            0 2px 8px rgba(28, 25, 23, 0.08);
          color: #57534e;
          white-space: normal;
          font-family: inherit;
        }
        .rich-text-editor .ql-snow .ql-tooltip::before {
          content: "Link";
          width: 100%;
          margin: 0;
          line-height: 1.4;
          font-size: 14px;
          color: #57534e;
        }
        .rich-text-editor .ql-snow .ql-tooltip a.ql-preview {
          flex: 1;
          min-width: 0;
          max-width: none;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 14px;
          color: #1d4ed8;
        }
        .rich-text-editor .ql-snow .ql-tooltip input[type="text"] {
          display: none;
          height: auto;
          padding: 9px 12px;
          border: 1px solid #e7e5e4;
          border-radius: 10px;
          font-size: 14px;
          color: #292524;
        }
        /*
          Writing the address: one line — the link mark, the address, the
          return. No label: the selection is the link's text, and it is
          tinted on the page behind the box (see .rte-link-highlight). No
          help line: Enter and Esc do what they do everywhere.
        */
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing {
          flex-wrap: nowrap;
          width: 380px;
          margin-top: 10px;
          padding: 10px 12px;
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing.ql-flip {
          margin-top: -10px;
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing::before {
          content: "";
          flex: none;
          width: 20px;
          height: 20px;
          margin: 0 2px;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E") center / contain no-repeat;
        }
        /* The caret, on the edge that faces the words. */
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing::after {
          content: "";
          position: absolute;
          top: -7px;
          left: var(--rte-caret-x, 50%);
          width: 14px;
          height: 14px;
          margin-left: -7px;
          border-radius: 2px;
          background: #fff;
          transform: rotate(45deg);
          box-shadow: -2px -2px 4px rgba(28, 25, 23, 0.05);
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing.ql-flip::after {
          top: auto;
          bottom: -7px;
          box-shadow: 2px 2px 4px rgba(28, 25, 23, 0.05);
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing input[type="text"] {
          display: block;
          flex: 1;
          width: auto;
          min-width: 0;
          padding: 11px 12px;
          font-size: 15px;
        }
        .rich-text-editor .ql-snow .ql-tooltip input[type="text"]:focus {
          outline: none;
          border-color: #0f766e;
        }
        .rich-text-editor .ql-snow .ql-tooltip input[type="text"]::placeholder {
          color: #a8a29e;
        }
        .rich-text-editor .ql-snow .ql-tooltip a.ql-action,
        .rich-text-editor .ql-snow .ql-tooltip a.ql-remove {
          font-size: 13px;
          font-weight: 500;
          color: #0f766e;
        }
        .rich-text-editor .ql-snow .ql-tooltip a.ql-action::after {
          content: "Edit";
          margin-left: 0;
          padding-right: 10px;
          border-right: 1px solid #e7e5e4;
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing a.ql-action {
          display: inline-flex;
          flex: none;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 12px;
          background: #0d9488;
          color: #fff;
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing a.ql-action:hover {
          background: #0f766e;
        }
        .rich-text-editor .ql-snow .ql-tooltip.ql-editing a.ql-action::after {
          content: "";
          width: 20px;
          height: 20px;
          margin: 0;
          padding: 0;
          border: none;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='9 10 4 15 9 20'/%3E%3Cpath d='M20 4v7a4 4 0 0 1-4 4H4'/%3E%3C/svg%3E") center / contain no-repeat;
        }
        /*
          The formatting bubble, in the same hand.

          Quill dresses it as a dark pill with a triangle under it. The
          link box above is a light card with a caret, and the two come up
          over the same words for the same kind of reason — so the bubble
          takes the card: the same white, the same shadow, the same caret,
          stone marks that turn teal when the format is on.
        */
        .rich-text-editor .ql-bubble .ql-tooltip {
          z-index: 100;
          padding: 4px 6px;
          border-radius: 14px;
          background: #fff;
          color: #57534e;
          box-shadow:
            0 10px 32px rgba(28, 25, 23, 0.16),
            0 2px 8px rgba(28, 25, 23, 0.08);
        }
        .rich-text-editor .ql-bubble .ql-tooltip-arrow {
          display: none;
        }
        .rich-text-editor .ql-bubble .ql-tooltip::after {
          content: "";
          position: absolute;
          top: -7px;
          left: var(--rte-caret-x, 50%);
          width: 14px;
          height: 14px;
          margin-left: -7px;
          border-radius: 2px;
          background: #fff;
          transform: rotate(45deg);
          box-shadow: -2px -2px 4px rgba(28, 25, 23, 0.05);
        }
        .rich-text-editor .ql-bubble .ql-tooltip.ql-flip::after {
          top: auto;
          bottom: -7px;
          box-shadow: 2px 2px 4px rgba(28, 25, 23, 0.05);
        }
        .rich-text-editor .ql-bubble .ql-toolbar .ql-formats {
          margin: 4px 6px 4px 0;
        }
        .rich-text-editor .ql-bubble .ql-toolbar .ql-formats:first-child {
          margin-left: 6px;
        }
        .rich-text-editor .ql-bubble .ql-toolbar button {
          border-radius: 8px;
        }
        .rich-text-editor .ql-bubble .ql-toolbar button:hover {
          background: #f5f5f4;
        }
        .rich-text-editor .ql-bubble .ql-stroke {
          stroke: #57534e;
        }
        .rich-text-editor .ql-bubble .ql-fill {
          fill: #57534e;
        }
        .rich-text-editor .ql-bubble .ql-toolbar button:hover .ql-stroke,
        .rich-text-editor .ql-bubble .ql-toolbar button.ql-active .ql-stroke {
          stroke: #0d9488;
        }
        .rich-text-editor .ql-bubble .ql-toolbar button:hover .ql-fill,
        .rich-text-editor .ql-bubble .ql-toolbar button.ql-active .ql-fill {
          fill: #0d9488;
        }
        /* Its own link box: the same field, on the same card. */
        .rich-text-editor .ql-bubble .ql-tooltip-editor input[type="text"] {
          padding: 10px 40px 10px 14px;
          color: #292524;
          font-size: 14px;
          font-family: inherit;
        }
        .rich-text-editor .ql-bubble .ql-tooltip-editor input[type="text"]::placeholder {
          color: #a8a29e;
        }
        .rich-text-editor .ql-bubble .ql-tooltip-editor a:before {
          color: #a8a29e;
        }
        /* The tinted words, while the box is open. Over the text, and thin
           enough to read through. */
        .rich-text-editor .rte-link-highlight {
          position: absolute;
          z-index: 1;
          pointer-events: none;
          border-radius: 4px;
          background: rgba(13, 148, 136, 0.18);
          mix-blend-mode: multiply;
        }
      `}</style>
    </div>
  );
}
