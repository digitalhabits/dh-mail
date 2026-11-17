/**
 * A reply window hands its message to the main window to send. The message
 * must go one time: the two windows agree through one stored row, and only
 * the window that the row names sends. Messages are invented.
 */

import {
  claimHandover,
  memoryHandoverRows,
  offerHandover,
  offerSendHandover,
  takeAnnouncedHandover,
  withdrawHandover,
} from "@/lib/mail/send-handover";
import { check, suite } from "./harness.mjs";

const MESSAGE = { to: ["asta@haveklub.example"], subject: "Re: Plant sale on the square", body: "The long table is in the shed." };

/** A clock that `sleep` moves, so three seconds take no time. */
function fakeClock() {
  let now = 1_000;
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms;
      // A turn of the event loop, so the other window's work can run.
      return new Promise((resolve) => setImmediate(resolve));
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

/** The main window: it takes what it is told of, and counts what it sends. */
function mainWindow(rows, clock) {
  const seen = new Set();
  const sent = [];
  return {
    sent,
    hear: async (id) => {
      const message = await takeAnnouncedHandover({ rows, id, seen, now: clock.now });
      if (message) sent.push(message);
      return message;
    },
  };
}

suite(async () => {
  // Offer, claim, close: the main window sends, the reply window does not.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    const main = mainWindow(rows, clock);
    const popoutSent = [];
    const result = await offerSendHandover({
      rows,
      id: "h1",
      payload: MESSAGE,
      announce: (id) => void main.hear(id),
      now: clock.now,
      sleep: clock.sleep,
    });
    if (result === "kept") popoutSent.push(MESSAGE);
    check("an offer that the main window takes is 'taken'", result === "taken", result);
    check("the main window sends it one time", main.sent.length === 1, main.sent.length);
    check("the reply window sends nothing", popoutSent.length === 0);
    check("the message is whole", JSON.stringify(main.sent[0]) === JSON.stringify(MESSAGE));
    check("the row keeps no copy of the message after the claim", rows.all()[0].payload === null && rows.all()[0].state === "claimed");

    // The same announcement again, and a new window's claim of the same id.
    await main.hear("h1");
    check("a second announcement of the same id sends nothing", main.sent.length === 1);
    const again = await claimHandover(rows, "h1", { now: clock.now });
    check("a second claim of the same id gives nothing", again === null);
    const other = mainWindow(rows, clock);
    await other.hear("h1");
    check("a window that did not see the first claim gets nothing", other.sent.length === 0);
    check("a withdrawal after the claim says 'claimed'", (await withdrawHandover(rows, "h1")) === "claimed");
  }

  // Nobody answers: the offer is withdrawn, and the reply window sends.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    const main = mainWindow(rows, clock);
    let announcedId = null;
    const start = clock.now();
    const result = await offerSendHandover({
      rows,
      id: "h2",
      payload: MESSAGE,
      announce: (id) => {
        announcedId = id;
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    check("an offer that nobody takes is 'kept'", result === "kept", result);
    check("after the three seconds", clock.now() - start >= 3000, clock.now() - start);
    check("the row is withdrawn, with no message", rows.all()[0].state === "withdrawn" && rows.all()[0].payload === null);
    // The main window hears of it late.
    await main.hear(announcedId);
    check("a late main window does not send a withdrawn offer", main.sent.length === 0);
    check("a late claim gives nothing", (await claimHandover(rows, "h2", { now: clock.now })) === null);
  }

  // No main window, or an older shell: nobody was told, so no wait.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    const start = clock.now();
    const result = await offerSendHandover({
      rows,
      id: "h3",
      payload: MESSAGE,
      announce: () => Promise.reject(new Error("No main window")),
      now: clock.now,
      sleep: clock.sleep,
    });
    check("an announcement that fails is 'kept'", result === "kept", result);
    check("with no wait", clock.now() === start);
    check("and the offer is closed", (await claimHandover(rows, "h3", { now: clock.now })) === null);
  }

  // The claim comes at the last moment: the withdrawal sees it.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    const main = mainWindow(rows, clock);
    let reads = 0;
    const racing = {
      ...rows,
      read: async (id) => {
        reads += 1;
        return rows.read(id);
      },
      update: async (id, change) => {
        // The main window's claim lands after the last look and before
        // the withdrawal.
        if (reads > 0 && clock.now() >= 4_000 && !main.sent.length) await main.hear(id);
        return rows.update(id, change);
      },
    };
    const result = await offerSendHandover({ rows: racing, id: "h4", payload: MESSAGE, announce: () => {}, now: clock.now, sleep: clock.sleep });
    check("a claim that lands before the withdrawal is 'taken'", result === "taken", result);
    check("and only the main window sends", main.sent.length === 1);
  }

  // Both at the same moment, many times: one winner each time.
  {
    let both = 0;
    let none = 0;
    for (let i = 0; i < 200; i++) {
      const rows = memoryHandoverRows();
      await offerHandover(rows, "race", MESSAGE);
      const pair = i % 2
        ? [claimHandover(rows, "race"), withdrawHandover(rows, "race")]
        : [withdrawHandover(rows, "race"), claimHandover(rows, "race")];
      const answers = await Promise.all(pair);
      const claimed = answers.find((a) => a === null || typeof a === "object");
      const withdrawn = answers.find((a) => typeof a === "string");
      const mainSends = claimed !== null;
      const popoutSends = withdrawn === "withdrawn";
      if (mainSends && popoutSends) both += 1;
      if (!mainSends && !popoutSends) none += 1;
    }
    check("a claim and a withdrawal at the same moment never both win", both === 0, both);
    check("and one of them wins", none === 0, none);
  }

  // A second offer under one id does not write over the first.
  {
    const rows = memoryHandoverRows();
    await offerHandover(rows, "h5", MESSAGE);
    await offerHandover(rows, "h5", { ...MESSAGE, body: "Other words." });
    const taken = await claimHandover(rows, "h5");
    check("a second offer of one id is ignored", taken?.body === MESSAGE.body, taken?.body);
    await offerHandover(rows, "h5", MESSAGE);
    check("and an offer of a claimed id does not open it again", (await claimHandover(rows, "h5")) === null);
  }

  // An offer from a window that went away is not taken late.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    await offerHandover(rows, "h6", MESSAGE, clock.now);
    clock.advance(10_001);
    check("an offer older than ten seconds is not taken", (await claimHandover(rows, "h6", { now: clock.now })) === null);
    check("and it is still open to its own window", (await withdrawHandover(rows, "h6")) === "withdrawn");
    check("an unknown id gives nothing", (await claimHandover(rows, "nothing")) === null);
    check("and is 'missing' to a withdrawal", (await withdrawHandover(rows, "nothing")) === "missing");
  }

  // A store that fails.
  {
    const clock = fakeClock();
    const broken = {
      update: () => Promise.reject(new Error("no store")),
      read: () => Promise.reject(new Error("no store")),
      prune: () => Promise.resolve(),
    };
    let told = 0;
    const result = await offerSendHandover({ rows: broken, id: "h7", payload: MESSAGE, announce: () => void (told += 1), now: clock.now, sleep: clock.sleep });
    check("a store that takes no offer leaves the message with its window", result === "kept", result);
    check("and the main window is not told of an offer that was not written", told === 0);

    const rows = memoryHandoverRows();
    let fail = false;
    const failsLater = {
      ...rows,
      update: (id, change) => (fail ? Promise.reject(new Error("store went away")) : rows.update(id, change)),
      read: (id) => (fail ? Promise.reject(new Error("store went away")) : rows.read(id)),
    };
    const unknown = await offerSendHandover({
      rows: failsLater,
      id: "h8",
      payload: MESSAGE,
      announce: () => {
        fail = true;
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    check("an offer that can not be withdrawn is 'unknown': the window does not send", unknown === "unknown", unknown);

    const seen = new Set();
    const none = await takeAnnouncedHandover({ rows: broken, id: "h9", seen });
    check("a claim that the store refuses gives nothing", none === null);
  }

  // Old rows go.
  {
    const rows = memoryHandoverRows();
    const clock = fakeClock();
    await offerHandover(rows, "old", MESSAGE, clock.now);
    clock.advance(5_000);
    await offerHandover(rows, "new", MESSAGE, clock.now);
    await rows.prune(clock.now() - 1_000);
    check("prune drops the rows offered before the time", rows.all().map((r) => r.id).join() === "new");
  }
});
