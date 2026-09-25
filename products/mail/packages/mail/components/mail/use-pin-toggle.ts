"use client";

/*
 * Pinning a conversation to the top of the list, off MailPage, and the
 * glide that carries the rows from their old places to their new ones.
 *
 * Owns: the pin toggle and its toast, and the before-and-after of the row
 * positions (a FLIP): the positions are read as the pin is pressed, and
 * the rows are moved from there once the list has been drawn again.
 * `capturePinFlip` is also for a row dragged out of the pinned band, which
 * the page draws.
 *
 * One layout effect, which runs when the pins change. The page calls this
 * hook where it stood. The glide needs a real layout, so no walk sees it;
 * mounted-list-actions checks the pin itself.
 */

import * as React from "react";

import {
  playThreadRowFlip,
  readThreadRowRects,
} from "@/components/mail/thread-row-flip";
import { toast } from "@/lib/mail/toast";
import type { useMailT } from "@/lib/mail/i18n";
import { toggleMailPin } from "@/lib/mail/pins";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

export function usePinToggle({
  pins,
  listScrollRef,
  t,
}: {
  /** The pins as the list reads them; a change starts the glide. */
  pins: unknown[];
  listScrollRef: React.RefObject<HTMLDivElement | null>;
  t: ReturnType<typeof useMailT>;
}) {
  const pinFlipFromRef = React.useRef<Map<string, DOMRect> | null>(null);
  const pinFlipFocusRef = React.useRef<string | null>(null);

  const capturePinFlip = React.useCallback((focusKey: string) => {
    pinFlipFromRef.current = readThreadRowRects(listScrollRef.current);
    pinFlipFocusRef.current = focusKey;
  }, [listScrollRef]);

  const togglePin = React.useCallback(
    (summary: MailThreadSummary) => {
      capturePinFlip(threadKey(summary));
      const nowPinned = toggleMailPin(summary);
      toast(nowPinned ? t("pinned") : t("unpinned"));
    },
    [capturePinFlip, t]
  );

  // After pin/unpin reflow, glide rows from their old spots (FLIP).
  React.useLayoutEffect(() => {
    const from = pinFlipFromRef.current;
    if (!from) return;
    const focus = pinFlipFocusRef.current;
    pinFlipFromRef.current = null;
    pinFlipFocusRef.current = null;
    playThreadRowFlip(listScrollRef.current, from, focus);
  }, [pins, listScrollRef]);

  return { togglePin, capturePinFlip };
}
