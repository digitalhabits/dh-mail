/**
 * The words of the "You forwarded this" strip (lib/mail/forward-words.ts):
 * who it went to and when. Invented names and addresses only.
 */

import { forwardedWho, forwardedWords, rowMarkKind, stripLines } from "@/lib/mail/forward-words";
import { en } from "@/lib/mail/i18n-en";

import { check, suite } from "./harness.mjs";

/** The English dictionary as the page's `t`. */
const t = (key, values = {}) =>
  String(en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

const now = new Date(2026, 10, 17, 16, 0);
const at = (day, h, m) => new Date(2026, 10, day, h, m).getTime();
const link = (sentAt, to) => ({ threadId: "t-forward", messageId: "f1", sentAt, to });

suite(async () => {
  const sigrid = { name: "Sigrid Sten", email: "sigrid@workshop.example" };
  const tove = { name: "Tove Holm", email: "tove@harbour.example" };
  const bare = { name: "", email: "olaf@yard.example" };

  check("one person is named", forwardedWho([sigrid], t) === "Sigrid Sten");
  check("a person with no name is their address", forwardedWho([bare], t) === "olaf@yard.example");
  check("two are joined with and", forwardedWho([sigrid, tove], t) === "Sigrid Sten and Tove Holm");
  check(
    "more than two: the first two and a count",
    forwardedWho([sigrid, tove, bare, bare], t) === "Sigrid Sten, Tove Holm and 2 more",
    forwardedWho([sigrid, tove, bare, bare], t)
  );

  const today = forwardedWords(link(at(17, 15, 25), [sigrid]), t, now);
  check("a forward of today says today and the time", today.startsWith("You forwarded this to Sigrid Sten today at ") && today.includes("25"), today);
  const earlier = forwardedWords(link(at(12, 9, 5), [sigrid]), t, now);
  check("an earlier one says the date", earlier.includes("Sigrid Sten on ") && earlier.includes("12") && !earlier.includes("today"), earlier);
  const nobody = forwardedWords(link(at(17, 15, 25), []), t, now);
  check("with no recipient kept, it still says when", nobody.startsWith("You forwarded this today at "), nobody);

  // A reply under a new subject.
  const reply = { ...link(at(17, 16, 2), [sigrid]), kind: "reply", subject: "A signature for the plans" };
  const said = forwardedWords(reply, t, now);
  check("a reply under a new subject says so", said.startsWith("You replied to Sigrid Sten under a new subject today at "), said);

  const lines = stripLines([
    { ...link(at(12, 9, 0), [sigrid]), kind: "forward" },
    { ...link(at(17, 15, 42), [tove]), kind: "forward" },
    reply,
  ]);
  check("the strip has the newest forward and the newest reply, the newer first",
    lines.length === 2 && lines[0].kind === "reply" && lines[1].to[0].name === "Tove Holm");
  check("a link with no kind, from an older shell, is a forward", stripLines([link(at(17, 15, 42), [tove])]).length === 1);

  check("a row with neither action has no arrow", rowMarkKind(undefined, undefined) === null);
  check("forwarded only: the forward arrow", rowMarkKind("2026-11-17T15:42:00Z", undefined) === "forward");
  check("answered later than forwarded: the reply arrow", rowMarkKind("2026-11-17T15:42:00Z", "2026-11-17T16:02:00Z") === "reply");
  check("forwarded later than answered: the forward arrow", rowMarkKind("2026-11-17T16:30:00Z", "2026-11-17T16:02:00Z") === "forward");
});
