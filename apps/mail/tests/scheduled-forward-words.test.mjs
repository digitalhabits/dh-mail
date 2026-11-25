/**
 * A forward can be sent later, and Edit does not lose what it forwards.
 *
 * Edit on a scheduled message opens its kept words in a new message and
 * takes the scheduled one off. A reply's quote is built again in its
 * conversation. A forward's is not, so its words carry the forwarded
 * message. The people here are invented.
 */

import { check, suite } from "./harness.mjs";

import { forwardedHtml, forwardedPlainText } from "@/lib/mail/forwarded-message";
import { scheduledWords } from "@/lib/mail/inbox-send";

const forward = {
  fromName: "Ida Holm",
  fromEmail: "ida@aavang.example",
  date: "16 Nov, 14.48",
  subject: "Course at Aavang",
  to: ["sven@north.example"],
  text: "Dear Sven, the course is on 13 December.",
  html: "<p>Dear Sven, the course is on 13 December.</p>",
};

suite(async () => {
  const reply = scheduledWords({ body: "Thanks!", html: "<p>Thanks!</p>" });
  check("a reply keeps its own words", reply.text === "Thanks!");
  check("and its own html", reply.html === "<p>Thanks!</p>");

  const fwd = scheduledWords({ body: "See below.", html: "<p>See below.</p>", forward });
  check("a forward keeps its note first", fwd.text.startsWith("See below."));
  check(
    "and the forwarded message under it, as text",
    fwd.text.endsWith(forwardedPlainText(forward)) && fwd.text.includes("13 December")
  );
  check(
    "and as html",
    fwd.html === `<p>See below.</p>${forwardedHtml(forward)}`
  );

  const bare = scheduledWords({ body: "", forward });
  check(
    "a forward with no note is the forwarded message alone",
    bare.text === forwardedPlainText(forward)
  );
  check("and its html too", bare.html === forwardedHtml(forward));
});
