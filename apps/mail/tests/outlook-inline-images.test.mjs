/**
 * Pictures embedded in an Outlook message body.
 *
 * A body writes `<img src="cid:something">` and the bytes come as a separate
 * inline attachment. The reader drops a cid: image it cannot resolve, so
 * picking the wrong attachments here does not show a broken image — it shows
 * a hole where the picture was, with nothing to say why. That is what a
 * forwarded phone photo looked like before this existed.
 */

import {
  bodyHasInlineImage,
  contentIdOf,
  inlineImagesReferencedBy,
  OUTLOOK_ATTACHMENT_META_QUERY,
  referencedContentIds,
} from "@/lib/outlook/attachments";

import { check, suite } from "./harness.mjs";

function attachment(overrides = {}) {
  return {
    id: "a1",
    name: "image001.jpg",
    contentType: "image/jpeg",
    size: 40_000,
    isInline: true,
    contentId: "abc123",
    ...overrides,
  };
}

const BODY = '<div>Hi<img src="cid:abc123"></div>';

suite(async () => {
  // --- Content ids -------------------------------------------------------

  check(
    "a bare content id is taken as it is",
    contentIdOf(attachment({ contentId: "abc123" })) === "abc123"
  );
  // Graph hands these back both ways, and the body only ever writes the bare
  // form, so the brackets have to come off before anything is compared.
  check(
    "angle brackets come off",
    contentIdOf(attachment({ contentId: "<abc123>" })) === "abc123",
    String(contentIdOf(attachment({ contentId: "<abc123>" })))
  );
  check(
    "surrounding space comes off",
    contentIdOf(attachment({ contentId: "  abc123  " })) === "abc123"
  );
  check(
    "no content id at all is null, not an empty string",
    contentIdOf(attachment({ contentId: undefined })) === null
  );
  check(
    "an empty content id is null",
    contentIdOf(attachment({ contentId: "" })) === null
  );

  // --- Which attachments the body wants ----------------------------------

  check(
    "an inline image the body references is wanted",
    inlineImagesReferencedBy([attachment()], BODY).length === 1
  );
  check(
    "the bracketed form matches the bare cid in the body",
    inlineImagesReferencedBy([attachment({ contentId: "<abc123>" })], BODY)
      .length === 1
  );
  check(
    "an inline image the body never mentions is left alone",
    inlineImagesReferencedBy([attachment({ contentId: "other" })], BODY)
      .length === 0
  );
  // Otherwise it downloads twice and appears both in the body and as a chip.
  check(
    "a real attachment is not treated as an inline picture",
    inlineImagesReferencedBy([attachment({ isInline: false })], BODY).length === 0
  );
  check(
    "an inline non-image is left to the attachment list",
    inlineImagesReferencedBy(
      [attachment({ contentType: "application/pdf" })],
      BODY
    ).length === 0
  );
  check(
    "an attachment with no content type is not guessed at",
    inlineImagesReferencedBy([attachment({ contentType: undefined })], BODY)
      .length === 0
  );

  // --- A forwarded message with several pictures --------------------------

  const many = [
    attachment({ id: "a", contentId: "one" }),
    attachment({ id: "b", contentId: "<two>" }),
    attachment({ id: "c", contentId: "unused" }),
    attachment({ id: "d", isInline: false, contentId: "four" }),
  ];
  const body = '<img src="cid:one"><p>x</p><img src="cid:two">';
  const wanted = inlineImagesReferencedBy(many, body).map((a) => a.id);
  check(
    "only the referenced inline images are fetched",
    wanted.join(",") === "a,b",
    wanted.join(",")
  );

  check(
    "a body with no cid at all wants nothing",
    inlineImagesReferencedBy(many, "<p>no pictures here</p>").length === 0
  );

  // --- What we may ask Graph for -----------------------------------------
  //
  // The attachments collection is typed as `attachment`, and `contentId`
  // belongs to `fileAttachment` under it. Naming it in a `$select` is
  // answered with 400, both callers caught that and carried on with nothing,
  // and so an Outlook mail with a file showed no file and one with a picture
  // in the body showed a gap. Nothing about that said anything was wrong,
  // which is why the query is checked here rather than left to be noticed.

  check(
    "the content id is not asked for by name",
    !OUTLOOK_ATTACHMENT_META_QUERY.includes("contentId"),
    OUTLOOK_ATTACHMENT_META_QUERY
  );
  check(
    "the bytes are not asked for either — that is a megabyte a message",
    !OUTLOOK_ATTACHMENT_META_QUERY.includes("contentBytes")
  );
  // Everything named has to be on the base type, or Graph refuses the lot.
  const BASE_ATTACHMENT_FIELDS = [
    "id",
    "lastModifiedDateTime",
    "name",
    "contentType",
    "size",
    "isInline",
  ];
  const asked = OUTLOOK_ATTACHMENT_META_QUERY.replace("$select=", "").split(",");
  const strays = asked.filter((f) => !BASE_ATTACHMENT_FIELDS.includes(f));
  check(
    "every field asked for is on the attachment type itself",
    strays.length === 0,
    strays.join(",")
  );
  // The two the callers cannot do without: one tells a file from a picture in
  // the body, the other keeps a huge picture out of the reader's memory.
  check(
    "the fields both callers need are there",
    asked.includes("isInline") && asked.includes("size") && asked.includes("id")
  );

  // --- Which messages are even looked at ----------------------------------
  //
  // `hasAttachments` is false when a message carries nothing but inline
  // parts. That is Graph working as designed, and Microsoft's own advice is
  // to read the body for a cid: source instead. Gating the search on
  // `hasAttachments` meant a picture dropped into a message and sent to
  // Outlook was never looked for, and the mail arrived empty. A picture
  // attached the ordinary way was fine, which made it look like a rendering
  // fault rather than a message we never asked about.

  check(
    "a body with a cid is looked at, whatever Graph says it has",
    bodyHasInlineImage('<div><img src="cid:abc123"></div>') === true
  );
  check(
    "a body with no cid is left alone",
    bodyHasInlineImage("<p>just words</p>") === false
  );
  check(
    "no body at all is not looked at",
    bodyHasInlineImage(undefined) === false && bodyHasInlineImage("") === false
  );

  // --- How Outlook writes the reference -----------------------------------
  //
  // Real markup off outlook.live.com. The content id is in `originalsrc`;
  // `src` is a blob URL that means nothing outside their own web client. A
  // body like this plainly has a picture in it and has no `src="cid:…"`
  // anywhere, so reading `src` alone finds nothing to fetch.

  const OUTLOOK_BODY =
    '<div dir="ltr"><img data-imagetype="AttachmentByCid" ' +
    'originalsrc="cid:ii_mspz4gaw0" ' +
    'src="blob:https://outlook.live.com/6c931e53-e607-4ce9" ' +
    'alt="deep-work-logo (1).png" width="542"><br></div>';

  check(
    "the content id is found in originalsrc",
    bodyHasInlineImage(OUTLOOK_BODY) === true
  );
  check(
    "and it is the id, not the blob",
    [...referencedContentIds(OUTLOOK_BODY)].join(",") === "ii_mspz4gaw0",
    [...referencedContentIds(OUTLOOK_BODY)].join(",")
  );
  check(
    "the blob url on its own is not a picture to fetch",
    bodyHasInlineImage('<img src="blob:https://outlook.live.com/abc">') === false
  );

  // --- Reading the reference, rather than searching for it ----------------
  //
  // `bodyHtml.includes("cid:" + id)` was both too eager and too strict.

  check(
    "one content id is not matched by another that starts the same way",
    inlineImagesReferencedBy(
      [attachment({ contentId: "abc" })],
      '<img src="cid:abc123">'
    ).length === 0
  );
  check(
    "the scheme is matched whatever case it is written in",
    bodyHasInlineImage('<img src="CID:abc123">') === true &&
      inlineImagesReferencedBy([attachment()], '<img SRC="CID:abc123">')
        .length === 1
  );
  check(
    "an unquoted attribute is still read",
    [...referencedContentIds("<img src=cid:abc123>")].join(",") === "abc123"
  );
  check(
    "a cid written in the text but not in a src is not a picture",
    bodyHasInlineImage("<p>the cid:abc123 part is the id</p>") === false
  );
});
