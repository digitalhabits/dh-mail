/**
 * The thread's heading shows a mailbox of yours as its tab: the mark and
 * the short name. An address of yours that is not connected here (it only
 * sent mail) has no tab, so it must not be drawn as one. A college
 * address with the same local part as the Gmail tab read as that tab,
 * with Gmail's mark (2026-10-16).
 */

import { participantsWithAddresses } from "@/lib/mail/thread-heading-people";

import { check, suite } from "./harness.mjs";

const mailbox = "me@work.example";
const alias = "me@college.example";

suite(async () => {
  const messages = [
    {
      fromEmail: alias,
      fromName: "Me",
      own: true,
      toEmails: ["jim@uni.example"],
      ccEmails: [],
    },
  ];
  const chunks = participantsWithAddresses(messages, [mailbox], mailbox);
  const you = chunks.find((c) => c.kind === "you");
  check("both of your addresses are on the line", you?.emails.length === 2, JSON.stringify(you));
  check("the connected mailbox is known as one", you?.mailboxes?.includes(mailbox) === true);
  check("the address that only sent mail is not", you?.mailboxes?.includes(alias) === false);
});
