"use client";

/**
 * Whether more of the reply is below what the box shows.
 *
 * The reply card is a fixed frame: its border never scrolls, and Send is the
 * row at its foot. Only the letter inside it scrolls (`.mail-composer-scroll`).
 * When the letter runs on below the frame, a soft shadow above Send says so.
 *
 * Until 2026-10-23 the card scrolled inside the band, and Send was a sticky
 * row that drew the card's foot over the letter. At a fractional zoom WebKit
 * drew those borders on half pixels, pale or not at all, as soon as the row
 * began to stick. A border that does not move cannot land on a half pixel.
 *
 * The answer changes no state while a key press is being handled. A
 * listener for `input` here runs before React reads the same event, and a
 * state change at that moment draws the composer again first: a controlled
 * box (To, Cc, the subject) then gets its old text back, and React sees no
 * change, so the letter is lost. So typing is answered a frame later.
 */

import * as React from "react";

export function useComposerMoreBelow(
  scrollerRef: React.RefObject<HTMLElement | null>,
  /** Changes when the box is drawn again: the mode, the preview, focus. */
  key: string
): boolean {
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const report = () =>
      setMore(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    scroller.addEventListener("scroll", report, { passive: true });
    let frame = 0;
    const onInput = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          report();
        });
      }
    };
    scroller.addEventListener("input", onInput);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", report);
      scroller.removeEventListener("input", onInput);
    };
  }, [scrollerRef, key]);
  return more;
}

/** The letter's own floor: about three lines, so there is a place to type. */
const LETTER_FLOOR_PX = 72;

/**
 * The least the card may be: everything in it but the letter, at its own
 * height, and the letter at its floor.
 *
 * The card shrinks to the band so that only the letter scrolls. With no
 * floor, whatever else stood in the band (a tall block of notes above
 * the card) squeezed it to its border, and the letter and Send
 * spilled out below it over the links (2026-10-24). With this floor the
 * card stops shrinking there, and the band scrolls instead, as it did
 * before the card was a frame.
 */
export function useComposerCardFloor(
  cardRef: React.RefObject<HTMLElement | null>,
  letterRef: React.RefObject<HTMLElement | null>,
  key: string
): void {
  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const place = () => {
      const letter = letterRef.current;
      let floor = LETTER_FLOOR_PX;
      for (const child of Array.from(card.children) as HTMLElement[]) {
        if (child === letter) continue;
        const position = getComputedStyle(child).position;
        if (position === "absolute" || position === "fixed") continue;
        floor += child.offsetHeight;
      }
      const style = getComputedStyle(card);
      floor += (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
      card.style.minHeight = `${Math.ceil(floor)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    for (const child of Array.from(card.children)) observer.observe(child);
    // Rows that come and go (the recipients opened, files docked above Send).
    const mutations = new MutationObserver(() => {
      observer.disconnect();
      for (const child of Array.from(card.children)) observer.observe(child);
      place();
    });
    mutations.observe(card, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      card.style.minHeight = "";
    };
  }, [cardRef, letterRef, key]);
}
