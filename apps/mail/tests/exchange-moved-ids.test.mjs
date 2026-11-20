/**
 * The id an Exchange item has after this app moved it.
 *
 * The server gives an item a new id at each move. An open conversation
 * keeps the old one, and in a paused mailbox it is not read again. A file
 * of a mail that woke from a snooze there was asked for by an id the server
 * no longer knew. The app now asks by the id the item has.
 */

import {
  currentExchangeItemId,
  forgetExchangeMoves,
  noteExchangeItemMoved,
} from "@/lib/mail/exchange-moved-ids";

import { check, suite } from "./harness.mjs";

suite(async () => {
  forgetExchangeMoves();
  const box = "vera@college.example";

  check("an item that did not move keeps its id", currentExchangeItemId(box, "inbox-1") === "inbox-1");

  // Snoozed, and then woken: two moves.
  noteExchangeItemMoved(box, "inbox-1", "snoozed-1");
  check("after one move, the old id gives the new one", currentExchangeItemId(box, "inbox-1") === "snoozed-1");
  noteExchangeItemMoved(box, "snoozed-1", "inbox-2");
  check("after two moves, the first id gives the newest one", currentExchangeItemId(box, "inbox-1") === "inbox-2");
  check("and the middle id too", currentExchangeItemId(box, "snoozed-1") === "inbox-2");
  check("the newest id stays as it is", currentExchangeItemId(box, "inbox-2") === "inbox-2");

  check("the mailbox is matched in any case", currentExchangeItemId("Vera@College.Example", "inbox-1") === "inbox-2");
  check("another mailbox's item with the same id is not this one", currentExchangeItemId("oskar@college.example", "inbox-1") === "inbox-1");

  // A server that gives an old id again must not make the app go round.
  noteExchangeItemMoved(box, "a", "b");
  noteExchangeItemMoved(box, "b", "a");
  check("ids that point at each other end", ["a", "b"].includes(currentExchangeItemId(box, "a")));

  noteExchangeItemMoved(box, "same", "same");
  check("a move to the same id is not kept", currentExchangeItemId(box, "same") === "same");
});
