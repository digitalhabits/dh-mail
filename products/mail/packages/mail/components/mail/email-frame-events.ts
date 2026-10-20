/**
 * What the page does with each message from a message frame.
 *
 * The frame's script (`lib/mail/link-bridge`) hears the reader inside the
 * frame and sends each event out. This file turns those messages back into
 * what the page expects: a key on the window, a pinch event, a menu at a
 * point in page pixels. EmailHtmlView.tsx calls these.
 *
 * Each message comes from the frame of a mail, so the sender wrote the
 * document it came from. Every field is checked before it is used.
 */

import { MAIL_PINCH_SCALE_EVENT, MAIL_PINCH_WHEEL_EVENT } from "@/lib/mail/pinch";
import { mailLinkMenuModel, type MailLinkMenuModel } from "@/lib/mail/link-menu";
import { repairSafeLink } from "@/lib/safe-links";
import {
  frameNumber,
  framePointToPage,
  frameString,
  isOpenableMailUrl,
  type FrameMessage,
} from "@/lib/mail/frame-messages";

/** The size the frame measured — see `frame-script/size.ts`. */
export type FrameMetrics = {
  height: number;
  natural: number;
  narrowest: number;
  /** The zoom on the frame's body when it measured. */
  zoom: number;
};

export function readFrameMetrics(data: FrameMessage): FrameMetrics {
  const zoom = frameNumber(data.zoom, 1);
  return {
    height: Math.max(0, frameNumber(data.height)),
    natural: Math.max(0, frameNumber(data.natural)),
    narrowest: Math.max(0, frameNumber(data.narrowest)),
    zoom: zoom > 0 ? zoom : 1,
  };
}

/**
 * A key pressed in the frame, sent again on the page's window, where the
 * shortcuts listen.
 *
 * Only when the frame has the focus. The reader's keys reach the frame only
 * then, so a key message at another time did not come from the reader.
 */
export function forwardFrameKey(frame: HTMLIFrameElement, data: FrameMessage): void {
  if (document.activeElement !== frame) return;
  const key = frameString(data.key);
  if (!key) return;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: frameString(data.code),
      metaKey: data.metaKey === true,
      ctrlKey: data.ctrlKey === true,
      altKey: data.altKey === true,
      shiftKey: data.shiftKey === true,
      repeat: data.repeat === true,
      cancelable: true,
    })
  );
}

/**
 * A pinch in the frame, sent again as the window event that the zoom reads.
 *
 * The frame sends the pointer as a share of its own height. The frame is
 * sized to its content, so that share of the frame element is the same
 * point in the page, whatever the zooms.
 */
export function forwardFramePinch(frame: HTMLIFrameElement, data: FrameMessage): void {
  const value = frameNumber(data.value, Number.NaN);
  if (!Number.isFinite(value)) return;
  const share = typeof data.at === "number" && Number.isFinite(data.at) ? data.at : null;
  const box = frame.getBoundingClientRect();
  const y = share != null && box.height > 0 ? box.top + share * box.height : null;
  const name = data.type === "pinch-wheel" ? MAIL_PINCH_WHEEL_EVENT : MAIL_PINCH_SCALE_EVENT;
  window.dispatchEvent(new CustomEvent(name, { detail: { value, y } }));
}

function pointOf(data: FrameMessage) {
  return {
    x: frameNumber(data.x),
    y: frameNumber(data.y),
    width: frameNumber(data.width),
    height: frameNumber(data.height),
  };
}

/** A right-click on a link or a picture, as the link menu needs it. */
export function frameLinkMenu(
  frame: HTMLIFrameElement,
  data: FrameMessage
): { model: MailLinkMenuModel | null; image?: string; x: number; y: number } | null {
  const url = frameString(data.url);
  // A Microsoft safe link shows the address it wraps (link-menu.ts).
  const model = url && isOpenableMailUrl(url) ? mailLinkMenuModel(repairSafeLink(url)) : null;
  const image = frameString(data.image) || undefined;
  if (!model && !image) return null;
  return { model, image, ...framePointToPage(frame, pointOf(data)) };
}

/** A right-click on the message itself: where, and the selected text. */
export function frameMessageMenu(
  frame: HTMLIFrameElement,
  data: FrameMessage
): { x: number; y: number; selectedText: string } {
  return { ...framePointToPage(frame, pointOf(data)), selectedText: frameString(data.selectedText) };
}
