/**
 * Sending, on each provider.
 *
 * The bytes that leave for Gmail are an RFC 822 message; what leaves for
 * Graph is JSON. The same composer input must come out the other end with
 * the same recipients, the same subject, the same signature rendered the
 * same way, and threaded under the same message. The signature is the one
 * this guards hardest: for a year the Outlook path sent it bare and the
 * Gmail path sent it styled.
 */

import { sendMailMessage } from "@/lib/mail/inbox";
import {
  ALMA,
  fakeMailProviders,
  fakeMailStore,
  GMAIL,
  OUTLOOK,
  rawOfGmailSend,
} from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

/** The rendered signature block, as both providers must send it. */
const SIGNATURE_BLOCK = /<div style="margin-top:16px;font-size:13px;line-height:1.5;color:#444">Sigrid Sten<br><a href="https:\/\/vaerksted\.example" style="color:#444;text-decoration:underline">/;

const message = (account, extra = {}) => ({
  account,
  to: [ALMA.email],
  cc: [],
  subject: "Re: Thursday?",
  body: "Thursday is fine.",
  html: "<p>Thursday is <b>fine</b>.</p>",
  ...extra,
});

suite(async () => {
  // ---- Gmail -----------------------------------------------------------------
  fakeMailStore();
  let { requests } = fakeMailProviders();
  let result = await sendMailMessage(message(GMAIL, {
    threadId: "g3",
    inReplyTo: "<g3m2@gmail.com>",
    references: "<g3m1@example.org> <g3m2@gmail.com>",
  }));
  const send = requests.find((r) => r.url.endsWith("/messages/send"));
  check("gmail: one message is posted", send?.method === "POST");
  check("gmail: in the thread it answers", send?.body.threadId === "g3");
  check("gmail: and the answer carries the ids",
    result.messageId === "sent-1" && result.threadId === "g3", JSON.stringify(result));

  const raw = rawOfGmailSend(send);
  check("gmail: the From carries the name Gmail puts on the address",
    /^From: "Sigrid Sten" <me@gmail\.com>$/m.test(raw), raw.match(/^From:.*$/m)?.[0]);
  check("gmail: To and Subject are the composer's",
    /^To: alma@example\.org$/m.test(raw) && /^Subject: Re: Thursday\?$/m.test(raw));
  check("gmail: it threads under the tip",
    /^In-Reply-To: <g3m2@gmail\.com>$/m.test(raw) &&
      /^References: <g3m1@example\.org> <g3m2@gmail\.com>$/m.test(raw));
  check("gmail: the body goes as text and html",
    /multipart\/alternative/.test(raw) && /text\/plain/.test(raw) && /text\/html/.test(raw));

  // The parts are base64. Decode each to read what the reader would see.
  const decoded = raw.split(/\r\n\r\n/).slice(1)
    .map((part) => Buffer.from(part.replace(/--=_redd.*$/gms, "").replace(/\s+/g, ""), "base64").toString("utf8"))
    .join("\n");
  check("gmail: the plain part carries the words and the signature as text",
    decoded.includes("Thursday is fine.") && decoded.includes("Sigrid Sten\nVærksted"),
    decoded.slice(0, 200));
  check("gmail: the html part carries the styled signature",
    SIGNATURE_BLOCK.test(decoded), decoded.match(/<div style="margin-top:16px[^>]*>[^<]*/)?.[0]);

  // ---- Outlook, a reply ---------------------------------------------------------
  fakeMailStore();
  ({ requests } = fakeMailProviders());
  result = await sendMailMessage(message(OUTLOOK, { threadId: "o1" }));
  const createReply = requests.find((r) => r.url.endsWith("/createReply"));
  const patch = requests.find((r) => r.method === "PATCH");
  const sent = requests.find((r) => r.url.endsWith("/send"));
  check("outlook: a reply is created on the newest message of the conversation",
    createReply?.url.includes("/me/messages/o1m2/createReply"), createReply?.url);
  check("outlook: then filled in, then sent",
    patch?.url.endsWith("/me/messages/reply-draft-1") &&
      sent?.url.endsWith("/me/messages/reply-draft-1/send"),
    `${patch?.url} ${sent?.url}`);
  check("outlook: with the composer's recipients and subject",
    patch?.body.toRecipients?.[0]?.emailAddress?.address === ALMA.email &&
      patch?.body.subject === "Re: Thursday?",
    JSON.stringify(patch?.body.toRecipients));
  check("outlook: the html body carries the words",
    patch?.body.body?.content.includes("<p>Thursday is <b>fine</b>.</p>"));
  check("outlook: and the same styled signature Gmail sends",
    SIGNATURE_BLOCK.test(patch?.body.body?.content ?? ""),
    patch?.body.body?.content.match(/<div style="margin-top:16px[^>]*>[^<]*/)?.[0]);
  check("outlook: the conversation is kept", result.threadId === "o1");

  // ---- Outlook, a new message --------------------------------------------------
  ({ requests } = fakeMailProviders());
  await sendMailMessage(message(OUTLOOK, { subject: "A new one" }));
  const fresh = requests.find((r) => r.url.endsWith("/me/sendMail"));
  check("outlook: a message with no thread is sent outright",
    fresh?.method === "POST" && fresh.body.message.subject === "A new one" &&
      fresh.body.saveToSentItems === true);

  // ---- What both refuse ----------------------------------------------------------
  let refused = null;
  try {
    await sendMailMessage(message(GMAIL, { to: [], cc: [], bcc: [] }));
  } catch (err) {
    refused = err;
  }
  check("nobody on the envelope is refused before anything is sent",
    refused?.status === 400, `${refused?.status} ${refused?.message}`);

  // A morning far in the future, on purpose: a scheduled time that has
  // passed is refused before the provider is asked, so the day this date
  // arrived, the test began failing about the wrong thing.
  refused = null;
  try {
    await sendMailMessage(message(GMAIL, { sendAt: "2033-04-05T09:00:00.000Z" }));
  } catch (err) {
    refused = err;
  }
  check("gmail: send later is refused, with the reason",
    refused?.status === 400 && /Gmail/.test(refused?.message), refused?.message);

  ({ requests } = fakeMailProviders());
  await sendMailMessage(message(OUTLOOK, { sendAt: "2033-04-05T09:00:00.000Z" }));
  const held = requests.find((r) => r.url.endsWith("/me/sendMail"));
  check("outlook: send later hands the time to Exchange",
    held?.body.message.singleValueExtendedProperties?.[0]?.value === "2033-04-05T09:00:00.000Z",
    JSON.stringify(held?.body.message.singleValueExtendedProperties));
});
