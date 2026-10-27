/**
 * The confirmation of an archive, delete, move or snooze stands where the
 * row was, for a while, and the toast is only for when nothing on screen
 * can hold it. Subjects are invented.
 */

import { createUndoSlotStore, describeUndoTargets, placeUndoSlot, UNDO_SLOT_MS } from "@/lib/mail/undo-slot";
import { check, suite } from "./harness.mjs";

/** Timers the suite moves by hand. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    set: (run, ms) => {
      const id = next++;
      pending.set(id, { run, at: now + ms });
      return id;
    },
    clear: (id) => pending.delete(id),
    now: () => now,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

const slot = (id, extra = {}) => ({ id, action: "archive", verb: "Archived", object: id, label: `${id} archived`, lastAt: null, undo: () => {}, ...extra });

suite(async () => {
  // Where it goes.
  const day = (label, date, ...times) => ({ label, items: times.map((t) => ({ lastAt: `${date}T${t}:00Z` })) });
  const groups = [day("today", "2026-10-27", "15:00", "14:00", "13:00"), day("yesterday", "2026-10-26", "20:00")];
  const at = (t) => placeUndoSlot(groups, `2026-10-27T${t}:00Z`);
  check("between the rows it stood between", JSON.stringify(at("14:30")) === JSON.stringify({ group: 0, index: 1 }));
  check("at the top when it was the newest", JSON.stringify(at("16:00")) === JSON.stringify({ group: 0, index: 0 }));
  const lastOfToday = placeUndoSlot(groups, "2026-10-27T12:00:00Z");
  check("the last of its day stays under its own day's heading", JSON.stringify(lastOfToday) === JSON.stringify({ group: 0, index: 3 }));
  const oldest = placeUndoSlot(groups, "2026-10-01T00:00:00Z");
  check("at the end when it was the oldest", JSON.stringify(oldest) === JSON.stringify({ group: 1, index: 1 }));
  check("nowhere in an empty list", placeUndoSlot([], "2026-10-27T12:00:00Z") === null);
  const withPinned = [{ pinned: true, items: [{ lastAt: "2026-10-01T00:00:00Z" }] }, ...groups];
  const skipped = placeUndoSlot(withPinned, "2026-10-27T14:30:00Z", (g) => Boolean(g.pinned));
  check("never in the pinned band", JSON.stringify(skipped) === JSON.stringify({ group: 1, index: 1 }));

  // What it names.
  const words = {
    conversations: (n) => (n === 1 ? "1 conversation" : `${n} conversations`),
    stack: (name, n) => `${name} stack (${n})`,
    and: "and",
  };
  const stacks = [
    { name: "GitHub", keys: ["g1", "g2", "g3", "g4", "g5"] },
    { name: "Google Ads", keys: ["a1", "a2", "a3"] },
    { name: "Asta", keys: ["s1"] },
    { name: "Bo", keys: ["b1"] },
    { name: "Cy", keys: ["c1", "c2"] },
    { name: "Dan", keys: ["d1", "d2"] },
  ];
  const say = (keys, s = stacks) => describeUndoTargets(keys, s, words);
  check("a whole stack is named", say(["g1", "g2", "g3", "g4", "g5"]) === "GitHub stack (5)");
  check(
    "single conversations are counted, then the stack",
    say(["s1", "b1", "c1", "a1", "a2", "a3"]) === "3 conversations and Google Ads stack (3)"
  );
  check("part of a stack is counted as conversations", say(["g1", "g2", "b1"]) === "3 conversations");
  check(
    "two stacks are both named",
    say(["g1", "g2", "g3", "g4", "g5", "a1", "a2", "a3", "s1"]) === "1 conversation, GitHub stack (5) and Google Ads stack (3)"
  );
  check(
    "more than two stacks is the count",
    say(["a1", "a2", "a3", "c1", "c2", "d1", "d2"]) === "7 conversations"
  );
  check("the conversation view has no stacks", say(["g1", "g2"], null) === "2 conversations");

  // How long it stays.
  {
    const timers = fakeTimers();
    const store = createUndoSlotStore(timers);
    const leave = store.mount("list");
    store.show(slot("a"));
    timers.advance(UNDO_SLOT_MS - 1);
    check("it stays for its time", store.get().slot?.id === "a");
    timers.advance(1);
    check("and then goes", store.get().slot === null);
    leave();
  }
  {
    const timers = fakeTimers();
    const store = createUndoSlotStore(timers);
    store.mount("list");
    store.show(slot("a"));
    timers.advance(5000);
    store.hold(true);
    timers.advance(60000);
    check("the time stops while the pointer is on it", store.get().slot?.id === "a");
    store.hold(false);
    timers.advance(2999);
    check("and goes on from where it was", store.get().slot?.id === "a");
    timers.advance(1);
    check("then it goes", store.get().slot === null);
  }
  {
    const timers = fakeTimers();
    const store = createUndoSlotStore(timers);
    store.mount("list");
    store.show(slot("a"));
    timers.advance(3000);
    store.show(slot("b"));
    check("they stack, newest on top", store.get().slots.map((x) => x.id).join() === "b,a" && store.get().slot?.id === "b");
    timers.advance(UNDO_SLOT_MS - 3000);
    check("each goes after its own time", store.get().slots.map((x) => x.id).join() === "b");
    store.show(slot("c"));
    store.hold(true);
    timers.advance(60000);
    check("the pointer on the stack stops every time", store.get().slots.map((x) => x.id).join() === "c,b");
    store.hold(false);
    store.clear("c");
    check("an undo takes that one away, and the next is on top", store.get().slot?.id === "b");
    store.clear();
    check("clear with no name takes them all", store.get().slots.length === 0);
    for (const id of ["1", "2", "3", "4", "5", "6", "7"]) store.show(slot(id));
    check("the stack holds five", store.get().slots.map((x) => x.id).join() === "7,6,5,4,3");
  }

  // Where it is drawn.
  {
    const timers = fakeTimers();
    const store = createUndoSlotStore(timers);
    const toasts = [];
    store.setFallback((s) => {
      toasts.push(s.id);
      return () => toasts.splice(toasts.indexOf(s.id), 1);
    });
    const leaveList = store.mount("list");
    store.show(slot("a"));
    timers.advance(100);
    check("no toast while a list holds it", toasts.length === 0);
    leaveList();
    const leaveStrip = store.mount("strip");
    store.show(slot("b"));
    timers.advance(100);
    check("no toast while the reader's toolbar holds it", toasts.length === 0);
    leaveStrip();
    store.clear();
    store.show(slot("c"));
    timers.advance(100);
    check("the toast when nothing on screen can hold it", toasts.join() === "c");
    store.clear("c");
    check("and the toast goes with it", toasts.length === 0);
  }
});
