/**
 * Snoozed mail comes back on time while its mailbox is paused.
 *
 * A pause holds back new mail; a snooze is the reader's own appointment with
 * mail they have seen. So only the snoozed threads whose time has come are
 * put back into the paused list. All mail here is invented.
 */

import {
  nextWakeWhilePaused,
  wokenWhilePaused,
  withWokenRows,
} from "@/lib/mail/snooze-wake-paused";
import { check, suite } from "./harness.mjs";

const NOW = Date.parse("2026-10-23T09:00:00Z");
const at = (iso) => new Date(Date.parse(iso)).toISOString();

const row = (account, threadId, lastAt, snoozedUntil) => ({
  account,
  threadId,
  subject: `Subject ${threadId}`,
  fromName: "Ann Sender",
  fromEmail: "ann@sender.test",
  snippet: "",
  lastAt: at(lastAt),
  unread: false,
  messageCount: 1,
  tab: "people",
  ...(snoozedUntil ? { snoozedUntil: at(snoozedUntil) } : {}),
});

suite(async () => {
  const snoozed = [
    row("vera@mail.test", "s1", "2026-10-22T16:00:00Z", "2026-10-23T08:00:00Z"),
    row("vera@mail.test", "s2", "2026-10-22T17:00:00Z", "2026-10-23T11:00:00Z"),
    row("vera@other.test", "s3", "2026-10-22T18:00:00Z", "2026-10-23T07:00:00Z"),
  ];

  const woken = wokenWhilePaused(snoozed, ["Vera@Mail.test"], NOW);
  check("a snooze whose time has come wakes", woken.length === 1 && woken[0].threadId === "s1");
  check("it comes back as an inbox row, without its wake time", !("snoozedUntil" in woken[0]));
  check(
    "a mailbox that is not paused is left to its own reads",
    !woken.some((r) => r.account === "vera@other.test")
  );
  check(
    "the next wake is the soonest still to come",
    nextWakeWhilePaused(snoozed, ["vera@mail.test"], NOW) === Date.parse("2026-10-23T11:00:00Z")
  );
  check(
    "nothing to come, nothing to wait for",
    nextWakeWhilePaused(snoozed, ["vera@nobody.test"], NOW) === null
  );

  const list = [
    row("vera@mail.test", "a", "2026-10-23T08:30:00Z"),
    row("vera@mail.test", "b", "2026-10-22T10:00:00Z"),
  ];
  const next = withWokenRows(list, woken);
  check(
    "a woken row goes where its newest message puts it",
    next.map((r) => r.threadId).join(",") === "a,s1,b",
    next.map((r) => r.threadId).join(",")
  );
  check("a row the list already has is left as it is", withWokenRows(next, woken) === next);
  check("the list itself is not changed", list.length === 2);
  const oldest = [row("vera@mail.test", "z", "2026-10-01T10:00:00Z")];
  check(
    "a row older than the whole list goes at the end",
    withWokenRows(list, wokenWhilePaused(
      [row("vera@mail.test", "z", "2026-10-01T10:00:00Z", "2026-10-23T08:00:00Z")],
      ["vera@mail.test"],
      NOW
    )).at(-1).threadId === oldest[0].threadId
  );
});
