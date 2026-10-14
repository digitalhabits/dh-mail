/**
 * "Load more" under a mailbox tab offers only that mailbox's pages.
 *
 * Every visible mailbox is read and the tab narrows what shows, so the
 * cursor held a page for a Gmail still on its first read while the tab
 * showed an Exchange mailbox with one message and nothing more.
 */

import {
  cursorForMailboxScope,
  decodeCursorTokens,
  encodeCursorTokens,
} from "@/components/mail/mail-list-state";
import { check, suite } from "./harness.mjs";

const accounts = ["ex@uni.example", "me@gmail.example"];

suite(async () => {
  const both = encodeCursorTokens({ "me@gmail.example": "1700000000000" });
  check("a tab whose mailbox has no next page offers none",
    cursorForMailboxScope(both, ["ex@uni.example"], accounts) === null);

  const mixed = encodeCursorTokens({ "me@gmail.example": "17", "ex@uni.example": "42" });
  const kept = decodeCursorTokens(cursorForMailboxScope(mixed, ["ex@uni.example"], accounts));
  check("the tab's own page is kept, the hidden one dropped",
    kept["ex@uni.example"] === "42" && !("me@gmail.example" in kept));

  check("All keeps the whole cursor", cursorForMailboxScope(mixed, [], accounts) === mixed);
  check("no cursor stays none", cursorForMailboxScope(null, ["ex@uni.example"], accounts) === null);
});
