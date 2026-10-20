/**
 * The page side of the message frame's postMessage bridge.
 *
 * The frame has an opaque origin (no `allow-same-origin`), so the page can
 * only talk to it. The script inside is `MAIL_LINK_BRIDGE_JS`; the list of
 * messages is in `link-bridge.ts`.
 *
 * Two rules keep this safe:
 *
 * - The page reads a message only if `event.source` is the frame's own
 *   window. `readFrameMessage` makes that check.
 * - The page treats each message as input from the sender of the mail. A
 *   number is checked to be a number, a string to be a string, and a URL to
 *   be http(s) or mailto before it is used.
 */

import { MAIL_FRAME_MSG_SOURCE } from "@/lib/mail/link-bridge";

/** Window event for a press or a scroll inside any message frame. */
export const MAIL_FRAME_PRESS_EVENT = "mail-frame-press";

/** Marks an iframe that holds a message, so find-in-thread can ask it. */
export const MAIL_FRAME_ATTR = "data-dh-mail-frame";

export type FrameMessage = { type: string } & Record<string, unknown>;

/**
 * The data of a message from `frame`, or null.
 *
 * Null when the message came from another window, or does not carry the
 * bridge's source and a type.
 */
export function readFrameMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null | undefined
): FrameMessage | null {
  const view = frame?.contentWindow;
  if (!view || event.source !== view) return null;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  if (data.source !== MAIL_FRAME_MSG_SOURCE) return null;
  if (typeof data.type !== "string") return null;
  return data as FrameMessage;
}

/** Send a message to the frame. */
export function postToFrame(
  frame: HTMLIFrameElement | null | undefined,
  message: FrameMessage
): void {
  const view = frame?.contentWindow;
  if (!view) return;
  try {
    // "*": an opaque origin cannot be named. The frame checks that the
    // message came from its parent.
    view.postMessage({ ...message, source: MAIL_FRAME_MSG_SOURCE }, "*");
  } catch {
    /* the frame is gone */
  }
}

/** A finite number from a message, or the fallback. */
export function frameNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A string from a message, or "". */
export function frameString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True for the only kinds of address the page opens from a message. */
export function isOpenableMailUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

/**
 * A point in the frame, in the page's own pixels.
 *
 * The frame sends its point with its own viewport size. The frame's rect is
 * the same box in page pixels, so the ratio is the scale, whatever zooms are
 * set above it.
 */
export function framePointToPage(
  frame: HTMLIFrameElement,
  point: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  const box = frame.getBoundingClientRect();
  const scaleX = point.width > 0 ? box.width / point.width : 1;
  const scaleY = point.height > 0 ? box.height / point.height : 1;
  return { x: box.left + point.x * scaleX, y: box.top + point.y * scaleY };
}

/**
 * The page's origin as a CSP source, or nothing if it is not one.
 *
 * Only a plain scheme://host[:port] goes into the policy. Anything else
 * could add a second directive.
 */
export function frameImageOrigin(origin: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : "";
}

let nextRequestId = 1;

/**
 * Ask a frame a question and wait for its answer.
 *
 * The answer is the first message of `replyType` from that frame with the
 * same id. Null when no answer comes in `timeoutMs`.
 */
export function askFrame(
  frame: HTMLIFrameElement,
  message: FrameMessage,
  replyType: string,
  timeoutMs = 500
): Promise<FrameMessage | null> {
  const id = nextRequestId++;
  return new Promise((resolve) => {
    const done = (answer: FrameMessage | null) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(answer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = readFrameMessage(event, frame);
      if (data && data.type === replyType && data.id === id) done(data);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMessage);
    postToFrame(frame, { ...message, id });
  });
}
