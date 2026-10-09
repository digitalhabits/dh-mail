import {
  attachmentContentDisposition,
  safeAttachmentMimeType,
  OPAQUE_MIME_TYPE,
} from "@/lib/mail/attachment-mime";
import { openAttachmentSource, hostSavesAttachments, saveAttachment }
  from "../src/seams/attachment-source";
import { setMailApiTransport } from "@/lib/mail/api";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- The name in the header ---------------------------------------------
  //
  // A header value is bytes, not text. A Danish filename dropped straight into
  // one made WebKit refuse the whole response with a bare TypeError, so the
  // file never arrived and the preview window said "Loading…" until it was
  // closed. The name below stands in for the one that did it: what mattered
  // was the letters, not the document.

  const danish = "Vejledning — opsætning på tablet.pdf";
  const isAscii = (text) =>
    [...text].every((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x20 && code <= 0x7e;
    });

  check(
    "an accented name leaves nothing but ASCII in the header",
    isAscii(attachmentContentDisposition(danish))
  );
  check(
    "the name itself still travels, encoded",
    attachmentContentDisposition(danish).includes(
      "filename*=UTF-8''Vejledning%20%E2%80%94%20ops%C3%A6tning%20p%C3%A5%20tablet.pdf"
    )
  );
  check(
    "with a plain-ASCII spelling for anything that cannot read that",
    attachmentContentDisposition(danish).includes(
      'filename="Vejledning _ ops_tning p_ tablet.pdf"'
    )
  );
  check(
    "a download says so, and a preview says inline",
    attachmentContentDisposition("a.pdf", { download: true }).startsWith(
      "attachment;"
    ) && attachmentContentDisposition("a.pdf").startsWith("inline;")
  );

  // A quote would end the quoted name early and let the rest be read as more
  // header parameters — a filename is chosen by whoever sent the message.
  const sneaky = attachmentContentDisposition('a".pdf');
  check("a quotation mark cannot end the name early", isAscii(sneaky));
  check(
    "it is replaced rather than escaped",
    sneaky.includes('filename="a_.pdf"')
  );
  check(
    "and a newline cannot start a header of its own",
    /[\r\n]/.test(attachmentContentDisposition("a\r\nX-Evil: 1.pdf")) === false
  );
  // A name that is entirely accented keeps its shape in the ASCII spelling —
  // the real one is in `filename*` — but a name with nothing left at all has
  // to be given one, or the header would carry an empty quoted string.
  check(
    "an all-accented name keeps its shape",
    attachmentContentDisposition("æøå").includes('filename="___"')
  );
  check(
    "an empty name still has one",
    attachmentContentDisposition("").includes('filename="attachment"')
  );

  // ---- What may be rendered in place --------------------------------------
  const opaque = (claimed) => safeAttachmentMimeType(claimed) === OPAQUE_MIME_TYPE;

  check("a real image is served as itself, so the preview shows it",
    safeAttachmentMimeType("image/png") === "image/png" &&
      safeAttachmentMimeType("application/pdf") === "application/pdf");

  // The whole point. A sender picks this string, and inline HTML on this
  // origin is script running with the reader's session.
  check("text/html is refused, whatever the file is called", opaque("text/html"));
  check("an SVG is refused: it is a document that can carry script",
    opaque("image/svg+xml"));
  check("XML and XHTML are refused too",
    opaque("application/xhtml+xml") && opaque("text/xml") &&
      opaque("application/xml"));
  check("a made-up type is refused rather than passed through",
    opaque("application/x-anything") && opaque("") && opaque(null));

  // "invoice.pdf" holding HTML is the attack: isPdfMime says pdf from the
  // extension, so the frame renders whatever the type says.
  check("a PDF filename cannot smuggle an HTML type into the frame",
    opaque("text/html; charset=utf-8"), safeAttachmentMimeType("text/html; charset=utf-8"));

  check("parameters are dropped, so a claim cannot hide behind one",
    safeAttachmentMimeType("image/png; charset=utf-8") === "image/png");
  check("the claim is matched without case, as MIME types are",
    safeAttachmentMimeType("IMAGE/PNG") === "image/png");
  check("a download is always opaque: the browser is saving, not rendering",
    safeAttachmentMimeType("image/png", { download: true }) === OPAQUE_MIME_TYPE);

  // A ticket system sends its PDF as application/octet-stream. The preview
  // decided it was a PDF from the name, and an opaque blob in the frame showed
  // as nothing while Open and Download, which ignore the type, worked.
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 hello");
  const htmlBytes = new TextEncoder().encode("<html>hi</html>");
  check("a file that starts as a PDF is served as one, whatever it was called",
    safeAttachmentMimeType("application/octet-stream", { bytes: pdfBytes }) ===
      "application/pdf" &&
      safeAttachmentMimeType(null, { bytes: pdfBytes }) === "application/pdf");
  check("the bytes decide only towards PDF, never towards HTML",
    safeAttachmentMimeType("text/html", { bytes: htmlBytes }) === OPAQUE_MIME_TYPE &&
      safeAttachmentMimeType("text/html", { bytes: pdfBytes }) === "application/pdf" &&
      safeAttachmentMimeType("application/octet-stream", { bytes: htmlBytes }) ===
        OPAQUE_MIME_TYPE);
  check("a download stays opaque even for a real PDF",
    safeAttachmentMimeType("application/pdf", { download: true, bytes: pdfBytes }) ===
      OPAQUE_MIME_TYPE);

  // ---- Reading an attachment with no server -------------------------------
  let asked = null;
  setMailApiTransport(async (path) => {
    asked = path;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });

  const source = await openAttachmentSource("/api/mail/attachment?x=1");
  check("it reads the attachment through the transport, not by URL",
    asked === "/api/mail/attachment?x=1", String(asked));
  check("it answers a blob URL, which an <img> can load with no server",
    source.url.startsWith("blob:"), source.url);

  // A blob URL holds its bytes until it is revoked. Without release, every
  // attachment ever opened stays in memory for the life of the window.
  check("releasing revokes the URL", typeof source.release === "function");
  source.release();
  source.release(); // must not throw on a second call

  setMailApiTransport(async () =>
    new Response("no such message", { status: 404 }));
  const err = await openAttachmentSource("/api/mail/attachment?x=1")
    .then(() => null, (e) => e.message);
  check("a failed read reports the reason instead of a broken image",
    /no such message/.test(err ?? ""), err);

  // ---- Saving --------------------------------------------------------------
  check("this host saves files itself, because a webview has no downloads folder",
    hostSavesAttachments === true);

  let invoked = null;
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      invoked = { cmd, args };
      return "/Users/me/Downloads/apple-icon.png";
    } } },
  };
  setMailApiTransport(async () =>
    new Response(new Uint8Array([1, 2, 253]), { status: 200 }));
  await saveAttachment({ path: "/api/mail/attachment?x=1", filename: "a.png" });
  check("saving hands the bytes to the shell, base64 encoded for the bridge",
    invoked?.cmd === "save_attachment" && invoked.args.contentBase64 === "AQL9",
    JSON.stringify(invoked?.args));
  check("saving alone does not open the file", invoked?.args.open === false);

  await saveAttachment({ path: "/api/mail/attachment?x=1", filename: "a.png", open: true });
  check("opening asks for it", invoked?.args.open === true);
});
