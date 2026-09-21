/**
 * A pinned thread can always be unpinned.
 *
 * The pinned band draws a thread from the list row when the list holds
 * one, and from the summary the pin itself kept when it does not. Archive
 * a pinned thread and the second case is where it lands: it leaves the
 * flow list, and the band goes on drawing it.
 *
 * The pin button in the reader looked the thread up in the flow list
 * alone. So on exactly that thread it found nothing, refused, and told the
 * reader to open from the list a thread that was open and in the list. It
 * could not be unpinned — and since archiving did not take it off the
 * band either, it could not be got rid of at all.
 *
 * Read as text: the lookup is a line inside a React handler. What the
 * store does with a summary is checked below it, where it can be run.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { toggleMailPin, listMailPins, isMailPinned } from "@/lib/mail/pins";

import { check, suite } from "./harness.mjs";

const page = readFileSync(
  join(
    process.cwd(),
    "../../products/mail/packages/mail/components/mail/MailPage.tsx"
  ),
  "utf8"
);

/** Invented, and shaped like a row the list would hand over. */
const SUMMARY = {
  account: "vera@example.com",
  threadId: "booking-1",
  subject: "Your room is confirmed",
  fromName: "Rooms",
  fromEmail: "rooms@example.test",
  snippet: "Tuesday the eighth.",
  lastAt: "2026-09-08T09:00:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [],
};

suite(async () => {
  const handler = page.slice(
    page.indexOf("onTogglePin={() => {"),
    page.indexOf('else toast("Open it from the list to pin it");')
  );
  check(
    "the reader's pin falls back to the summary the pin kept",
    handler.includes("pins.find(") && handler.includes("?.summary"),
    handler.includes("selectedRow ??") ? "falls back" : "list row only"
  );
  check(
    "matched by the thread it is on, as the band matches it",
    handler.includes("pin.account === selected.account") &&
      handler.includes("pin.threadId === selected.threadId")
  );
  check(
    "and a thread with no row and no pin is still told why",
    page.includes('else toast("Open it from the list to pin it");')
  );

  /*
    Archiving takes the pin off, because a pin is a shortcut to something
    in the inbox. Trash already did; archive was the odd one out, and the
    band went on drawing the thread from the summary the pin kept.
  */
  check(
    "archiving takes the pin off",
    page.includes("const wasPinned = isMailPinned(t.account, t.threadId);") &&
      page.includes("if (wasPinned) unpinMailThread(t.account, t.threadId);")
  );
  check(
    "trash still does too, and notes it before it does",
    page.includes(
      "const wasPinned = copies.some((c) => isMailPinned(c.account, c.threadId));"
    )
  );
  check(
    "and undo puts the pin back with the conversation",
    page.includes("if (undo.wasPinned) pinMailThread(undo.summary);")
  );
  check(
    "as does an archive or a delete that failed",
    (page.match(/if \(wasPinned && summary\) pinMailThread\(summary\);/g) ?? [])
      .length === 2
  );

  /*
    The store's half: a summary is all it takes either way, so the one the
    pin kept unpins the thread exactly as the list row would have.
  */
  check("a thread starts unpinned", isMailPinned(SUMMARY) === false);
  check("pinning it says so", toggleMailPin(SUMMARY) === true);
  check("and it is on the list", listMailPins().length === 1);
  // The summary the band kept, handed back: a different object, same thread.
  const kept = { ...listMailPins()[0].summary };
  check("unpinning by the kept summary says so", toggleMailPin(kept) === false);
  check("and the list is empty again", listMailPins().length === 0);
  check("so the band has nothing left to draw", isMailPinned(SUMMARY) === false);
});
