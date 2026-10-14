"use client";

/**
 * How many lines a message's body takes on screen.
 *
 * Measured from the rendered body, not counted from the source: a paragraph
 * of one long line wraps to many, and an HTML message has no newlines worth
 * counting. The body's height is divided by its line height. A plain-text
 * body reads the line height of its paragraph. An HTML body is a frame, and
 * the frame's own text is 14px at a line height of 1.5 (see buildSrcDoc), so
 * that is 21px.
 *
 * Rects come back in zoomed pixels, and the line height is in the body's own
 * pixels, so the height is divided by the pane zoom first.
 */

import * as React from "react";

/** The line height of the text in an email frame: 14px at 1.5. */
const FRAME_LINE_HEIGHT_PX = 21;
/** The line height of a plain-text bubble (text-sm). */
const PLAIN_LINE_HEIGHT_PX = 20;

/** Lines in a body box, from its height and its line height. */
export function countRenderedLines(el: HTMLElement, zoom: number, html: boolean): number {
  const height = el.getBoundingClientRect().height / (zoom || 1);
  if (!(height > 0)) return 0;
  let lineHeight = html ? FRAME_LINE_HEIGHT_PX : PLAIN_LINE_HEIGHT_PX;
  const paragraph = html ? null : el.querySelector("p");
  if (paragraph) {
    const read = parseFloat(window.getComputedStyle(paragraph).lineHeight);
    if (read > 0) lineHeight = read;
  }
  return Math.round(height / lineHeight);
}

/**
 * The line count of the body in `ref`, kept up to date as it resizes.
 * `contentKey` changes when the words change, so the count is read again.
 */
export function useRenderedLines(
  ref: React.RefObject<HTMLElement | null>,
  zoom: number,
  html: boolean,
  contentKey: string
): number {
  const [lines, setLines] = React.useState(0);
  /*
    A passive effect, not a layout effect: the button is drawn before the
    body in the bubble, so in the layout pass the body's ref is not set yet.
    After the commit it is.
  */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLines(countRenderedLines(el, zoom, html));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, zoom, html, contentKey]);
  return lines;
}
