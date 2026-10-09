/**
 * The message a thread opens on: the first of the unread messages at the
 * end, not an old unread one in the middle. Ids are invented.
 */

import { openLandingMessageId } from "@/lib/mail/open-landing";
import { check, suite } from "./harness.mjs";

const m = (id, unread = false) => ({ id, unread });

suite(async () => {
  check("all read: the newest",
    openLandingMessageId([m("a"), m("b"), m("c")], "c") === "c");
  check("the newest unread: it",
    openLandingMessageId([m("a"), m("b"), m("c", true)], "c") === "c");
  check("two new at the end: the first of them",
    openLandingMessageId([m("a"), m("b", true), m("c", true)], "c") === "b");
  check("an old unread in the middle is passed over",
    openLandingMessageId([m("a"), m("b", true), m("c"), m("d", true)], "d") === "d");
  check("and when the end is read, the newest",
    openLandingMessageId([m("a", true), m("b"), m("c")], "c") === "c");
  check("all unread: the first",
    openLandingMessageId([m("a", true), m("b", true)], "b") === "a");
  check("no messages: the newest id given",
    openLandingMessageId([], "x") === "x");
});
