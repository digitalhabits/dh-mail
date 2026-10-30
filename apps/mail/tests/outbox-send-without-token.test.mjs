/**
 * A Gmail reply through the outbox does not stop when Google cannot be reached.
 *
 * Through the outbox the token is only for the name Gmail puts on the sender.
 * A reply failed with "Load failed" when that token request lost its
 * connection, and nothing was queued (2026-10-30). It now goes with the name
 * already stored. A send later still needs the token (its draft is kept at
 * Gmail), so it still stops.
 */

import { sendMailMessage } from "@/lib/mail/inbox";
import { ALMA, fakeMailProviders, fakeMailStore, GMAIL } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

/** The fake store, with Gmail served by the local copy and the outbox recorded. */
function outboxStore() {
  const { calls } = fakeMailStore();
  const queued = [];
  const inner = globalThis.window.__TAURI__.core.invoke;
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_sync_send") {
      queued.push(args);
      return null;
    }
    if (cmd === "mail_store_call" && args.op === "sync.list") {
      return [{ account: GMAIL, folder: "", phase: "live", lastOkAt: Date.now() }];
    }
    return inner(cmd, args);
  };
  return { calls, queued };
}

/** Every request to Google's token endpoint fails as WebKit's fetch does offline. */
function googleUnreachable() {
  const { requests } = fakeMailProviders();
  const answer = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com")) throw new TypeError("Load failed");
    return answer(url, init);
  };
  return { requests };
}

const reply = (extra = {}) => ({
  account: GMAIL,
  to: [ALMA.email],
  cc: [],
  subject: "Re: Thursday?",
  body: "Thursday is fine.",
  threadId: "g3",
  ...extra,
});

suite(async () => {
  {
    const { queued } = outboxStore();
    googleUnreachable();
    let error = null;
    try {
      await sendMailMessage(reply());
    } catch (err) {
      error = err;
    }
    check("the reply does not fail", error === null, String(error));
    check("it is put in the outbox, once", queued.length === 1, String(queued.length));
    check("to whom it was written", JSON.stringify(queued[0]?.recipients) === JSON.stringify([ALMA.email]));
  }
  {
    const { queued } = outboxStore();
    googleUnreachable();
    let error = null;
    try {
      await sendMailMessage(reply({ sendAt: new Date(Date.now() + 3_600_000).toISOString() }));
    } catch (err) {
      error = err;
    }
    check("a send later still stops", error !== null);
    check("and nothing is queued", queued.length === 0, String(queued.length));
  }
});
