/**
 * The empty reply box names the first person a reply goes to, and how many
 * more. A reply-all used to list every name, which ran to three lines and
 * was cut off anyway.
 */

import { replyPlaceholder, replyPlaceholderNames } from "@/lib/mail/reply-placeholder";

import { check, suite } from "./harness.mjs";

const person = (name, email) => ({ kind: "person", name, email });

suite(async () => {
  check("one person is named", replyPlaceholder(["Anton Asmund"], "the thread") === "Reply to Anton Asmund");
  check(
    "two is the first and 1 other",
    replyPlaceholder(["Anton Asmund", "Frida Fisker"], "the thread") === "Reply to Anton Asmund and 1 other"
  );
  const seven = ["Anton Asmund", "Benny Björg", "Frida Fisker", "Jens Jordbær", "Kanin Kunsthal", "Gustav Gulerod", "Dorte Dennis"];
  check(
    "seven is the first and 6 others",
    replyPlaceholder(seven, "the thread") === "Reply to Anton Asmund and 6 others",
    replyPlaceholder(seven, "the thread")
  );
  check("nobody yet falls back to the thread", replyPlaceholder([], "the thread") === "Reply to the thread…");

  // The first name is the first recipient, named from the thread where a
  // name is known, and never the mailbox the reply leaves from.
  const names = replyPlaceholderNames({
    toList: [person("", "vera@vaerksted.example"), person("", "anton@invented.example"), person("", "frida@invented.example")],
    ccList: [person("Benny", "benny@bjorg.example")],
    messages: [{ fromName: "Anton Asmund", fromEmail: "anton@invented.example", own: false }],
    account: "vera@vaerksted.example",
  });
  check(
    "the count leaves out the mailbox you reply from",
    replyPlaceholder(names, "the thread") === "Reply to Anton Asmund and 2 others",
    replyPlaceholder(names, "the thread")
  );
});
