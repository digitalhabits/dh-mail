/*
 * A message's files on Outlook: what they are, their bytes, the pictures
 * in the body (cid: references) resolved to data, and the raw source.
 */

import "server-only";
import { base64ToBytes } from "@/lib/base64";
import { graphFetch } from "@/lib/outlook/graph";
import { type GraphAttachment } from "@/lib/outlook/api";

/**
 * What a message carries, without the bytes.
 *
 * `contentId` is deliberately not asked for, however much the inline pictures
 * want it. Graph types this collection as `attachment`, and `contentId`
 * belongs to `fileAttachment` underneath it, so naming it in a `$select` is
 * answered with 400 — "Could not find a property named 'contentId' on type
 * 'microsoft.graph.attachment'". Both readers of this caught that and carried
 * on with nothing, so an Outlook mail with a file showed no file and one with
 * a picture in the body showed a gap. Asking for no `$select` at all works and
 * returns `contentBytes` with every attachment, which is a megabyte a message
 * for the privilege. `resolveOutlookInlineImages` reads the content id off the
 * one request that has to fetch the bytes anyway.
 */
const ATTACHMENT_META_SELECT = "id,name,contentType,size,isInline";

export async function listOutlookAttachmentMeta(
  accessToken: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const data = await graphFetch<{ value?: GraphAttachment[] }>(
    accessToken,
    `/me/messages/${messageId}/attachments?$select=${ATTACHMENT_META_SELECT}`
  );
  return data.value ?? [];
}

export async function listOutlookFileAttachments(
  accessToken: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const all = await listOutlookAttachmentMeta(accessToken, messageId);
  // Inline parts are the pictures inside the body, not files to list beside
  // it. `resolveOutlookInlineImages` is what puts those back in the body.
  return all.filter((a) => !a.isInline);
}

/** The query these two send, so a suite can hold it to what Graph accepts. */
export const OUTLOOK_ATTACHMENT_META_QUERY = `$select=${ATTACHMENT_META_SELECT}`;

/** Per image, and per message. The same limits the Gmail side applies. */
const MAX_INLINE_IMAGE_BYTES = 1_500_000;
const MAX_INLINE_TOTAL_BYTES = 5_000_000;

/** A content id without the angle brackets Graph sometimes keeps. */
export function contentIdOf(attachment: GraphAttachment): string | null {
  const cid = attachment.contentId?.trim().replace(/^<|>$/g, "");
  return cid ? cid : null;
}

/**
 * Every content id a body asks for, read out of its `src` attributes.
 *
 * Looking for the whole `cid:something` as a substring is not the same thing,
 * and got both ends wrong. `cid:abc` is a substring of `cid:abc123`, so a
 * picture could be matched to the wrong part; and the scheme is written in
 * whatever case the sending client felt like, while a plain `includes` only
 * ever accepted lower case.
 */
export function referencedContentIds(bodyHtml: string): Set<string> {
  const out = new Set<string>();
  // `originalsrc` as well as `src`: Outlook moves the content id there when it
  // puts its own blob URL in `src`, so a body that has plainly got a picture
  // in it can have no `src="cid:…"` anywhere.
  const pattern =
    /\b(?:original)?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  for (const match of bodyHtml.matchAll(pattern)) {
    const src = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const cid = /^cid:(.+)$/i.exec(src)?.[1];
    if (cid) out.add(cid.replace(/^<|>$/g, ""));
  }
  return out;
}

/** True when a body has a picture in it that has to be fetched separately. */
export function bodyHasInlineImage(bodyHtml: string | undefined): boolean {
  if (!bodyHtml) return false;
  return referencedContentIds(bodyHtml).size > 0;
}

/**
 * The inline pictures a body actually asks for.
 *
 * An inline part nothing references is a file rather than a picture, and the
 * attachment list already carries it — fetching it here would download it
 * twice and show it in two places.
 */
export function inlineImagesReferencedBy(
  attachments: GraphAttachment[],
  bodyHtml: string
): GraphAttachment[] {
  const wanted = referencedContentIds(bodyHtml);
  // Content ids are case-sensitive in the standard and not always in practice.
  const lower = new Set([...wanted].map((c) => c.toLowerCase()));
  return attachments.filter((attachment) => {
    if (!attachment.isInline) return false;
    if (!attachment.contentType?.startsWith("image/")) return false;
    const cid = contentIdOf(attachment);
    if (!cid) return false;
    return wanted.has(cid) || lower.has(cid.toLowerCase());
  });
}

/**
 * The pictures embedded in an Outlook message body, as data URLs by their
 * content id.
 *
 * A body writes `<img src="cid:something">` and the bytes arrive as a separate
 * inline attachment. Without this the reader sanitizes the body, finds no
 * picture behind the cid, and drops the img — which is a message with a hole
 * in it. A forwarded phone photo is the common case.
 *
 * Resolving these is privacy-safe, unlike remote images: the bytes are already
 * in the message, and fetching them tells nobody anything.
 */
export async function resolveOutlookInlineImages(
  accessToken: string,
  messageId: string,
  bodyHtml: string,
  /** Already listed by the caller, so one message needs one listing. */
  knownMeta?: GraphAttachment[]
): Promise<Record<string, string>> {
  const all = knownMeta ?? (await listOutlookAttachmentMeta(accessToken, messageId));

  /**
   * Every inline picture small enough to carry, before we know which the body
   * asks for. The content id says that, and it only arrives with the bytes —
   * so a picture the body never mentions is fetched and then dropped. The
   * per-picture ceiling is what keeps that from mattering; an inline part
   * nothing references is rare, and a wasted request is better than the hole
   * the reader used to see.
   */
  const candidates = all.filter(
    (a) =>
      a.isInline &&
      a.contentType?.startsWith("image/") &&
      (a.size ?? 0) <= MAX_INLINE_IMAGE_BYTES
  );

  const fetched = await Promise.all(
    candidates.map(async (attachment) => {
      try {
        const full = await graphFetch<{
          contentBytes?: string;
          contentId?: string;
        }>(accessToken, `/me/messages/${messageId}/attachments/${attachment.id}`);
        if (!full.contentBytes) return null;
        return {
          ...attachment,
          contentId: full.contentId,
          contentBytes: full.contentBytes,
        };
      } catch {
        // A missing attachment just leaves that one picture out.
        return null;
      }
    })
  );

  const wanted = inlineImagesReferencedBy(
    fetched.filter((a): a is NonNullable<typeof a> => a !== null),
    bodyHtml
  );

  const out: Record<string, string> = {};
  let total = 0;
  for (const attachment of wanted) {
    const base64 = (attachment as { contentBytes?: string }).contentBytes;
    const cid = contentIdOf(attachment);
    if (!base64 || !cid) continue;
    if (total + base64.length > MAX_INLINE_TOTAL_BYTES) continue;
    total += base64.length;
    out[cid] = `data:${attachment.contentType};base64,${base64}`;
  }
  return out;
}

export async function getOutlookAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const data = await graphFetch<{ contentBytes?: string }>(
    accessToken,
    `/me/messages/${messageId}/attachments/${attachmentId}`
  );
  if (!data.contentBytes) throw new Error("Attachment had no content");
  return base64ToBytes(data.contentBytes);
}

/**
 * The message as MIME text: Graph's `$value`. It is not JSON, so graphFetch
 * hands it over under `raw`.
 */
export async function getOutlookMessageSource(
  accessToken: string,
  messageId: string
): Promise<string> {
  const data = await graphFetch<{ raw?: string } | string | undefined>(
    accessToken,
    `/me/messages/${messageId}/$value`,
    { headers: { Accept: "text/plain, */*" } }
  );
  const text = typeof data === "string" ? data : data?.raw;
  if (!text) throw new Error("Outlook sent the message without its source");
  return text;
}
