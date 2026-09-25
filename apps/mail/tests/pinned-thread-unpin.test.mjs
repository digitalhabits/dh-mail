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

import { toggleMailPin, listMailPins, isMailPinned } from "@/lib/mail/pins";
import { findCachedThread, writeCachedList } from "@/lib/mail/list-cache";

import { check, suite } from "./harness.mjs";
import { mailPageSource } from "./mail-page-source.mjs";

const page = mailPageSource();

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
    "matched by the thread it is on, and by one rule for all three",
    handler.includes("t.account === selected.account") &&
      handler.includes("t.threadId === selected.threadId") &&
      handler.includes("pins.find(mine)?.summary"),
    handler.includes("const mine =") ? "one predicate" : "three"
  );
  check(
    "and failing both, any list this viewer has already read",
    handler.includes("findCachedThread(viewerId, mine)"),
    handler.includes("findCachedThread") ? "looks in the cache" : "gives up"
  );
  check(
    "and a thread in none of the three is still told why",
    page.includes('else toast("Open it from the list to pin it");')
  );

  /*
    Archiving and deleting take the pin off, Undo puts it back, and a
    refused archive keeps it: walked in mounted-list-actions, which drives
    them in the page rather than reading the lines that do them.
  */

  /*
    The store's half: a summary is all it takes either way, so the one the
    pin kept unpins the thread exactly as the list row would have.
  */
  /*
    The cache's half: a thread older than the page the list has loaded is
    in no list on screen, but it is in one the viewer has already read.
  */
  const VIEWER = "pin-viewer";
  const mine = (t) =>
    t.account === SUMMARY.account && t.threadId === SUMMARY.threadId;
  check(
    "a thread nobody has read is not in the cache",
    findCachedThread(VIEWER, mine) === null
  );
  writeCachedList(VIEWER, "inbox|", { threads: [SUMMARY], nextCursor: null });
  check(
    "one from a list already read is found",
    findCachedThread(VIEWER, mine)?.threadId === SUMMARY.threadId
  );
  check(
    "but not for another viewer, whose lists are their own",
    findCachedThread("somebody-else", mine) === null
  );
  writeCachedList(VIEWER, "search|tiago", { threads: [], nextCursor: null });
  check(
    "an empty list does not hide one that has it",
    findCachedThread(VIEWER, mine)?.threadId === SUMMARY.threadId
  );

  check("a thread starts unpinned", isMailPinned(SUMMARY) === false);
  check("pinning it says so", toggleMailPin(SUMMARY) === true);
  check("and it is on the list", listMailPins().length === 1);
  // The summary the band kept, handed back: a different object, same thread.
  const kept = { ...listMailPins()[0].summary };
  check("unpinning by the kept summary says so", toggleMailPin(kept) === false);
  check("and the list is empty again", listMailPins().length === 0);
  check("so the band has nothing left to draw", isMailPinned(SUMMARY) === false);
});
