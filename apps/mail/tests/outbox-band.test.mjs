/**
 * The Outbox group at the top of the list, for a Gmail mailbox.
 *
 * A Gmail send goes to the local outbox and is shown as sent. Until the
 * worker has carried it out, the one place the reader can see it is this
 * group — and the group used to ask Outlook only, so a message stuck
 * behind a first sync was nowhere on screen.
 */

import { listAllScheduledMailMessages } from "@/lib/mail/inbox";
import * as fakes from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const { fakeMailStore, GMAIL } = fakes;
const OWNER = fakes.OWNER ?? "local";

suite(async () => {
  fakeMailStore();
  const inner = window.__TAURI__.core.invoke;
  const asked = [];
  window.__TAURI__.core.invoke = async (cmd, args) => {
    asked.push(cmd === "mail_store_call" ? args.op : cmd);
    // The copy is still filling: the first sync is under way.
    if (cmd === "mail_store_call" && args.op === "sync.list") {
      return [{ account: GMAIL, folder: "", phase: "full" }];
    }
    if (cmd === "mail_store_call" && args.op === "accounts.listForOwner" && args.args.provider === "outlook") {
      return [];
    }
    if (cmd === "mail_sync_outbox") {
      return [
        {
          id: 7,
          threadId: null,
          subject: "To my parents",
          to: ["mor@example.com"],
          sendAt: Date.now() - 60_000,
          status: "sending",
          lastError: null,
        },
      ];
    }
    return inner(cmd, args);
  };

  const held = await listAllScheduledMailMessages({ clerkUserId: OWNER });
  check(
    "the Outbox group lists what a Gmail mailbox holds, a first sync under way or not",
    held.length === 1 && held[0].subject === "To my parents" && held[0].account === GMAIL,
    JSON.stringify(held)
  );
  check("as a message on its way, not one waiting for a time", held[0]?.status === "sending");
  check("and the Gmail outbox was asked", asked.includes("mail_sync_outbox"));

  // No copy at all: nothing to ask, nothing to show.
  window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "sync.list") return [];
    if (cmd === "mail_store_call" && args.op === "accounts.listForOwner" && args.args.provider === "outlook") {
      return [];
    }
    if (cmd === "mail_sync_outbox") throw new Error("must not be asked without a copy");
    return inner(cmd, args);
  };
  const { forgetSyncStates } = await import("@/lib/mail/local-store");
  forgetSyncStates();
  const none = await listAllScheduledMailMessages({ clerkUserId: OWNER });
  check("a Gmail mailbox with no local copy holds nothing", none.length === 0, JSON.stringify(none));
});
