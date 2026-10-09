/**
 * The walks — see mounted-account-disconnect.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailAccountsPanel } from "@/components/mail/MailAccountsPanel";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEEP = "ana@kollektiv.example";
const LEAVE = "bo@kollektiv.example";

/** Each DELETE on an accounts route: the email it named. */
const removed = [];
let listed = [KEEP, LEAVE];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/api/gmail/accounts") {
    if (init?.method === "DELETE") {
      const email = url.searchParams.get("email");
      removed.push(email);
      listed = listed.filter((e) => e !== email);
      return json({ ok: true });
    }
    return json({
      accounts: listed.map((email) => ({
        email,
        clerkUserId: null,
        lastSyncedAt: null,
        lastSyncError: null,
        inMailTab: true,
      })),
    });
  }
  if (url.pathname === "/api/outlook/accounts") return json({ accounts: [] });
  return json({});
});

/*
  The desktop store, for the sync states alone: LEAVE's sign-in has stopped
  working, as the sync worker writes it. Everything else answers nothing.
*/
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "mail_store_call" && args?.op === "sync.list") {
      return [
        { account: KEEP, folder: "", phase: "live", lastError: null },
        { account: LEAVE, folder: "", phase: "paused", lastError: "needs reconnect: the grant was revoked or expired" },
      ];
    }
    return null;
  },
};

/** Every toast the panel raises, newest last. */
const toasts = [];
toastSink.push = (t) => toasts.push(t);

/** Optimistic visibility calls, as the page would get them. */
const visibility = [];

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const listed_ = (email) => (document.body.textContent || "").includes(email);
const disconnectButton = (email) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === `Disconnect ${email}`
  );

async function main() {
  try {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailAccountsPanel, {
        knownEmails: [KEEP, LEAVE],
        onVisibilityChange: (email, shown) => visibility.push([email, shown]),
        onChanged: () => {},
        autoReplies: [],
        onSetUpAutoReply: () => {},
        onEndAutoReply: () => {},
        onRequestClose: () => {},
      })
    );
    await sleep(500);
    assert(listed_(LEAVE) && listed_(KEEP), "both accounts are listed");

    // All well says Connected; a sign-in that stopped working says so and
    // offers Reconnect, and only there.
    const reconnectFor = (email) =>
      [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === `Reconnect ${email}`);
    assert(!reconnectFor(KEEP), "no Reconnect on an account that is fine");
    assert(reconnectFor(LEAVE), "Reconnect on the account whose sign-in stopped");
    assert(listed_("Signing in stopped working"), "and the line under it says why");
    assert(listed_("Connected"), "the account that is fine says Connected");
    pass("Connected while all is well; Reconnect only where signing in stopped working");

    // Disconnect, then Undo inside the ten seconds.
    clickEl(disconnectButton(LEAVE));
    await sleep(300);
    assert(!listed_(LEAVE), "the account leaves the list at once");
    assert(listed_(KEEP), "the other stays");
    assert.deepEqual(visibility.at(-1), [LEAVE, false], "and the page hides its mail");
    assert.deepEqual(removed, [], "but nothing is removed yet");
    const offered = toasts.at(-1);
    assert(offered?.data?.action?.label === "Undo", "the toast offers Undo");
    offered.data.action.onClick();
    await sleep(300);
    assert(listed_(LEAVE), "Undo puts the account back in the list");
    assert.deepEqual(visibility.at(-1), [LEAVE, true], "and its mail back on the page");
    await sleep(10_500);
    assert.deepEqual(removed, [], "and nothing is ever removed: sign-in and copy are kept");
    pass("Undo inside the ten seconds brings the account back and removes nothing");

    // Disconnect, and let the time run out.
    clickEl(disconnectButton(LEAVE));
    await sleep(300);
    assert.deepEqual(removed, [], "nothing is removed at once");
    await sleep(10_500);
    assert.deepEqual(removed, [LEAVE], "when the time is up, the account is removed");
    assert(!listed_(LEAVE), "and stays out of the list");
    pass("without Undo, the account is removed when the ten seconds are up");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the disconnect walk failed:", err);
    process.exit(1);
  }
}

void main();
