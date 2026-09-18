/**
 * Which provider holds a mailbox.
 *
 * Every operation that takes a bare account email asks this first. It used
 * to answer Gmail for any mailbox that was not Outlook, so an address nobody
 * had connected failed a few calls later as a missing Gmail token. Now it
 * says so at once, and remembers the answer so one click is one lookup.
 */

import { resolveMailProvider } from "@/lib/mail/providers";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { check, suite } from "./harness.mjs";

let calls;

/** A store that holds one Gmail mailbox and one Outlook mailbox. */
function fakeStore() {
  calls = [];
  invalidateConnectedMailAccountsCache();
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      if (cmd !== "mail_store_call") return null;
      calls.push({ op: args.op, args: args.args });
      if (args.op === "accounts.exists") {
        const { provider, email } = args.args;
        return (provider === "gmail" && email === "me@gmail.com") ||
          // Connected with dots, and stored exactly as connected.
          (provider === "gmail" && email === "first.last@gmail.com") ||
          (provider === "outlook" && email === "me@outlook.com");
      }
      return null;
    } } },
  };
}

suite(async () => {
  fakeStore();
  check("an Outlook mailbox is Outlook",
    (await resolveMailProvider("me@outlook.com")) === "outlook");
  check("a Gmail mailbox is Gmail",
    (await resolveMailProvider("Me@Gmail.com")) === "gmail");

  // ---- A Gmail address with dots in it -------------------------------------
  //
  // Google ignores the dots, so `first.last@` and `firstlast@` are one
  // mailbox — and the tidying that knows this was being applied to the
  // lookup while the row kept the spelling it was connected under. The two
  // never met: every operation on that mailbox failed with "No connected
  // mailbox" while the mailbox sat in the list with its threads under it.
  check("a Gmail address is found as it is written",
    (await resolveMailProvider("first.last@gmail.com")) === "gmail");

  // ---- Unknown is an error, not Gmail --------------------------------------
  let refused = null;
  try {
    await resolveMailProvider("nobody@example.test");
  } catch (err) {
    refused = err;
  }
  check("a mailbox nobody connected is refused", refused != null);
  check("as not found, so the interface can say which mailbox",
    refused?.status === 404 && /nobody@example\.test/.test(refused?.message),
    `${refused?.status} ${refused?.message}`);

  // ---- Remembered ----------------------------------------------------------
  const before = calls.length;
  await resolveMailProvider("me@outlook.com");
  await resolveMailProvider("me@gmail.com");
  check("a second ask costs no store call", calls.length === before, calls.length - before);

  invalidateConnectedMailAccountsCache();
  await resolveMailProvider("me@outlook.com");
  check("a connect or disconnect makes it ask again", calls.length > before);

  // Order matters: Outlook is checked first, and a Gmail answer costs two
  // lookups. That is the price of not guessing.
  fakeStore();
  await resolveMailProvider("me@gmail.com");
  check("Gmail is asked for only after Outlook says no",
    calls.map((c) => c.args.provider).join(",") === "outlook,gmail",
    calls.map((c) => c.args.provider).join(","));
});
