/**
 * Which parts of a Gmail message count as files to show.
 *
 * The rule has to give the same answer to the list, which asks without a
 * body to check against, and to the reader, which asks with one. It did
 * not: a forward quotes the message it forwards, so a picture's Content-ID
 * appeared in the quoted history and the file vanished from the reader
 * while the list still showed its paperclip.
 */

import { extractAttachments } from "@/lib/gmail/api";
import { check, suite } from "./harness.mjs";

const part = (over) => ({
  mimeType: "image/png",
  filename: "shot.png",
  body: { attachmentId: "a1", size: 10 },
  headers: [],
  ...over,
});
const msg = (parts) => ({ id: "m1", payload: { mimeType: "multipart/mixed", parts } });
const names = (m, html = "") => extractAttachments(m, html).map((a) => a.filename);

suite(async () => {
  // ---- What a sender marked as an attachment ------------------------------
  const attachedWithCid = part({
    filename: "Skærmbillede.png",
    headers: [
      { name: "Content-ID", value: "<abc123>" },
      { name: "Content-Disposition", value: 'attachment; filename="Skærmbillede.png"' },
    ],
  });
  check(
    "a file marked attachment stays one, even where the body names its cid",
    names(msg([attachedWithCid]), '<p>quoted <img src="cid:abc123"></p>')[0] ===
      "Skærmbillede.png",
    JSON.stringify(names(msg([attachedWithCid]), '<img src="cid:abc123">'))
  );
  check(
    "and the answer is the same without a body — the list asks that way",
    names(msg([attachedWithCid])).length === 1
  );

  // ---- A real signature logo ----------------------------------------------
  const logo = part({
    filename: "logo.png",
    headers: [
      { name: "Content-ID", value: "<logo9>" },
      { name: "Content-Disposition", value: "inline" },
    ],
  });
  check(
    "a picture the body shows inline is still not a file",
    names(msg([logo]), '<img src="cid:logo9">').length === 0
  );
  check(
    "nor when it only says inline",
    names(msg([logo])).length === 0
  );

  // ---- Documents ----------------------------------------------------------
  const pdf = part({
    mimeType: "application/pdf",
    filename: "Bilag — møde på fredag.pdf",
    headers: [{ name: "Content-Disposition", value: "attachment" }],
  });
  check(
    "a document is a file whatever the body says",
    names(msg([pdf]), "<p>cid:anything</p>")[0].endsWith(".pdf")
  );

  // ---- A name only the header knows ---------------------------------------
  const encoded = part({
    filename: "",
    mimeType: "application/pdf",
    headers: [
      {
        name: "Content-Disposition",
        value: "attachment; filename*=UTF-8''Bilag%20p%C3%A5%20fredag.pdf",
      },
    ],
  });
  check(
    "an RFC 2231 name is read back as the letters it stands for",
    names(msg([encoded]))[0] === "Bilag på fredag.pdf",
    JSON.stringify(names(msg([encoded])))
  );
});
