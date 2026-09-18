/**
 * Which mailbox a new message starts from.
 *
 * Three answers, and the order between them is the whole of it: the address
 * the reader asked to keep, then the account tab they are working in, then
 * the first connected mailbox because something has to be first.
 */

import { composeFromDefault, writeComposeFrom } from "@/lib/mail/compose-from";

import { check, suite } from "./harness.mjs";

/** The module reads localStorage; this test runs where there is none. */
function withStoredFrom(value, run) {
  const store = new Map();
  if (value) store.set("redd-plan-mail-compose-from", value);
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  try {
    return run();
  } finally {
    delete globalThis.localStorage;
  }
}

const ACCOUNTS = ["vera@example.org", "team@digitalhabits.org", "u@ox.ac.uk"];

suite(async () => {
  check("with no tab picked, the first mailbox stands", () => {
    const from = withStoredFrom(null, () => composeFromDefault(ACCOUNTS, []));
    return from === ACCOUNTS[0] || `got ${from}`;
  });

  check("one tab picked answers for it", () => {
    const from = withStoredFrom(null, () =>
      composeFromDefault(ACCOUNTS, ["team@digitalhabits.org"])
    );
    return from === "team@digitalhabits.org" || `got ${from}`;
  });

  check("several tabs is All, so the first mailbox stands", () => {
    const from = withStoredFrom(null, () =>
      composeFromDefault(ACCOUNTS, ["team@digitalhabits.org", "u@ox.ac.uk"])
    );
    return from === ACCOUNTS[0] || `got ${from}`;
  });

  check("an address the reader asked to keep beats the tab", () => {
    const from = withStoredFrom("u@ox.ac.uk", () =>
      composeFromDefault(ACCOUNTS, ["team@digitalhabits.org"])
    );
    return from === "u@ox.ac.uk" || `got ${from}`;
  });

  check("a kept address that is no longer connected falls through", () => {
    const from = withStoredFrom("gone@example.org", () =>
      composeFromDefault(ACCOUNTS, ["team@digitalhabits.org"])
    );
    return from === "team@digitalhabits.org" || `got ${from}`;
  });

  check("a tab naming a mailbox that has gone falls through", () => {
    const from = withStoredFrom(null, () =>
      composeFromDefault(ACCOUNTS, ["gone@example.org"])
    );
    return from === ACCOUNTS[0] || `got ${from}`;
  });

  check("no mailboxes at all is an empty answer, not a crash", () => {
    const from = withStoredFrom(null, () => composeFromDefault([], []));
    return from === "" || `got ${from}`;
  });

  void writeComposeFrom;
});
