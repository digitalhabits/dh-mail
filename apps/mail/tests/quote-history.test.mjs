/**
 * The rebuilt quoted history.
 *
 * Classic mail inherits its tail from the mail it answers, so one mail
 * sent without a tail starves every mail after it. This builder makes the
 * tail from the thread instead. What is checked here is the shape of what
 * it makes: the order, the cap, the note about what was left out, and
 * that nothing in a message can break out of the HTML it is quoted in.
 */

import {
  buildQuoteHistory,
  REPLY_HISTORY_CAP,
} from "@/lib/mail/quote-history";

import { check, suite } from "./harness.mjs";

const entry = (n) => ({
  fromName: `Person ${n}`,
  fromEmail: `p${n}@example.org`,
  date: `day ${n}`,
  text: `message ${n}`,
});

suite(async () => {
  const five = [1, 2, 3, 4, 5].map(entry);
  const built = buildQuoteHistory(five);
  check(
    "a reply's tail reads newest first, like the chain it replaces",
    built.text.indexOf("message 5") < built.text.indexOf("message 4")
  );
  check(
    "every message is there once",
    [1, 2, 3, 4, 5].every((n) => built.text.includes(`message ${n}`))
  );
  check(
    "the words carry quote markers",
    built.text.includes("> message 5")
  );
  check(
    "each block says who and when",
    built.text.includes("On day 3, Person 3 <p3@example.org> wrote:")
  );
  check(
    "nothing is omitted from a short thread",
    built.omitted === 0 && !built.text.includes("not shown")
  );
  check(
    "the html wears the classes clients fold on",
    built.html.includes('class="gmail_quote"') &&
      built.html.includes('class="gmail_attr"')
  );

  const thirty = Array.from({ length: 30 }, (_, i) => entry(i + 1));
  const capped = buildQuoteHistory(thirty, {
    cap: REPLY_HISTORY_CAP,
    omittedBeyond: 7,
  });
  check(
    "the cap keeps the newest messages",
    capped.included === REPLY_HISTORY_CAP &&
      capped.text.includes("message 30") &&
      !capped.text.includes("message 5\n")
  );
  check(
    "omitted counts the capped and the never-loaded together",
    capped.omitted === 12 &&
      capped.text.includes("[12 earlier messages not shown]")
  );
  check(
    "the note sits at the old end — the bottom, when newest is first",
    capped.text.trimEnd().endsWith("not shown]")
  );

  const story = buildQuoteHistory(five, {
    order: "oldest-first",
    heading: "Forwarded conversation — Test (5 messages)",
  });
  check(
    "a forwarded conversation reads oldest first, like a story",
    story.text.indexOf("message 1") < story.text.indexOf("message 2")
  );
  check(
    "its heading comes before everything",
    story.text.startsWith("Forwarded conversation — Test (5 messages)")
  );
  check(
    "the heading is in the html too, escaped",
    buildQuoteHistory(five, {
      order: "oldest-first",
      heading: "<b>loud</b>",
    }).html.includes("&lt;b&gt;loud&lt;/b&gt;")
  );
  const storyOmitted = buildQuoteHistory(five, {
    order: "oldest-first",
    omittedBeyond: 2,
  });
  check(
    "in a story the note sits at the top, where the missing past would be",
    storyOmitted.text.startsWith("[2 earlier messages not shown]")
  );

  const sly = buildQuoteHistory([
    {
      fromName: 'Eve "<i>"',
      fromEmail: "eve@example.org",
      date: "d",
      text: "<script>alert(1)</script>",
    },
  ]);
  check(
    "a message's text cannot break out of the html",
    sly.html.includes("&lt;script&gt;") && !sly.html.includes("<script>")
  );
  check(
    "neither can a sender's name",
    sly.html.includes("&lt;i&gt;") && !sly.html.includes("<i>")
  );

  const rich = buildQuoteHistory([
    { ...entry(1), html: "<p><b>kept as it is</b></p>" },
  ]);
  check(
    "html a caller sanitized is relayed, not re-escaped",
    rich.html.includes("<b>kept as it is</b>")
  );

  const one = buildQuoteHistory([entry(1)], { omittedBeyond: 1 });
  check(
    "one message omitted says message, not messages",
    one.text.includes("[1 earlier message not shown]")
  );
});
