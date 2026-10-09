/**
 * Which pile a conversation goes in, and who it is with.
 *
 * One rule for every provider. Gmail, Outlook and the snoozed list each used
 * to carry a copy, so a row could file one way in the inbox and another way
 * once it was snoozed. These checks are the rule itself, on plain addresses.
 */

import { classifyThread, displayName } from "@/lib/mail/thread-classify";
import { check, suite } from "./harness.mjs";

const ME = "me@example.com";
const ALMA = { name: "Alma Aagaard", email: "alma@example.org" };
const NEWS = { name: "", email: "news@example.net" };

/** A classifier that knows Alma and nobody else, with no domain matching. */
const classifier = {
  contacts: new Map([[ALMA.email, [{ recordName: "Alma Aagaard" }]]]),
  domains: new Map(),
};

const me = { name: "Me", email: ME };

suite(async () => {
  // ---- The pile ------------------------------------------------------------
  let out = classifyThread({
    accountEmail: ME,
    participants: [ALMA, me],
    senders: [ALMA],
    latestFrom: ALMA,
    latestTo: [me],
    classifier,
  });
  check("a known contact files under People", out.tab === "people", out.tab);
  check("and is the counterpart", out.counterpart.email === ALMA.email);

  out = classifyThread({
    accountEmail: ME,
    participants: [NEWS, me],
    senders: [NEWS],
    latestFrom: NEWS,
    latestTo: [me],
    classifier,
  });
  check("a stranger files under Other", out.tab === "other", out.tab);
  check("a name-less sender shows as the address", displayName(out.counterpart) === NEWS.email);

  // ---- A note to yourself --------------------------------------------------
  out = classifyThread({
    accountEmail: ME,
    participants: [me, me],
    senders: [me],
    latestFrom: me,
    latestTo: [me],
    classifier,
  });
  check("a note to yourself is yours, so it is People", out.tab === "people", out.tab);
  check("with the mailbox as the counterpart", out.counterpart.email === ME);
  check("and nobody outside", out.externalParticipants.length === 0);

  // ---- Sent mail faces the recipient ----------------------------------------
  out = classifyThread({
    accountEmail: ME,
    participants: [me, ALMA, NEWS],
    senders: [me],
    latestFrom: me,
    latestTo: [ALMA, NEWS],
    classifier,
  });
  check(
    "when we wrote last, the row faces the first person we wrote to",
    out.counterpart.email === ALMA.email,
    out.counterpart.email
  );

  // ---- One entry per outside address ---------------------------------------
  out = classifyThread({
    accountEmail: ME,
    participants: [
      { name: "", email: ALMA.email },
      me,
      ALMA,
      { name: "", email: ALMA.email },
    ],
    senders: [ALMA],
    latestFrom: ALMA,
    latestTo: [me],
    classifier,
  });
  check("an address on three envelopes is listed once", out.externalParticipants.length === 1);
  check(
    "and a name seen on any of them wins over none",
    out.externalParticipants[0].name === "Alma Aagaard",
    out.externalParticipants[0].name
  );
  check("our own address is never among the outsiders",
    !out.externalParticipants.some((p) => p.email === ME));

  // ---- Empty envelopes -----------------------------------------------------
  out = classifyThread({
    accountEmail: ME,
    participants: [{ name: "", email: "" }],
    senders: [{ name: "", email: "" }],
    latestFrom: { name: "", email: "" },
    latestTo: [],
    classifier,
  });
  check("a message with no addresses falls back to the mailbox",
    out.counterpart.email === ME, out.counterpart.email);
});
