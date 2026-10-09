/**
 * A reaction that has to travel as an email.
 *
 * In a messaging app a reaction attaches to the message it answers. Mail has
 * nothing of the kind, so it goes as another message — and sent as the emoji
 * alone it arrives as a thumb with no subject, which in a long thread is not
 * enough to work out what it was for.
 */

import {
  quotedReplyMessage,
  reactionMessage,
  reactionQuoteText,
  REACTION_QUOTE_MAX,
} from "@/lib/mail/reaction-message";

import { check, suite } from "./harness.mjs";

suite(async () => {
  // --- The line of context ------------------------------------------------

  check(
    "a short message is quoted whole",
    reactionQuoteText("Shall we meet at four?") === "Shall we meet at four?"
  );
  check(
    "the lines of a long message become one",
    reactionQuoteText("Hi there\n\nSecond thought\nand a third") ===
      "Hi there Second thought and a third"
  );
  {
    const long = "word ".repeat(80);
    const cut = reactionQuoteText(long);
    check("a long one is cut", cut.length <= REACTION_QUOTE_MAX + 1);
    check("and says it was cut", cut.endsWith("…"));
    check("without breaking a word in half", !/\bwor…$/.test(cut), cut.slice(-12));
  }
  check(
    "nothing to quote is not a quote of nothing",
    reactionQuoteText("   \n  ") === ""
  );

  // --- The message itself --------------------------------------------------

  {
    const { text, html } = reactionMessage("👍", {
      fromName: "Ford",
      text: "Shall we meet at four?",
    });
    // Quote first, emoji under it — the quote is the label, the emoji is the
    // message, and a client with no HTML should read it the same way round.
    check(
      "what it answers comes first",
      text.startsWith("> Ford: \u201cShall we meet at four?\u201d"),
      text.replace(/\n/g, "\\n")
    );
    check("and the emoji is under it", text.trimEnd().endsWith("👍"));
    check(
      "the html stacks them the same way round",
      html.indexOf("Shall we meet") < html.indexOf("👍")
    );
    check("the emoji is in the html", html.includes("👍"));
    check("so is the quote", html.includes("Shall we meet at four?"));
    // Outlook does not lay out with flex, and a reaction that arrives as two
    // stacked blocks has lost the point of sitting beside its quote.
    check("laid out with a table, for Outlook", html.includes("<table"));
    check("the emoji is the big thing", html.includes("font-size:32px"));
    check(
      "and the quote is the quiet one",
      html.includes("font-size:13px")
    );
  }

  // --- No context to give --------------------------------------------------
  //
  // A reaction to a message with no words at all — a picture, say. It goes as
  // it always did rather than with an empty quote beside it.
  {
    const { text, html } = reactionMessage("🎉");
    check("just the emoji", text === "🎉");
    check("and no quote in the html", !html.includes("<table"));
    check("still the big one", html.includes("font-size:32px"));
  }
  {
    const { text } = reactionMessage("🎉", { text: "   " });
    check("whitespace is not context either", text === "🎉");
  }

  // --- Nothing from the quoted message is markup --------------------------
  {
    const { html } = reactionMessage("👍", {
      fromName: "Ford",
      text: '<img src=x onerror="alert(1)"> & "quoted"',
    });
    check("angle brackets are escaped", !html.includes("<img"));
    check("and so are quotes and ampersands", html.includes("&amp;"));
  }
  {
    const { text } = reactionMessage("👍", { text: "no name here" });
    check(
      "an unnamed sender leaves no stray colon",
      text.includes("> \u201cno name here\u201d"),
      text.replace(/\n/g, "\\n")
    );
  }

  // --- A reply that answers one message ------------------------------------
  //
  // The quote goes in the body rather than as the history under it. Sent as
  // history it was folded away behind a "…" by the reader, and a chat-style
  // thread drops the history altogether — so the message that was picked
  // never showed at either end. That is the bug these hold shut.

  {
    const { text, html } = quotedReplyMessage("Korrekt, I'll build it", {
      fromName: "Mikkel",
      text: "Kan du også tilføje emoji-responses?",
    });
    check(
      "what is being answered comes first",
      text.startsWith("> Mikkel: \u201cKan du også tilføje emoji-responses?\u201d"),
      text.replace(/\n/g, "\\n")
    );
    check("and the reply follows it", text.trimEnd().endsWith("Korrekt, I'll build it"));
    check(
      "the html puts the quote above the reply",
      html.indexOf("Kan du også") < html.indexOf("Korrekt"),
    );
    check("the quote is in its card", html.includes("border-left:3px solid #0d9488"));
  }

  // Nothing picked: the reply is the reply, with no empty card over it.
  {
    const { text, html } = quotedReplyMessage("Just a message");
    check("no quote, no card", text === "Just a message" && !html.includes("border-left"));
    check("the words survive", html.includes("Just a message"));
  }

  // The composer's own HTML is kept — it is a rich text editor, and rebuilding
  // its output from the plain text would throw away every link and list.
  {
    const { html } = quotedReplyMessage(
      "hello",
      { fromName: "Ford", text: "hi" },
      "<p>hel<b>lo</b></p>"
    );
    check("the composer's html is used as it is", html.includes("hel<b>lo</b>"));
  }

  // Plain text, with no HTML from a composer, still arrives as paragraphs.
  {
    const { html } = quotedReplyMessage("One\n\nTwo");
    check("blank lines become paragraphs", (html.match(/<p /g) ?? []).length === 2);
    check("and it is escaped", !quotedReplyMessage("<b>x</b>").html.includes("<b>x"));
  }

  // --- What a collapsed row shows -----------------------------------------
  //
  // A folded row is the plain text with its line breaks taken out, and Gmail
  // drops the ">" on the way. Without marks of its own the quote ran into the
  // reply as one sentence: "Tester lige igen Virker quoting nu?".

  {
    const { text } = quotedReplyMessage("Virker quoting nu?", {
      text: "Tester lige igen",
    });
    const flattened = text.replace(/^>\s*/gm, "").replace(/\s+/g, " ").trim();
    check(
      "flattened, the quote is still marked as one",
      flattened === "\u201cTester lige igen\u201d Virker quoting nu?",
      flattened
    );
  }
  {
    const { text } = reactionMessage("👍", { text: "Shall we?" });
    const flattened = text.replace(/^>\s*/gm, "").replace(/\s+/g, " ").trim();
    check(
      "and a reaction reads the same way",
      flattened === "\u201cShall we?\u201d 👍",
      flattened
    );
  }

  // The card carries the marks too: a folded row can be built from the HTML
  // rather than the text, and stripped of its rule and its colour the card is
  // just words running into the reply.
  {
    const { html } = quotedReplyMessage("Virker quoting nu?", {
      text: "Tester lige igen",
    });
    const asText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    check(
      "flattening the html still reads as a quote",
      asText === "\u201cTester lige igen\u201d Virker quoting nu?",
      asText
    );
  }

  // --- How the quote card is laid out --------------------------------------
  //
  // Whose message it was on its own line, in bold, and what they said under
  // it — the way a messaging app lays a reply out. Run together on one line
  // it read as a sentence somebody had written rather than one being
  // answered.

  {
    const { html } = quotedReplyMessage("On my way", {
      fromName: "Mikkel",
      text: "Are you coming?",
    });
    check("the name is its own line", html.includes("font-weight:600"));
    check(
      "and comes before what they said",
      html.indexOf("Mikkel") < html.indexOf("Are you coming?")
    );
    check("the bar is still down the left", html.includes("border-left:3px"));
    // Flattened it must still read as a quote — see the folded-row checks.
    const asText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    check(
      "flattened it is a name, a quote, then the reply",
      asText === "Mikkel \u201cAre you coming?\u201d On my way",
      asText
    );
  }
  // No name to show: no empty line where one would have been.
  {
    const { html } = quotedReplyMessage("Yes", { text: "Coming?" });
    check("an unnamed quote has no name line", !html.includes("font-weight:600"));
    check("and still shows what was said", html.includes("Coming?"));
  }
});
