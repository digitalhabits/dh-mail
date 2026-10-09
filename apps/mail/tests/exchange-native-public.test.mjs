/**
 * The public app has Exchange accounts, in the desktop app only.
 *
 * Since 2026-09-28 both builds have Exchange (EWS); a new connect needs an
 * access code (section 18, item 5 of docs/mail-exchange-ews.md). This suite
 * is built as the public app. With a desktop shell, the calls reach the
 * shell's EWS commands. With no shell (a browser), each call refuses before
 * it asks. The debug command stays out of the public app.
 */

import assert from "node:assert/strict";

import { ExchangeError, exchangeInbox, installExchangeDebug } from "@/lib/mail/exchange-native";
import { searchExchangeDirectory } from "@/lib/mail/exchange-directory";
import { installExchangeDraftCopy } from "../src/exchange-draft-copy";
import { defaultExchangeServer } from "@/lib/mail/exchange-connect";

globalThis.window = globalThis;
const calls = [];
const shell = {
  invoke: async (command, args) => {
    calls.push(command === "mail_store_call" ? `${command}:${args.op}` : command);
    return null;
  },
};

// The runner bundles to CommonJS, which has no top-level await.
(async () => {
  // No shell: nothing is asked.
  await assert.rejects(exchangeInbox("someone@example.com"), (err) => {
    assert.ok(err instanceof ExchangeError);
    assert.equal(err.code, "ews:unavailable");
    assert.match(err.message, /desktop app/);
    return true;
  });
  assert.deepEqual(await searchExchangeDirectory("someone@example.com", "dana"), []);
  assert.deepEqual(calls, []);

  // With the desktop shell: the EWS commands are asked.
  globalThis.__TAURI_INTERNALS__ = shell;
  await exchangeInbox("someone@example.com").catch(() => undefined);
  assert.ok(calls.some((c) => c.startsWith("mail_ews_")), `an EWS command was asked: ${calls.join(", ")}`);
  calls.length = 0;
  // The directory first asks the store whether this is an Exchange mailbox.
  await searchExchangeDirectory("someone@example.com", "dana");
  assert.ok(calls.includes("mail_store_call:accounts.exists"), `the store was asked: ${calls.join(", ")}`);
  const heard = [];
  installExchangeDraftCopy({ addEventListener: (name) => heard.push(name) }, 1);
  assert.equal(heard.length, 2, "the draft copy listens for a written and a deleted draft");

  // The debug command stays in the team's app.
  installExchangeDebug(globalThis);
  assert.equal(globalThis.dhExchange, undefined);

  // The Autodiscover test switch is the internal build's: the public build
  // fills in KU's server whatever localStorage says.
  {
    const hadWindow = "window" in globalThis;
    const before = globalThis.window;
    globalThis.window = { localStorage: { getItem: () => "1" } };
    assert.equal(defaultExchangeServer("ku.dk"), "https://mail.ku.dk/EWS/Exchange.asmx");
    if (hadWindow) globalThis.window = before;
    else delete globalThis.window;
  }

  console.log("exchange-native-public: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
