/**
 * The auto-reply of an Exchange (EWS) mailbox (section 16.2 of
 * docs/mail-exchange-ews.md).
 *
 * The dialog's fields map to Exchange's OofSettings as the Outlook branch
 * maps Graph's: off is Disabled, on with both times is Scheduled, on with
 * none or one is Enabled. "Only my contacts" is Known. The one text goes to
 * both replies. The times go as UTC, and a time with no zone that comes
 * back is UTC. Nothing goes over fetch.
 *
 * Built as the internal app.
 */

import { autoReplyToOof, fromEwsTime, oofToAutoReply, toEwsTime } from "@/lib/mail/exchange-autoreply";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { listMailAutoReplies, setMailAutoReply } from "@/lib/mail/inbox";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response("{}", { status: 500 });
};

let kept = { state: "Disabled", externalAudience: "All", start: "2026-09-20T08:00:00", end: "2026-09-21T08:00:00", internal: "", external: "" };
const sets = [];

function storeCall(op, args) {
  switch (op) {
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange" ? [{ email: EX, ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true }] : [];
    default:
      return null;
  }
}

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd === "mail_ews_get_auto_reply") return kept;
        if (cmd === "mail_ews_set_auto_reply") {
          sets.push(args.reply);
          // Exchange gives the times back with no zone.
          kept = { ...args.reply, start: args.reply.start?.replace(/Z$/, "") ?? null, end: args.reply.end?.replace(/Z$/, "") ?? null };
          return kept;
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const START = Date.parse("2026-10-01T08:00:00Z");
const END = Date.parse("2026-10-08T08:00:00Z");

suite(async () => {
  invalidateConnectedMailAccountsCache();

  // ---- The map --------------------------------------------------------------------
  check("a time goes as UTC, to the second", toEwsTime(START) === "2026-10-01T08:00:00Z", toEwsTime(START));
  check("a time with no zone is UTC", fromEwsTime("2026-10-01T08:00:00") === START);
  check("a time with a zone keeps it", fromEwsTime("2026-10-01T10:00:00+02:00") === START);
  check("no time is null", fromEwsTime(null) === null && fromEwsTime("") === null);

  const base = { bodyHtml: "<p>Away</p>", restrictToContacts: false, startTime: null, endTime: null };
  check("off is Disabled", autoReplyToOof({ ...base, enabled: false }).state === "Disabled");
  check("on with no times is Enabled", autoReplyToOof({ ...base, enabled: true }).state === "Enabled");
  check("on with one time is Enabled, with no times", (() => {
    const oof = autoReplyToOof({ ...base, enabled: true, startTime: START });
    return oof.state === "Enabled" && oof.start === null && oof.end === null;
  })());
  const scheduled = autoReplyToOof({ ...base, enabled: true, startTime: START, endTime: END, restrictToContacts: true });
  check("on with both times is Scheduled", scheduled.state === "Scheduled" && scheduled.end === "2026-10-08T08:00:00Z");
  check("only my contacts is Known", scheduled.externalAudience === "Known");
  check("the text goes to both replies", scheduled.internal === "<p>Away</p>" && scheduled.external === "<p>Away</p>");

  const off = oofToAutoReply({ state: "Enabled", externalAudience: "All", start: "2026-09-20T08:00:00", end: "2026-09-21T08:00:00", internal: "", external: "<p>Out</p>" });
  check("the times show only when scheduled", off.enabled && off.startTime === null && off.endTime === null);
  check("with no internal reply, the external one shows", off.bodyHtml === "<p>Out</p>");

  // ---- The list and the save ---------------------------------------------------------
  const rows = await listMailAutoReplies("all", "local");
  const row = rows.find((r) => r.account === EX);
  check("the mailbox has an auto-reply row", row?.provider === "exchange" && row.enabled === false);
  check("with no subject box", row?.subjectSupported === false);

  const saved = await setMailAutoReply({
    account: EX, enabled: true, subject: "ignored", bodyHtml: "<p>Away</p>", restrictToContacts: false, startTime: START, endTime: END,
  });
  check("the save goes over EWS as Scheduled", sets.at(-1)?.state === "Scheduled");
  check("and comes back with its times", saved.startTime === START && saved.endTime === END, JSON.stringify(saved));
  check("with no subject", saved.subject === "" && saved.provider === "exchange");

  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
});
