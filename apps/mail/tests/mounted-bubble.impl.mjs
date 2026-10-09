/**
 * The walk itself — see mounted-bubble.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailBubble } from "@/components/mail/MailBubble";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const FROM_MERLE = {
  id: "m1",
  fromName: "Merle Mikkelsen",
  fromEmail: "merle@sangkor.example",
  toEmails: [ACCOUNT, "tea@aavang.example"],
  ccEmails: [],
  sentAt: "2026-08-19T08:00:00.000Z",
  bodyText: "Can we move to Thursday?",
  own: false,
};

// A file read answers with an invented invitation; everything else is empty.
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:choir-thursday@sangkor.example",
  "DTSTART:20260827T170000Z",
  "DTEND:20260827T190000Z",
  "SUMMARY:Choir practice in the small hall",
  "ORGANIZER;CN=Merle Mikkelsen:mailto:merle@sangkor.example",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");
setMailApiTransport(async (path) =>
  /attachment/.test(path) ? new Response(ICS, { status: 200 }) : new Response("{}", { status: 200 })
);

let root;
const text = () => document.body.textContent || "";
const buttonByText = (label) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);
async function draw(props) {
  root.render(
    React.createElement(MailBubble, {
      account: ACCOUNT,
      defaultAllowImages: false,
      isLatest: true,
      onPreviewAttachment: () => {},
      ...props,
    })
  );
  await sleep(200);
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    root = createRoot(document.getElementById("r"));

    await draw({ message: FROM_MERLE, meta: { sender: true, added: ["tea@aavang.example"], removed: [] } });
    assert(text().includes("Can we move to Thursday?"), "the words are there");
    assert(text().includes("Merle Mikkelsen · Added tea@aavang.example"), `the line names the sender and who was added: ${text().slice(0, 200)}`);
    pass("the line over a message names its sender and who was added");

    await draw({ message: { ...FROM_MERLE, own: true, fromName: "Ulla", fromEmail: "ulla@choir.example" }, meta: { sender: true, added: [], removed: [] } });
    assert(text().includes("ulla@choir.example"), "our own message is named by the address it went from");
    assert(!/\bYou\b/.test(text().replace("Can we move", "")), "not as You");
    pass("our own message is named by its address, not You");

    await draw({
      message: {
        ...FROM_MERLE,
        attachments: [
          { attachmentId: "a1", filename: "seating-plan.txt", mimeType: "text/plain", size: 812 },
          { attachmentId: "a2", filename: "invite.ics", mimeType: "text/calendar", size: 900 },
        ],
      },
    });
    assert(document.querySelector('button[title="seating-plan.txt"]'), "the file is a chip under the words");
    await sleep(400);
    assert(text().includes("Choir practice in the small hall"), `the invitation is a card with its event: ${text().slice(0, 300)}`);
    pass("its files show as chips under the words, and an invitation as a card");

    let retried = 0;
    let edited = 0;
    await draw({ message: { ...FROM_MERLE, own: true }, sendStatus: "sending" });
    assert(text().includes("Sending"), "on its way, it says Sending");
    await draw({ message: { ...FROM_MERLE, own: true }, sendStatus: "failed", onRetrySend: () => retried++, onEditSend: () => edited++ });
    assert(text().includes("Not sent"), "failed, it says Not sent");
    buttonByText("Retry").click();
    buttonByText("Edit").click();
    assert.equal(retried, 1, "Retry sends again");
    assert.equal(edited, 1, "Edit opens it to edit");
    pass("a message on its way says Sending; one that failed says Not sent, with Retry and Edit");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the bubble walk failed:", err);
    process.exit(1);
  }
}

void main();
