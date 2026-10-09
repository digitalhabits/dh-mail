/**
 * The right-click menu on a link in a message: what it shows and what it
 * copies.
 *
 * Links in the frame are spans, so the browser's own menu never offers Copy
 * Link. This menu does, and its first row says where the link really goes.
 */

import { mailLinkMenuModel, shortenLinkForMenu } from "@/lib/mail/link-menu";

import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- What the first row says ------------------------------------------

  check(
    "a bare host loses its scheme, its www, and its slash",
    shortenLinkForMenu("https://www.example.org/") === "example.org",
    shortenLinkForMenu("https://www.example.org/")
  );
  check(
    "the path stays, since it says which page",
    shortenLinkForMenu("https://www.example.org/Kontakt/os") ===
      "example.org/Kontakt/os",
    shortenLinkForMenu("https://www.example.org/Kontakt/os")
  );
  check(
    "a query stays too — a tracking link is a thing worth seeing",
    shortenLinkForMenu("https://a.example/p?u=1") === "a.example/p?u=1"
  );

  const long =
    "https://example.com/" + "a".repeat(40) + "/" + "b".repeat(40) + "/end";
  const shown = shortenLinkForMenu(long);
  check(
    "a long link is cut in the middle, keeping the host and the end",
    shown.length <= 60 &&
      shown.startsWith("example.com/aaaa") &&
      shown.endsWith("/end") &&
      shown.includes("…"),
    shown
  );

  check(
    "percent-escapes are shown as the letters they stand for",
    shortenLinkForMenu("https://x.dk/M%C3%B8de") === "x.dk/Møde",
    shortenLinkForMenu("https://x.dk/M%C3%B8de")
  );

  // ---- The model ---------------------------------------------------------

  const http = mailLinkMenuModel("https://www.example.org/tickets");
  check(
    "an http link opens and copies as a link",
    http?.kind === "http" &&
      http.openLabel === "Open link" &&
      http.copyLabel === "Copy link" &&
      http.copyText === "https://www.example.org/tickets" &&
      http.shown === "example.org/tickets"
  );

  const mail = mailLinkMenuModel("mailto:team@example.org?subject=Hi");
  check(
    "a mailto shows and copies the bare address, not the subject",
    mail?.kind === "mailto" &&
      mail.copyText === "team@example.org" &&
      mail.shown === "team@example.org" &&
      mail.openLabel === "Write to this address" &&
      mail.copyLabel === "Copy address"
  );

  check(
    "the clipboard gets the full link, not the shortened row",
    mailLinkMenuModel(long)?.copyText === long
  );

  check(
    "anything that is not http(s) or mailto gets no menu",
    mailLinkMenuModel("javascript:alert(1)") === null &&
      mailLinkMenuModel("mailto:") === null &&
      mailLinkMenuModel("#top") === null
  );
});
