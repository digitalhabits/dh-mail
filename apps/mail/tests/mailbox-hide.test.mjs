/**
 * Hiding a mailbox for a while: by a time, by a weekly schedule, and the
 * rule that a clock never shows a mailbox somebody hid by hand.
 */

import {
  hideStep,
  mailboxHideVerdict,
  readHideState,
  scheduleWindowEnd,
  shownEarlyEnd,
  shownEarlyUntil,
  hideAgainEndsShow,
  hideAgainFor,
  showWordsFor,
} from "@/lib/mail/mailbox-hide";

import { keptFromOnHours } from "@/lib/mail/account-rhythm";
import { check, suite } from "./harness.mjs";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const at = (h, m = 0) => new Date(2026, 9, 5, h, m); // a Monday
const evenings = { hours: [{ start: "18:00", end: "08:00", days: EVERY_DAY }] };

suite(async () => {
  check("no row: not hidden", !mailboxHideVerdict(undefined, at(12)).hidden);

  const timed = { hiddenUntil: at(15).getTime() };
  const v = mailboxHideVerdict(timed, at(14));
  check("hidden until a time", v.hidden && v.reason === "until" && v.untilClock === "15:00", JSON.stringify(v));
  check("and shown after it", !mailboxHideVerdict(timed, at(15, 1)).hidden);

  check("hidden inside a schedule window", mailboxHideVerdict(evenings, at(21)).reason === "schedule");
  check("across midnight too", mailboxHideVerdict(evenings, at(2)).hidden);
  check("and not outside it", !mailboxHideVerdict(evenings, at(12)).hidden);
  check("it says when the window ends", mailboxHideVerdict(evenings, at(21)).untilClock === "08:00");

  const end = scheduleWindowEnd(evenings.hours, at(21));
  check("the window's end, as a moment", end === new Date(2026, 9, 6, 8, 0).getTime(), new Date(end ?? 0).toString());
  check("no window, no end", scheduleWindowEnd(evenings.hours, at(12)) === null);
  const shownEarly = { ...evenings, shownUntil: end };
  check("shown early inside a window stays shown till it ends", !mailboxHideVerdict(shownEarly, at(23)).hidden);
  check("and the next window hides it again", mailboxHideVerdict(shownEarly, new Date(2026, 9, 6, 19)).hidden);
  // Shown early, the menu offers the schedule back, until the window ends.
  check("shown early says when its window ends", shownEarlyUntil(shownEarly, at(23)) === "08:00", shownEarlyUntil(shownEarly, at(23)));
  check("not outside a window", shownEarlyUntil(shownEarly, new Date(2026, 9, 6, 12)) === null);
  check("not when it was never shown early", shownEarlyUntil(evenings, at(23)) === null);
  const { shownUntil: _dropped, ...resumed } = shownEarly;
  check("the schedule back: hidden again at once", hideStep(resumed, true, at(23)) === "hide");

  // What the page does to the "in Mail" flag.
  check("a time hides a shown mailbox", hideStep(timed, true, at(14)) === "hide");
  check("its end shows it, when this machine hid it", hideStep({ ...timed, autoHidden: true }, false, at(16)) === "show");
  check("but never one hidden by hand", hideStep(timed, false, at(16)) === null);
  check("nor one with no row at all", hideStep(undefined, false, at(16)) === null);
  check("nothing to do while it agrees", hideStep({ ...timed, autoHidden: true }, false, at(14)) === null);

  const read = readHideState({
    accounts: { "Alma@Example.org": { hiddenUntil: 5, autoHidden: true, hours: [{ start: "18:00", end: "08:00", days: [1] }, { start: "x" }] }, bad: "y" },
    showWords: 7,
  });
  check("stored state is read by lower-case address", Boolean(read.accounts["alma@example.org"]));
  check("with only the well-formed windows", read.accounts["alma@example.org"].hours.length === 1);
  check("and the friction count", read.showWords === 7);
  check("rubbish is no state", Object.keys(readHideState("nope").accounts).length === 0);

  // Hide again after: an early show is cut short.
  const noon = at(12);
  const in10 = noon.getTime() + 10 * 60_000;
  check("with Never, shown early lasts until its own end", shownEarlyEnd(at(14).getTime(), 0, noon) === at(14).getTime());
  check("with 10 minutes, it hides again after 10", shownEarlyEnd(at(14).getTime(), 10, noon) === in10);
  check("its own end comes first when sooner", shownEarlyEnd(at(12, 5).getTime(), 10, noon) === at(12, 5).getTime());
  check("Never and no end of its own: nothing hides it", shownEarlyEnd(null, 0, noon) === null);
  const untilTwo = { hiddenUntil: at(14).getTime(), shownUntil: in10 };
  check("hidden until 14:00, shown early: not hidden now", !mailboxHideVerdict(untilTwo, at(12, 5)).hidden);
  check("and hidden again once the 10 minutes are up", mailboxHideVerdict(untilTwo, at(12, 11)).hidden);
  check("so the clock hides it again", hideStep(untilTwo, true, at(12, 11)) === "hide");
  const cut = { ...evenings, shownUntil: at(20, 10).getTime() };
  check("shown early in a window, hidden again when the cut runs out", mailboxHideVerdict(cut, at(20, 11)).hidden);
  check("the setting is read when it is one of the menu's", readHideState({ accounts: {}, hideAgainMinutes: 30 }).hideAgainMinutes === 30);
  check("and dropped when it is not", readHideState({ accounts: {}, hideAgainMinutes: 7 }).hideAgainMinutes === undefined);

  // The question before an early show names how long, when the cut ends it.
  const t0 = new Date(2026, 9, 17, 9, 0);
  const inMinutes = (m) => t0.getTime() + m * 60_000;
  check("15 minutes, with the schedule ending in 2 hours: the cut ends it", hideAgainEndsShow(inMinutes(120), 15, t0));
  check("15 minutes, with the schedule ending in 10: the schedule ends it", !hideAgainEndsShow(inMinutes(10), 15, t0));
  check("15 minutes, with no end of its own: the cut ends it", hideAgainEndsShow(null, 15, t0));
  check("Never: nothing to name", !hideAgainEndsShow(inMinutes(120), 0, t0));

  // Shown weekdays 07:00 – 18:00, kept as the hours hidden: a night is two
  // windows, "18:00 – 00:00" and "00:00 – 07:00" the day after.
  const workHidden = keptFromOnHours([{ start: "07:00", end: "18:00", days: [0, 1, 2, 3, 4] }]);
  const tuesdayNight = new Date(2026, 9, 6, 23, 0); // 6 Oct 2026 is a Tuesday
  const night = mailboxHideVerdict({ hours: workHidden }, tuesdayNight);
  check("hidden on Tuesday night", night.hidden && night.reason === "schedule");
  check("shown again at 07:00, not at midnight", night.untilClock === "07:00", night.untilClock);
  check("on Wednesday morning", night.endsAt?.getDate() === 7 && night.endsAt?.getHours() === 7, String(night.endsAt));
  const friday = mailboxHideVerdict({ hours: workHidden }, new Date(2026, 9, 9, 19, 0));
  check("on Friday evening, shown again on Monday at 07:00", friday.endsAt?.getDate() === 12 && friday.untilClock === "07:00", String(friday.endsAt));
  check("so showing it now lasts until then", scheduleWindowEnd(workHidden, tuesdayNight) === night.endsAt.getTime());

  // Each account can have its own words and "Hide again after".
  const own = readHideState({ showWords: 20, hideAgainMinutes: 15, accounts: { "a@x.example": { showWords: 0 }, "b@x.example": { hideAgainMinutes: 60 } } });
  check("an account's own words are kept, 0 too", own.accounts["a@x.example"].showWords === 0);
  check("its words are its own", showWordsFor(own, "a@x.example") === 0);
  check("another's are every account's", showWordsFor(own, "b@x.example") === 20 && showWordsFor(own, "c@x.example") === 20);
  check("and its own Hide again after", hideAgainFor(own, "b@x.example") === 60 && hideAgainFor(own, "a@x.example") === 15);
});
