/** The walk itself — see mounted-notice-dismiss.test.mjs. Every address is invented. */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { ListNotice } from "@/components/mail/ListNotice";
import { useDismissedPauses } from "@/components/mail/use-dismissed-pauses";
import { canDismissPause, isPauseDismissed, pauseNoticeKey } from "@/lib/mail/sync-pause";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAULT = "Graph GET /me/mailFolders failed (502): {}";
const OLA = { account: "ola@example.com", folder: "", lastError: FAULT, lastOkAt: 1000 };

function Notices({ paused }) {
  const { dismiss, isDismissed } = useDismissedPauses();
  return paused
    .filter((s) => !isDismissed(s))
    .map((s) =>
      React.createElement(
        ListNotice,
        { key: s.account, title: `${s.account} stopped`, onDismiss: () => dismiss(s), dismissLabel: "Close" },
        "Mail tries again by itself."
      )
    );
}

async function main() {
  // The rule on its own.
  const closed = new Map([[pauseNoticeKey(OLA), 1000]]);
  assert(isPauseDismissed(closed, OLA), "the closed fault stays closed");
  assert(!isPauseDismissed(closed, { ...OLA, lastOkAt: 2000 }), "a new fault after a good sync shows");
  assert(!isPauseDismissed(closed, { ...OLA, lastError: "something else" }), "another kind of fault shows");
  const signIn = { ...OLA, lastError: "Reconnect this account" };
  assert(!canDismissPause(signIn), "a sign-in fault cannot be closed");
  assert(!isPauseDismissed(new Map([[pauseNoticeKey(signIn), 1000]]), signIn));

  // The button.
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(Notices, { paused: [OLA] }));
  await sleep(50);
  const close = document.querySelector('button[aria-label="Close"]');
  assert(close, "the notice has a Close button");
  close.click();
  await sleep(50);
  assert(!document.body.textContent.includes("stopped"), "a click closes the notice");

  // Drawn again from nothing, as after a change of folder: still closed.
  root.render(React.createElement("div", null));
  await sleep(20);
  root.render(React.createElement(Notices, { paused: [{ ...OLA }] }));
  await sleep(50);
  assert(!document.body.textContent.includes("stopped"), "it stays closed when the list is drawn again");

  // The mailbox synced well and stopped again: the new notice shows.
  root.render(React.createElement(Notices, { paused: [{ ...OLA, lastOkAt: 5000 }] }));
  await sleep(50);
  assert(document.body.textContent.includes("stopped"), "a new fault shows again");
  console.log("PASS  a sync notice closes, and a new fault shows again");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
