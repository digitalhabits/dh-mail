/**
 * What a sent message is made of: its files, the pictures in its body, the
 * message it forwards or quotes, and what is refused before it goes.
 *
 * mail-send checks recipients, the signature and threading on each
 * provider. This suite checks the parts of the Gmail message (an RFC 822
 * message with MIME parts) and the rules both providers share. The mail is
 * invented.
 */

import { sendMailMessage } from "@/lib/mail/inbox";
import { ALMA, fakeMailProviders, fakeMailStore, GMAIL, OUTLOOK, rawOfGmailSend } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const message = (account, extra = {}) => ({
  account,
  to: [ALMA.email],
  cc: [],
  subject: "Chairs",
  body: "Twelve chairs.",
  html: "<p>Twelve chairs.</p>",
  includeSignature: false,
  ...extra,
});

const FILE = { filename: "chair-count.txt", mimeType: "text/plain", contentBase64: Buffer.from("twelve").toString("base64") };
// The smallest PNG header there is, as the composer holds a pasted picture.
const PICTURE = "data:image/png;base64,iVBORw0KGgo=";

async function gmailRaw(extra) {
  fakeMailStore();
  const { requests } = fakeMailProviders();
  await sendMailMessage(message(GMAIL, extra));
  const send = requests.find((r) => r.url.endsWith("/messages/send"));
  return send ? rawOfGmailSend(send) : "";
}

/** Every base64 part of a raw message, decoded, with its own headers. */
function parts(raw) {
  const out = [];
  for (const chunk of raw.split(/\r\n--=_redd_[a-z]+_[0-9a-z]+(?:--)?\r?\n?/)) {
    const at = chunk.indexOf("\r\n\r\n");
    if (at < 0) continue;
    const head = chunk.slice(0, at);
    if (!/Content-Transfer-Encoding: base64/i.test(head)) continue;
    const body = Buffer.from(chunk.slice(at + 4).replace(/\s+/g, ""), "base64").toString("utf8");
    out.push({ head, body });
  }
  return out;
}

async function refusal(input) {
  fakeMailStore();
  const { requests } = fakeMailProviders();
  try {
    await sendMailMessage(input);
    return { err: null, requests };
  } catch (err) {
    return { err, requests };
  }
}

suite(async () => {
  // ---- A file ----------------------------------------------------------------
  let raw = await gmailRaw({ attachments: [FILE] });
  check("a file makes the message multipart/mixed", /Content-Type: multipart\/mixed/.test(raw));
  const file = parts(raw).find((p) => /Content-Disposition: attachment/.test(p.head));
  check("the file goes as an attachment, with its name", /filename="chair-count\.txt"/.test(file?.head || ""), file?.head);
  check("with its bytes", file?.body === "twelve", file?.body);
  check("and the words still go as text and html", /multipart\/alternative/.test(raw));

  // ---- A picture in the body ---------------------------------------------------
  raw = await gmailRaw({ html: `<p>Look:</p><img src="${PICTURE}">` });
  check("a picture in the body makes the body multipart/related", /Content-Type: multipart\/related/.test(raw));
  check("and nothing is hung off the end as a file", !/multipart\/mixed/.test(raw));
  const pic = parts(raw).find((p) => /Content-ID: <[^>]+>/.test(p.head));
  const cid = pic?.head.match(/Content-ID: <([^>]+)>/)?.[1];
  check("the picture is its own part, inline, with a Content-ID", Boolean(cid) && /Content-Disposition: inline/.test(pic.head), pic?.head);
  const html = parts(raw).find((p) => /text\/html/.test(p.head))?.body || "";
  check("the body refers to it by cid:, not data:", html.includes(`cid:${cid}`) && !html.includes("data:image"), html.slice(0, 200));

  raw = await gmailRaw({ html: `<img src="${PICTURE}">`, attachments: [FILE] });
  const mixedAt = raw.indexOf("multipart/mixed");
  const relatedAt = raw.indexOf("multipart/related");
  check("a picture and a file: related sits inside mixed", mixedAt >= 0 && relatedAt > mixedAt);

  // ---- A forward, and a quote ---------------------------------------------------
  const forward = {
    fromName: "Tea Aavang",
    fromEmail: "tea@aavang.example",
    date: "3 Mar 2026",
    subject: "Choir",
    to: ["ulla@aavang.example"],
    text: "Choir moves to Thursday.",
    html: "<p>Choir moves to <b>Thursday</b>.</p>",
  };
  raw = await gmailRaw({ forward, subject: "Fwd: Choir" });
  let decoded = parts(raw);
  const plain = decoded.find((p) => /text\/plain/.test(p.head))?.body || "";
  const rich = decoded.find((p) => /text\/html/.test(p.head))?.body || "";
  check("a forward carries the words written, then the forwarded message, as text", plain.indexOf("Twelve chairs.") >= 0 && plain.indexOf("Choir moves to Thursday.") > plain.indexOf("Twelve chairs."), plain);
  check("and in html, with its layout", rich.includes("Choir moves to <b>Thursday</b>."), rich.slice(0, 300));
  check("and names who sent it", plain.includes("tea@aavang.example"), plain);

  raw = await gmailRaw({ quote: { fromName: "Tea Aavang", fromEmail: "tea@aavang.example", date: "3 Mar 2026", text: "Can we move choir?" } });
  decoded = parts(raw);
  check("a reply quotes the message it answers, below the words", (decoded.find((p) => /text\/plain/.test(p.head))?.body || "").includes("Can we move choir?"));

  fakeMailStore();
  let { requests } = fakeMailProviders();
  await sendMailMessage(message(OUTLOOK, { forward, subject: "Fwd: Choir" }));
  const outlookSend = requests.find((r) => r.url.endsWith("/me/sendMail"));
  check("Outlook: the forwarded message is written into the body", (outlookSend?.body.message.body.content || "").includes("Choir moves to <b>Thursday</b>."));

  // ---- The envelope ---------------------------------------------------------------
  raw = await gmailRaw({ to: [], bcc: ["kaj@one.example"] });
  check("a message to Bcc alone is sent, with its Bcc", /^Bcc: kaj@one\.example$/m.test(raw), raw.slice(0, 200));
  // An empty To: is not a valid header. The usual form for "nobody in To"
  // is the empty group, which mail clients show as undisclosed recipients.
  check("and its To names nobody in the form clients know", /^To: undisclosed-recipients:;$/m.test(raw) && !/^To: *$/m.test(raw), raw.match(/^To:.*$/m)?.[0]);

  // ---- Refused before anything goes ------------------------------------------------
  const big = { ...FILE, filename: "big.bin", contentBase64: "A".repeat(Math.ceil((26 * 1024 * 1024 * 4) / 3)) };
  let r = await refusal(message(GMAIL, { attachments: [big] }));
  check("Gmail: files over 25 MB are refused, with the limit named", r.err?.status === 400 && /25 MB/.test(r.err?.message), r.err?.message);
  check("and nothing is sent", !r.requests.some((q) => q.url.endsWith("/messages/send")));

  r = await refusal(message(OUTLOOK, { sendAt: "soon" }));
  check("a send time that is not a time is refused", r.err?.status === 400 && /not a time/.test(r.err?.message), r.err?.message);
  r = await refusal(message(OUTLOOK, { sendAt: "2020-01-01T09:00:00.000Z" }));
  check("a send time that has passed is refused", r.err?.status === 400 && /has not passed/.test(r.err?.message), r.err?.message);
  check("and Outlook is not asked", !r.requests.some((q) => q.url.includes("graph.microsoft.com")));
});
