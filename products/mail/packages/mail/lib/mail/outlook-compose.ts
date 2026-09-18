"use client";

/**
 * Handing a message to Outlook when Outlook's mailbox is not ours to write to.
 *
 * A university that will not let a third-party client sign in cannot be
 * given a draft over Graph either: there is no token and there will not be
 * one. So the message goes the way any program hands mail to any mail
 * client — a mailto: URL opened in Outlook by name — and the body travels
 * on the pasteboard, because mailto: carries plain text and the whole point
 * of doing this at all is to keep the formatting.
 *
 * One paste is the cost. It is the difference between finishing the mail
 * and retyping it.
 */

import { tauriInvoke } from "@/lib/mail/store/tauri";

/**
 * Recipients and subject on a mailto: URL, the body deliberately left off.
 *
 * Written by hand rather than with URLSearchParams, which encodes a space
 * as `+` — right for a form, wrong for a mailto:, where nothing decodes it
 * again. Outlook took the plus signs literally and put a subject line full
 * of them in front of the reader. Percent-encoding is what a URL means by a
 * space, so that is what this writes.
 */
export function outlookComposeUrl(input: {
  to: string[];
  cc?: string[];
  subject: string;
  /**
   * The message itself, when it can travel in the URL — see `bodyTravels`.
   * Left out otherwise, and the pasteboard carries it instead.
   */
  body?: string;
}): string {
  const fields: string[] = [];
  const addresses = (list: string[]) =>
    list.map((address) => encodeURIComponent(address.trim())).join(",");
  if (input.cc?.length) fields.push(`cc=${addresses(input.cc)}`);
  if (input.subject.trim()) {
    fields.push(`subject=${encodeURIComponent(input.subject.trim())}`);
  }
  if (input.body?.trim()) {
    fields.push(`body=${encodeURIComponent(input.body)}`);
  }
  const query = fields.join("&");
  return `mailto:${addresses(input.to)}${query ? `?${query}` : ""}`;
}

/**
 * The most a message may be before the URL stops being a way to carry it.
 *
 * A mailto: is an argument on a command line and a string every program
 * between here and Outlook may have its own opinion about. Short replies
 * fit and long ones are precisely the ones worth keeping formatted, so the
 * line is drawn low on purpose.
 */
const BODY_TRAVELS_UNDER = 1500;

/** Markup a plain message does not have. */
const RICH_TAGS = /<\s*(b|strong|i|em|u|s|a|ul|ol|li|blockquote|img|table|h[1-6]|pre|code|span)\b/i;

/**
 * Whether the message can go in the URL rather than on the pasteboard.
 *
 * A mailto: body is plain text — that is what the field is, and Outlook
 * inserts it as typed. So the trade is real: put it in the URL and the
 * reader has nothing to paste, but bold, lists and links are gone. A
 * message that has none of those loses nothing, and that is most short
 * replies. Anything richer, or long enough to test what a URL will carry,
 * goes by the pasteboard with its formatting whole.
 */
export function bodyTravels(html: string, text: string): boolean {
  if (!text.trim()) return false;
  if (text.length > BODY_TRAVELS_UNDER) return false;
  return !RICH_TAGS.test(html);
}

/** Whitespace of every kind, flattened, so two spellings of a gap match. */
function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The message without the sign-off at the end of it.
 *
 * A message handed to Outlook is finished in Outlook, and Outlook puts its
 * own signature on what it opens. Ours went over with the words, so the
 * mail carried two — a sign-off, then the same sign-off in Outlook's face
 * and size under it.
 *
 * Only at the end, and only when it matches. A signature quoted in the
 * middle of a message is part of what is being said, and a body that ends
 * in something else is left exactly as it is.
 */
export function withoutTrailingSignature(
  body: { html: string; text: string },
  signatureText: string
): { html: string; text: string } {
  const wanted = flatten(signatureText);
  if (!wanted) return body;

  /**
   * The same string flattened, and where each flattened character came from.
   *
   * The map is what makes the cut exact: the signature is found in the
   * flattened text, and the map says where that begins in the real one, so
   * the words are cut at the right place whatever the whitespace was.
   */
  const flattenWithMap = (value: string) => {
    let flat = "";
    const from: number[] = [];
    let space = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i]!;
      if (/\s/.test(ch)) {
        space = true;
        continue;
      }
      if (space && flat) {
        flat += " ";
        from.push(i);
      }
      space = false;
      flat += ch;
      from.push(i);
    }
    return { flat, from };
  };

  const { flat, from } = flattenWithMap(body.text);
  if (!flat.endsWith(wanted)) return body;
  const cutAt = from[flat.length - wanted.length];
  const text = body.text.slice(0, cutAt ?? 0).replace(/\s+$/, "");

  /*
    The HTML is cut by whole nodes, through the DOM.

    A string search would cut through a tag; taking nodes off the end
    leaves the markup around the message whole.

    Matched with every space taken out, not merely flattened: the text of
    a run of paragraphs has no gaps between them at all, while the same
    words as plain text have newlines. Comparing what is left of the
    signature against each node, with the whitespace gone from both, is
    the one reading the two spellings agree on.

    A node holding more than the signature ends it: a sign-off typed into
    the same paragraph as the last line of the message stays where it is,
    and the words on the pasteboard are right either way.

    Without a document (a test, a server) the HTML is left as it is.
  */
  if (typeof document === "undefined") return { html: body.html, text };
  const squash = (value: string) => value.replace(/\s+/g, "");
  const box = document.createElement("div");
  box.innerHTML = body.html;
  let need = squash(signatureText);
  while (box.lastChild && need) {
    const node = squash(box.lastChild.textContent ?? "");
    if (!node) {
      // Nothing but space: it belongs to whichever side is removed.
      box.removeChild(box.lastChild);
      continue;
    }
    if (!need.endsWith(node)) break;
    need = need.slice(0, need.length - node.length);
    box.removeChild(box.lastChild);
  }
  return { html: box.innerHTML.replace(/(\s|<br\s*\/?>)+$/i, ""), text };
}

/**
 * Put the message on the pasteboard as HTML and as words.
 *
 * Both flavours: Outlook takes the HTML, and anything else that reads the
 * pasteboard gets something sensible rather than markup.
 */
export async function copyMessageToClipboard(input: {
  html: string;
  text: string;
}): Promise<void> {
  const clipboard = navigator.clipboard as Clipboard & {
    write?: (items: ClipboardItem[]) => Promise<void>;
  };
  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([input.html], { type: "text/html" }),
          "text/plain": new Blob([input.text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Falls through to the words, which is worse than the formatting and
      // better than an empty pasteboard.
    }
  }
  await navigator.clipboard.writeText(input.text);
}

/**
 * The files, put where they can be dragged into the message.
 *
 * A mailto: has no attachments — the field does not exist, and no amount of
 * care with the URL will make one. The pasteboard cannot help either: it
 * carries the message, and a pasteboard holding files instead would paste
 * the files and lose the words.
 *
 * So the files are written to the downloads folder and the file manager is
 * pointed at them. One drag into the Outlook window, which is the same
 * gesture as the paste the body already needs.
 *
 * Only in the desktop app. A browser cannot write to disk, and the caller
 * says so instead. Returns how many were written.
 */
export async function saveAttachmentsForHandover(
  attachments: { filename: string; contentBase64: string }[]
): Promise<number> {
  return (await saveHandoverFiles(attachments)).length;
}

/** The same, answering where each file went. Only the ones that wrote. */
export async function saveHandoverFiles(
  attachments: { filename: string; contentBase64: string }[]
): Promise<string[]> {
  if (!attachments.length) return [];
  const invoke = tauriInvoke();
  if (!invoke) return [];
  const paths: string[] = [];
  for (const attachment of attachments) {
    try {
      const path = await invoke("save_attachment", {
        filename: attachment.filename,
        contentBase64: attachment.contentBase64,
        // Shown, not opened: the point is to find them, not to read them.
        open: false,
      });
      if (typeof path === "string" && path) paths.push(path);
    } catch {
      // One that will not write is not one to promise. The list says so.
    }
  }
  return paths;
}

/**
 * Put the Outlook message in front on the left, and the Finder window
 * with the file on the right, so the drag is one gesture. Best effort:
 * the hand-over is done by the time this runs, and a window that will not
 * move is not worth an error. Desktop app on macOS only.
 */
export async function arrangeOutlookHandover(input: {
  subject: string;
  path: string;
}): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  try {
    await invoke("arrange_outlook_handover", {
      subject: input.subject,
      path: input.path,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Cc that keeps a copy of this on the side it was written from.
 *
 * A message handed to Outlook is sent from Outlook, so its record of
 * having been sent lives there — in a mailbox this app cannot read. Copying
 * the account it was written from is what puts it back in the reader's own
 * mail, in the conversation it belongs to, without anybody having to
 * forward it to themselves afterwards.
 *
 * Not when the address is already on the message, and not when it is the
 * mailbox the message is being sent from: nobody needs a copy from
 * themselves to themselves.
 */
export function ccBackToSelf(input: {
  from: string;
  to: string[];
  cc: string[];
  /** The Outlook mailbox this is going to, when it is going to one. */
  target?: string;
}): string[] {
  const self = input.from.trim().toLowerCase();
  if (!self) return input.cc;
  if (self === input.target?.trim().toLowerCase()) return input.cc;
  const already = [...input.to, ...input.cc].some(
    (address) => address.trim().toLowerCase() === self
  );
  return already ? input.cc : [...input.cc, input.from];
}

/** Open a new Outlook message on these recipients. Desktop app only. */
export async function openOutlookCompose(mailto: string): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Opening Outlook needs the desktop app");
  await invoke("open_outlook_compose", { mailto });
}
