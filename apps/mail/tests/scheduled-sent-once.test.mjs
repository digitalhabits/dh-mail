/**
 * A scheduled message that went is not sent again, nor called failed, when
 * the store will not record it (lib/mail/scheduled-drafts.ts). An Exchange
 * row, so no Google sign-in is reached. Invented rows.
 */

import { runScheduledSends } from "@/lib/mail/scheduled-drafts";
import { check, suite } from "./harness.mjs";

function bridge({ doneFailsTimes }) {
  const calls = [];
  let due = [{ id: 7, account: "ana@school.example", provider: "exchange", draftId: "AAA=", sendAt: 0 }];
  let doneFails = doneFailsTimes;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          calls.push(cmd);
          if (cmd === "mail_scheduled_take_due") return due;
          if (cmd === "mail_ews_send_draft") return "sent";
          if (cmd === "mail_scheduled_done") {
            if (doneFails > 0) {
              doneFails -= 1;
              throw new Error("database is locked");
            }
            due = due.filter((row) => row.id !== args.id);
            return null;
          }
          return null;
        },
      },
    },
  };
  return calls;
}

const count = (calls, cmd) => calls.filter((c) => c === cmd).length;

suite(async () => {
  {
    const calls = bridge({ doneFailsTimes: 1 });
    await runScheduledSends();
    check("a send whose record fails once is recorded on the next try", count(calls, "mail_scheduled_done") === 2, calls.join(","));
    check("and it is not called failed", count(calls, "mail_scheduled_failed") === 0, calls.join(","));
  }
  {
    // The store refuses every write for this run: three tries, then memory.
    const calls = bridge({ doneFailsTimes: 3 });
    await runScheduledSends();
    check("a send the store will not record is sent once", count(calls, "mail_ews_send_draft") === 1, calls.join(","));
    check("and is not called failed either", count(calls, "mail_scheduled_failed") === 0, calls.join(","));
    // Next look: the row is still due in the store, but it is not sent again.
    await runScheduledSends();
    check("on the next look it is not sent again", count(calls, "mail_ews_send_draft") === 1, calls.join(","));
    check("and its record is tried again, and taken", count(calls, "mail_scheduled_done") === 4, calls.join(","));
    await runScheduledSends();
    check("once taken, it is left alone", count(calls, "mail_scheduled_done") === 4, calls.join(","));
  }
});
