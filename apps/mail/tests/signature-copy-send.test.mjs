/**
 * A signature changed for one message, as it is sent.
 *
 * The composer shows an editable copy of the signature under the message.
 * When the writer changes it, the send carries the copy as `signatureHtml`.
 * The copy then goes out in place of the saved signature, on every provider,
 * and the saved signature does not change. With no copy, the message is the
 * same as before the copy existed.
 *
 * The people and words are invented.
 */

import { sendMailMessage } from "@/lib/mail/inbox";
import { signatureHtml, signaturePlainText } from "@/lib/mail/signature-html";
import {
  ALMA,
  fakeMailProviders,
  fakeMailStore,
  GMAIL,
  OUTLOOK,
  rawOfGmailSend,
  SIGNATURE,
} from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

/** The copy: the English title in place of the Danish one. */
const COPY = "<p>Sigrid Sten</p><p>Head of the Boat Workshop</p>";

const message = (account, extra = {}) => ({
  account,
  to: [ALMA.email],
  cc: [],
  subject: "Paint for the boats",
  body: "The paint is in the shed.",
  html: "<p>The paint is in the shed.</p>",
  ...extra,
});

/** The decoded text and html parts of a Gmail send. Ids and boundaries vary. */
async function gmailParts(extra) {
  const store = fakeMailStore();
  const { requests } = fakeMailProviders();
  await sendMailMessage(message(GMAIL, extra));
  const send = requests.find((r) => r.url.endsWith("/messages/send"));
  const raw = send ? rawOfGmailSend(send) : "";
  const out = { text: "", html: "", store };
  for (const chunk of raw.split(/\r\n--=_redd_[a-z]+_[0-9a-z]+(?:--)?\r?\n?/)) {
    const at = chunk.indexOf("\r\n\r\n");
    if (at < 0) continue;
    const head = chunk.slice(0, at);
    const body = Buffer.from(chunk.slice(at + 4).replace(/\s+/g, ""), "base64").toString("utf8");
    if (/text\/plain/i.test(head)) out.text = body;
    if (/text\/html/i.test(head)) out.html = body;
  }
  return out;
}

/** The html body that Graph receives for an Outlook send. */
async function outlookHtml(extra) {
  fakeMailStore();
  const { requests } = fakeMailProviders();
  await sendMailMessage(message(OUTLOOK, extra));
  const sent = requests.find((r) => r.url.endsWith("/me/sendMail"));
  return sent?.body.message.body.content ?? "";
}

suite(async () => {
  // ---- No copy: the saved signature, as before ----------------------------
  const saved = await gmailParts({});
  check("no copy: the html part carries the saved signature",
    saved.html.includes(signatureHtml(SIGNATURE)), saved.html.slice(-300));
  check("no copy: the text part ends with the saved signature",
    saved.text.trimEnd().endsWith(signaturePlainText(SIGNATURE)), saved.text);

  // The copy is the saved signature, word for word: the same bytes go out.
  const same = await gmailParts({ signatureHtml: SIGNATURE });
  check("a copy equal to the saved signature sends the same html",
    same.html === saved.html, same.html.slice(-200));
  check("and the same text", same.text === saved.text, same.text);

  // ---- A changed copy ------------------------------------------------------
  const changed = await gmailParts({ signatureHtml: COPY });
  check("gmail: the html part carries the copy",
    changed.html.includes(signatureHtml(COPY)), changed.html.slice(-300));
  check("gmail: and not the saved signature",
    !changed.html.includes("vaerksted.example"), changed.html.slice(-300));
  check("gmail: the text part carries the copy as text",
    changed.text.includes("Sigrid Sten\nHead of the Boat Workshop") &&
      !changed.text.includes("Værksted"),
    changed.text);
  const setWrites = changed.store.calls.filter(
    (c) => c.op === "settings.set" && String(c.args.key).startsWith("mail_signature")
  );
  check("the saved signature is not written", setWrites.length === 0,
    JSON.stringify(setWrites));
  check("and it is still the saved one",
    changed.store.stored[`mail_signature:${GMAIL}`] === JSON.stringify({ signature: SIGNATURE }));

  const outlook = await outlookHtml({ signatureHtml: COPY });
  check("outlook: the html body carries the copy",
    outlook.includes(signatureHtml(COPY)) && !outlook.includes("vaerksted.example"),
    outlook.slice(-300));
  const outlookSaved = await outlookHtml({});
  check("outlook: with no copy, the saved signature",
    outlookSaved.includes(signatureHtml(SIGNATURE)), outlookSaved.slice(-300));

  // ---- Nothing left in the copy, or no signature at all --------------------
  const emptied = await gmailParts({ signatureHtml: "<p><br></p>" });
  check("an emptied copy sends no signature block",
    !emptied.html.includes("margin-top:16px;font-size:13px"), emptied.html.slice(-200));
  check("and no signature text", emptied.text.trimEnd().endsWith("The paint is in the shed."),
    emptied.text);

  const off = await gmailParts({ signatureHtml: COPY, includeSignature: false });
  check("signature off: the copy does not go either",
    !off.html.includes("Boat Workshop") && !off.text.includes("Boat Workshop"), off.text);
});
