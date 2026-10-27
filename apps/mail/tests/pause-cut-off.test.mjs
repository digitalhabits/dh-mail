/**
 * A paused mailbox is searched, and its threads read, as they were when the
 * pause began. Old mail stays findable; mail the pause holds back does not
 * show, and the reader's own mail always does. All addresses are invented.
 */

import { cutOffFor, shownUnderCutOff } from "@/lib/mail/pause-cut-off";
import { check, suite } from "./harness.mjs";

const NOW = new Date("2026-10-27T10:00:00Z");
const LIVE = { "vera@mail.test": Date.parse("2026-10-27T08:00:00Z") };

suite(async () => {
  const paused = { pausedUntil: Date.parse("2026-10-27T12:00:00Z"), quietHours: [] };
  const open = { quietHours: [] };

  check("a paused mailbox is cut off at its last live read", cutOffFor(paused, LIVE, "Vera@Mail.test", NOW) === LIVE["vera@mail.test"]);
  check("a mailbox that is not paused is not cut off", cutOffFor(open, LIVE, "vera@mail.test", NOW) === null);
  check("a pause that has ended cuts nothing", cutOffFor(paused, LIVE, "vera@mail.test", new Date("2026-10-27T13:00:00Z")) === null);
  check("a mailbox never read live has no cut-off", cutOffFor(paused, LIVE, "bo@mail.test", NOW) === null);

  const cut = LIVE["vera@mail.test"];
  check("mail from before the cut-off shows", shownUnderCutOff({ sentAt: cut - 1, own: false }, cut));
  check("mail that came in after it does not", !shownUnderCutOff({ sentAt: cut + 1, own: false }, cut));
  check("the reader's own mail always shows", shownUnderCutOff({ sentAt: cut + 1, own: true }, cut));
  check("with no cut-off, everything shows", shownUnderCutOff({ sentAt: cut + 1, own: false }, null));
});
