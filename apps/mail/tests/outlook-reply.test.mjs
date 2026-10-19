/**
 * A reply finished in Outlook.
 *
 * It opened as a new message: no quote, and no place in the conversation
 * in Outlook (2026-10-19). Now Outlook is asked to reply to its own copy
 * of the message, and only when the reply keeps the thread's subject. When
 * Outlook cannot, the new message carries the history under the words.
 */

import { forwardedHtml, forwardedPlainText } from "@/lib/mail/forwarded-message";
import { replyAnchor, replyKeepsSubject, withHistory } from "@/lib/mail/outlook-compose";
import { check, suite } from "./harness.mjs";

const message = (id) => ({ id, fromName: "", fromEmail: "ann@b.test", toEmails: [], ccEmails: [], sentAt: null, bodyText: "", own: false });

suite(async () => {
  check("the reply answers the newest message", replyAnchor([message("m1"), message("m2")])?.id === "m2");
  check("not one still on its way", replyAnchor([message("m1"), message("local-123")])?.id === "m1");
  check("and nothing in an empty thread", replyAnchor([]) === null);

  check("Re: on the thread's subject keeps it", replyKeepsSubject("Re: FW: Plans", "FW: Plans"));
  check("whatever the case and spacing", replyKeepsSubject("RE:  plans ", "Plans"));
  check("a subject of its own does not", !replyKeepsSubject("Re: New plans", "Plans"));

  const both = withHistory({ html: "<p>Hi</p>", text: "Hi" }, { html: "<blockquote>Old</blockquote>", text: "> Old" });
  check("the history goes under the words", both.html === "<p>Hi</p><blockquote>Old</blockquote>", both.html);
  check("and under them in the text too", both.text === "Hi\n\n> Old", both.text);
  // A forward to Outlook carries the message it forwards (2026-10-19).
  const forward = { fromName: "Ann", fromEmail: "ann@b.test", date: "15 Oct", subject: "Plans", to: ["bo@c.test"], text: "The plan." };
  const forwarded = withHistory({ html: "<p>Dear Sue,</p>", text: "Dear Sue," }, { html: forwardedHtml(forward), text: forwardedPlainText(forward) });
  check("a forward's words come first", forwarded.html.startsWith("<p>Dear Sue,</p>"), forwarded.html);
  check("and the forwarded message under them", forwarded.html.includes("Forwarded message") && forwarded.html.includes("The plan."), forwarded.html);
  check("in the text too", forwarded.text.includes("From: Ann <ann@b.test>") && forwarded.text.endsWith("The plan."), forwarded.text);
  check("no history, no change", withHistory({ html: "<p>Hi</p>", text: "Hi" }, null).html === "<p>Hi</p>");
});
