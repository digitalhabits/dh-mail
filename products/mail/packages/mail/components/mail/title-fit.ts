/*
 * The size of a thread's subject in its header.
 *
 * A short subject stays large. A longer one steps down to 20px, then 17px,
 * and past that wraps onto two lines at 17px, so the header keeps nearly
 * the same height whatever the subject (Ulrik, 2026-10-21).
 *
 * The subject is measured with the font's own metrics on a canvas, not by
 * drawing it and looking: no second layout pass, and no flicker between
 * sizes. Georgia is a system font, so it is there to measure at once.
 */

import * as React from "react";

const SIZES = [26, 20, 17] as const;
const FONT_STACK = 'Georgia, "Times New Roman", serif';
/** As mail.css sets a heading's tracking: -0.01em. */
const TRACKING = -0.01;

export type TitleFit = { size: number; lines: 1 | 2 };

let measure: CanvasRenderingContext2D | null = null;

function textWidth(text: string, size: number): number {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return 0;
  measure.font = `700 ${size}px ${FONT_STACK}`;
  return measure.measureText(text).width + text.length * size * TRACKING;
}

/** The largest size the subject fits in on one line, or two lines at 17px. */
export function fitTitle(text: string, width: number): TitleFit {
  for (const size of SIZES) {
    // A pixel or two in hand: the measure and the drawing round apart.
    if (textWidth(text, size) <= width - 2) return { size, lines: 1 };
  }
  return { size: 17, lines: 2 };
}

/*
 * Where the letters stand. The header's row is set so the subject's
 * baseline meets the list's filter labels, and that baseline was found for
 * 26px on a 32px line. A smaller size on the same line would sit higher, so
 * it takes padding above and a shorter line, ending at the same 32px with
 * its baseline in the same place (measured in the demo; the font's
 * published metrics put it within a pixel).
 * Two lines are taller and say so: the header grows to hold them.
 */
const PAD_ABOVE: Record<number, number> = { 26: 0, 20: 5, 17: 7 };

export function titleBoxStyle(fit: TitleFit): React.CSSProperties {
  if (fit.lines === 2) return { fontSize: 17, lineHeight: "21px" };
  const pad = PAD_ABOVE[fit.size] ?? 0;
  return { fontSize: fit.size, lineHeight: `${32 - pad}px`, paddingTop: pad };
}

/** The fit for `text` in the element's width, kept up to date as it resizes. */
export function useTitleFit(
  ref: React.RefObject<HTMLElement | null>,
  text: string
): TitleFit {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return React.useMemo(
    () => (width > 0 ? fitTitle(text, width) : { size: 26, lines: 1 }),
    [text, width]
  );
}
