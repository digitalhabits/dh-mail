/**
 * The directory of an Exchange (EWS) server in the recipient fields
 * (section 16.5 of docs/mail-exchange-ews.md).
 *
 * The directory is asked only for a message from an Exchange mailbox, only
 * for 3 letters or more, one call at a time, and once for each text. A
 * server that does not answer gives no rows. The rows have the Directory
 * badge. Nothing is written to the store, and nothing goes over fetch.
 *
 * Built as the internal app.
 */

import { contactSourceBadge } from "@/lib/mail/contact-suggestion";
import { forgetExchangeDirectory, searchExchangeDirectory } from "@/lib/mail/exchange-directory";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response("{}", { status: 500 });
};

const asked = [];
const writes = [];
let inFlight = 0;
let most = 0;
let busy = false;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "mail_store_call") {
          if (args.op === "accounts.exists") return args.args.provider === "exchange" && args.args.email === EX;
          if (!args.op.endsWith(".get") && !args.op.startsWith("accounts.")) writes.push(args.op);
          return null;
        }
        if (cmd === "mail_ews_resolve_names") {
          asked.push(args.text);
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          if (busy) throw new Error("ews:busy: The server is busy. Try again in 30 seconds.");
          return [
            { name: "Dana Example", email: "dana.example@example.com" },
            // The directory matched this one on an alias the row does not show.
            { name: "Kim Sample", email: "ks42@example.com" },
          ];
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

suite(async () => {
  forgetExchangeDirectory();

  // ---- When the directory is asked -----------------------------------------------
  check("not for two letters", (await searchExchangeDirectory(EX, "da")).length === 0 && asked.length === 0);
  check("not for a sender that is not Exchange", (await searchExchangeDirectory("me@example.org", "dana")).length === 0 && asked.length === 0);

  const rows = await searchExchangeDirectory(EX, " Dana ");
  check("for an Exchange sender, with the text trimmed and in lower case", asked.join(",") === "dana", asked.join(","));
  check("the rows are Directory rows of that mailbox", rows.length === 2 && rows.every((r) => r.source === "directory" && r.account === EX));
  check("with the Directory badge", contactSourceBadge(rows[0], (key) => key) === "badgeDirectory");

  await searchExchangeDirectory(EX, "dana");
  check("the same text is not asked twice", asked.length === 1);

  await Promise.all(["dan", "dana e", "dana ex"].map((q) => searchExchangeDirectory(EX, q)));
  check("one call at a time", most === 1, String(most));

  busy = true;
  check("a busy server gives no rows", (await searchExchangeDirectory(EX, "kim")).length === 0);
  busy = false;
  check("and the text is asked again later", (await searchExchangeDirectory(EX, "kim")).length === 2);

  // The menu's part (a directory row stays in it): mounted-recipient-field,
  // which can load React.

  check("nothing is written to the store", writes.length === 0, writes.join(","));
  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
});
