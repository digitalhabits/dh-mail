/** The walk itself — see mounted-notice-details.test.mjs. */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { ListNotice, ListNoticeDetails } from "@/components/mail/ListNotice";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REASON = 'Graph GET /me/mailFolders failed (502): {"error":{"code":"UnknownError"}}';

async function main() {
  document.body.innerHTML = '<div id="root"></div>';
  createRoot(document.getElementById("root")).render(
    React.createElement(
      ListNotice,
      { title: "Outlook has a problem right now" },
      React.createElement(ListNoticeDetails, { show: "Show details", hide: "Hide details" }, REASON)
    )
  );
  await sleep(50);
  const button = () => document.querySelector("button");
  assert(!document.body.textContent.includes("502"), "the worker's words are not on the notice");
  assert.equal(button().textContent, "Show details");
  button().click();
  await sleep(50);
  assert(document.body.textContent.includes(REASON), "Show details opens them");
  assert.equal(button().textContent, "Hide details");
  assert.equal(button().getAttribute("aria-expanded"), "true");
  button().click();
  await sleep(50);
  assert(!document.body.textContent.includes("502"), "Hide details folds them again");
  console.log("PASS  the details are folded until asked for");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
