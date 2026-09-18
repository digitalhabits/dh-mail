/**
 * The mailto: URL that opens Outlook on a new message.
 *
 * Written by hand because URLSearchParams encodes a space as `+`, which is
 * what a form means by one and not what a URL does. Outlook read the plus
 * signs literally and showed a subject line full of them.
 */

import {
  bodyTravels,
  ccBackToSelf,
  outlookComposeUrl,
} from "@/lib/mail/outlook-compose";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check("a space in the subject is percent-encoded, not a plus", () => {
    const url = outlookComposeUrl({
      to: ["someone@example.com"],
      subject: "Re: Catalogue week: your order",
    });
    if (url.includes("+")) return `plus signs survived: ${url}`;
    return (
      url ===
        "mailto:someone%40example.com?subject=Re%3A%20Catalogue%20week%3A%20your%20order" ||
      `got ${url}`
    );
  });

  check("several recipients stay a comma-separated list", () => {
    const url = outlookComposeUrl({
      to: ["a@example.com", "b@example.com"],
      subject: "",
    });
    return url === "mailto:a%40example.com,b%40example.com" || `got ${url}`;
  });

  check("cc rides along, and only when there is one", () => {
    const withCc = outlookComposeUrl({
      to: ["a@example.com"],
      cc: ["c@example.com"],
      subject: "Hi",
    });
    const without = outlookComposeUrl({ to: ["a@example.com"], subject: "Hi" });
    return (
      (withCc.includes("cc=c%40example.com") && !without.includes("cc=")) ||
      `got ${withCc} / ${without}`
    );
  });

  check("an empty subject leaves no empty field behind", () => {
    const url = outlookComposeUrl({ to: ["a@example.com"], subject: "   " });
    return url === "mailto:a%40example.com" || `got ${url}`;
  });

  check("the body rides along when it is asked for", () => {
    const url = outlookComposeUrl({
      to: ["a@example.com"],
      subject: "Hi",
      body: "One line.\n\nAnd another.",
    });
    return (
      url ===
        "mailto:a%40example.com?subject=Hi&body=One%20line.%0A%0AAnd%20another." ||
      `got ${url}`
    );
  });

  check("plain and short travels in the URL", () => {
    const text = "Thanks — that works for me. See you Tuesday.";
    return (
      bodyTravels(`<p>${text}</p>`, text) === true || "plain text refused"
    );
  });

  check("anything formatted goes by the pasteboard instead", () => {
    const text = "Thanks, that works for me.";
    return (
      bodyTravels(`<p>Thanks, <b>that</b> works for me.</p>`, text) === false ||
      "bold was allowed into the URL"
    );
  });

  check("a link counts as formatting, because a mailto body cannot hold one", () => {
    const text = "The notes are at example.com/notes";
    return (
      bodyTravels(`<p>The notes are at <a href="x">example.com/notes</a></p>`, text) ===
        false || "a link was allowed into the URL"
    );
  });

  check("a long message goes by the pasteboard however plain it is", () => {
    const text = "a".repeat(1600);
    return bodyTravels(`<p>${text}</p>`, text) === false || "a long body was allowed";
  });

  check("an empty message travels nowhere", () => {
    return bodyTravels("<p></p>", "   ") === false || "an empty body was allowed";
  });

  check("the mailbox it was written from is copied in", () => {
    const cc = ccBackToSelf({
      from: "vera@example.org",
      to: ["chris@example.ac.uk"],
      cc: [],
    });
    return (
      JSON.stringify(cc) === '["vera@example.org"]' || `got ${cc}`
    );
  });

  check("nobody is copied in twice", () => {
    const cc = ccBackToSelf({
      from: "Vera@Example.org",
      to: ["chris@example.ac.uk", "vera@example.org"],
      cc: [],
    });
    return JSON.stringify(cc) === "[]" || `got ${cc}`;
  });

  check("a draft made in the mailbox it came from needs no copy", () => {
    const cc = ccBackToSelf({
      from: "vera.holm@example.ac.uk",
      to: ["chris@example.ac.uk"],
      cc: [],
      target: "vera.holm@example.ac.uk",
    });
    return JSON.stringify(cc) === "[]" || `got ${cc}`;
  });

  check("an existing cc keeps its company", () => {
    const cc = ccBackToSelf({
      from: "vera@example.org",
      to: ["chris@example.ac.uk"],
      cc: ["harriet@example.ac.uk"],
    });
    return (
      JSON.stringify(cc) ===
        '["harriet@example.ac.uk","vera@example.org"]' || `got ${cc}`
    );
  });

  check("an ampersand in the subject cannot start a field", () => {
    const url = outlookComposeUrl({
      to: ["a@example.com"],
      subject: "Tea & biscuits",
    });
    return (
      url === "mailto:a%40example.com?subject=Tea%20%26%20biscuits" ||
      `got ${url}`
    );
  });
});
