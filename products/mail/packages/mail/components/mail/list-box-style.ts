/*
 * Where the mail list's box stands, and at what size, while it rests and
 * while it slides.
 *
 * Two boxes: the outer one holds the list's place in the pane and is what
 * slides; the inner one keeps the list at its own size, pinned to the
 * reader's edge, so the rows never re-wrap while the outer one moves. See
 * the notes in ListPaneFrame (mail-pane-frames.tsx), which draws them.
 *
 * Pure: the geometry in, a style out.
 */

import type * as React from "react";

import {
  PANE_SLIDE_MS as LIST_SLIDE_MS,
  PANE_SLIDE_EASE as LIST_SLIDE_EASE,
} from "@/lib/mail/pane-slide";

export type ListBoxGeometry = {
  listExpandSliding: boolean;
  listSlideOverlay: boolean;
  listExpanded: boolean;
  listOpen: boolean;
  listVertical: boolean;
  listFirst: boolean;
  expandClip: string;
  listSlideTransform: string | undefined;
  railInset: number;
  listHeight: number;
  shownListWidth: number;
};

/**
 * The outer box: over the whole pane, clipped, during the expand sweep;
 * out of the flow and moved by transform during a slide; otherwise its
 * place in the flow, at nothing when the list is shut.
 */
export function listBoxStyle(g: ListBoxGeometry): React.CSSProperties | undefined {
  const {
    listExpandSliding,
    listSlideOverlay,
    listExpanded,
    listOpen,
    listVertical,
    listFirst,
    expandClip,
    listSlideTransform,
    railInset,
    listHeight,
    shownListWidth,
  } = g;
  return listExpandSliding
    ? {
        position: "absolute",
        inset: 0,
        zIndex: 10,
        clipPath: expandClip,
        willChange: "clip-path",
        transitionDuration: `${LIST_SLIDE_MS}ms`,
        transitionTimingFunction: LIST_SLIDE_EASE,
      }
    : listSlideOverlay
    ? {
        position: "absolute",
        zIndex: 10,
        transform: listSlideTransform,
        willChange: "transform",
        transitionDuration: `${LIST_SLIDE_MS}ms`,
        transitionTimingFunction: LIST_SLIDE_EASE,
        // Its resting place, measured from the pane row: clear of
        // the rail on the side the rail holds, so the two travel
        // as neighbours rather than one over the other.
        ...(listVertical
          ? {
              left: railInset,
              right: 0,
              height: listHeight,
              ...(listFirst ? { top: 0 } : { bottom: 0 }),
            }
          : {
              top: 0,
              bottom: 0,
              width: shownListWidth,
              ...(listFirst
                ? { left: railInset }
                : { right: railInset }),
            }),
      }
    : listExpanded && listOpen
      ? undefined
      : listVertical
        ? { height: listOpen ? listHeight : 0 }
        : { width: listOpen ? shownListWidth : 0 };
}

/** The inner box: the list at its own size, against the reader's edge. */
export function listInnerStyle(g: ListBoxGeometry): React.CSSProperties {
  const { listExpandSliding, listExpanded, listOpen, listVertical, listFirst, listHeight, shownListWidth } = g;
  return listExpandSliding || (listExpanded && listOpen)
    ? { position: "absolute", inset: 0 }
    : listVertical
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          height: listHeight,
          ...(listFirst ? { bottom: 0 } : { top: 0 }),
        }
      : {
          position: "absolute",
          top: 0,
          bottom: 0,
          width: shownListWidth,
          ...(listFirst ? { right: 0 } : { left: 0 }),
        };
}
