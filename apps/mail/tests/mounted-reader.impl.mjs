/**
 * The walk itself — see mounted-reader.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailBubble } from "@/components/mail/MailBubble";
import { ReaderLinesSetting } from "@/components/mail/reader-lines-setting";

import { waitFor } from "./mounted-dom.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setMailApiTransport(async () => new Response("{}", { status: 200 }));

/* A box is one 20px line for every 50 characters of its text. */
const LINE_CHARS = 50;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const lines = Math.ceil((this.textContent || "").length / LINE_CHARS);
  const height = lines * 20;
  return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height, toJSON() {} };
};

const ACCOUNT = "ulla@aavang.example";
const SENTENCE = "The new roof needs one more week of dry weather before we can paint it. ";
const LONG = {
  id: "long1",
  fromName: "Ana Berg",
  fromEmail: "ana@kollektiv.example",
  toEmails: [ACCOUNT],
  ccEmails: [],
  sentAt: "2026-10-10T09:30:00.000Z",
  bodyText: SENTENCE.repeat(12).trim(), // about 17 lines of 50 characters
  own: false,
};
const SHORT = { ...LONG, id: "short1", bodyText: "Thanks, that works." };
const FORWARD = {
  ...LONG,
  id: "fwd1",
  bodyText: [
    "See below. The second half is new to me.",
    SENTENCE.repeat(10).trim(),
    "",
    "---------- Forwarded message ---------",
    "From: Bo Lind <bo@havn.example>",
    "Date: Mon, 6 Oct 2026 at 10:00",
    "Subject: The garden plan",
    "To: <ana@kollektiv.example>",
    "",
    "We plant the beans in May. " + SENTENCE.repeat(6).trim(),
  ].join("\n"),
};

let root;
const reader = () => document.querySelector("[data-mail-reader]");
const readerButton = () => document.querySelector("[data-reader-button]");
const buttonByText = (scope, label) =>
  [...scope.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);

async function draw(props) {
  root.render(
    React.createElement(
      "div",
      null,
      React.createElement(MailBubble, {
        account: ACCOUNT,
        subject: "Roof",
        defaultAllowImages: false,
        onPreviewAttachment: () => {},
        ...props,
      }),
      React.createElement(ReaderLinesSetting)
    )
  );
  await sleep(150);
}

function setCutoff(value) {
  const input = document.querySelector("[data-reader-lines]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, String(value));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function pressEscape() {
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    root = createRoot(document.getElementById("r"));

    await draw({ message: SHORT });
    assert(!readerButton(), "a short message has no Reader button");
    await draw({ message: LONG });
    assert(await waitFor(readerButton), "a long message has the Reader button");
    // In the bubble's hover controls, under Reply: an icon with a name.
    assert.equal(readerButton().getAttribute("aria-label"), "Open in the Reader");
    pass("the Reader button shows on a long message and not on a short one");

    setCutoff(40);
    assert(await waitFor(() => !readerButton()), "over 40 lines, a 17-line message has no button");
    setCutoff(5);
    assert(await waitFor(readerButton), "over 5 lines, it has the button again");
    setCutoff(1);
    await draw({ message: SHORT });
    assert(!readerButton(), "a one-line message is not over a cutoff of one line");
    setCutoff(10);
    pass("the cutoff in Settings > Reading moves the button");

    let replies = 0;
    let forwards = 0;
    await draw({ message: LONG, onReplyTo: () => replies++, onForward: () => forwards++ });
    await waitFor(readerButton);
    readerButton().click();
    assert(await waitFor(reader), "the button opens the Reader");
    const r = reader();
    assert.equal(r.parentElement, document.body, "the Reader covers the window, outside the thread");
    const sender = r.querySelector("[data-reader-sender]");
    assert.match(sender?.textContent ?? "", /Ana Berg/, "the sender line names the sender");
    const meta = r.querySelector("[data-reader-meta]").textContent;
    assert.match(meta, /10/, `with the date and time: ${meta}`);
    assert.match(r.querySelector("[data-reader-text]").textContent, /dry weather before we can paint/, "the message's words are there");
    assert.equal(document.activeElement, buttonByText(r, "Back to threadEsc"), "focus moves to Back to thread");
    pass("the Reader opens with the sender label, the date and the words, and takes focus");

    /* The edges set the column's width, both sides at once. */
    const column = () => r.querySelector("article");
    const before = parseFloat(column().style.maxWidth);
    const edge = r.querySelector('[data-reader-width-handle="right"]');
    assert(edge, "the column has an edge to drag");
    const fire = (el, type, x, buttons) =>
      el.dispatchEvent(new window.PointerEvent(type, { bubbles: true, clientX: x, button: 0, buttons, pointerId: 1 }));
    fire(edge, "pointerdown", 500, 1);
    fire(window, "pointermove", 540, 1);
    fire(window, "pointerup", 540, 0);
    assert(await waitFor(() => parseFloat(column().style.maxWidth) === before + 80), `40px out is 80px wider: ${column().style.maxWidth}`);
    edge.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    assert(await waitFor(() => parseFloat(column().style.maxWidth) === 680), "a double-click puts the usual width back");
    pass("the Reader's edges make it wider, and a double-click puts it back");

    pressEscape();
    assert(await waitFor(() => !reader()), "Esc closes the Reader");
    assert(document.activeElement?.classList.contains("mail-bubble-column"), "focus goes back to the bubble");
    readerButton().click();
    await waitFor(reader);
    buttonByText(reader(), "Back to threadEsc").click();
    assert(await waitFor(() => !reader()), "Back to thread closes the Reader");
    pass("Esc and Back to thread return to the thread");

    readerButton().click();
    await waitFor(reader);
    buttonByText(reader(), "Reply").click();
    assert(await waitFor(() => !reader()), "Reply closes the Reader");
    assert.equal(replies, 1, "Reply asks for the reply composer for this message");
    readerButton().click();
    await waitFor(reader);
    buttonByText(reader(), "Forward").click();
    assert(await waitFor(() => !reader()), "Forward closes the Reader");
    assert.equal(forwards, 1, "Forward asks for the forward composer for this message");
    pass("Reply and Forward close the Reader and open the composer for that message");

    await draw({ message: FORWARD, subject: "Fwd: The garden plan" });
    await waitFor(readerButton);
    readerButton().click();
    assert(await waitFor(reader), "the forward opens in the Reader");
    const words = () => reader().querySelector("[data-reader-bubble] [data-reader-text]")?.textContent ?? "";
    assert.match(words(), /^See below/, "the sender's own words come first, in the bubble");
    assert(!/Forwarded message/.test(words()), "folded, as the bubble shows it");
    reader().querySelector("[data-reader-quoted]").click();
    assert(await waitFor(() => /Forwarded message/.test(words())), "the dots show the forward");
    assert.match(words(), /---------- Forwarded message ---------/, "the forward line shows as in the thread");
    assert.match(words(), /From: Bo Lind <bo@havn\.example>/, "with the forwarded header");
    assert.match(words(), /We plant the beans in May/, "and the forwarded words");
    assert(!reader().querySelector("[data-reader-forwarded]"), "no section of its own");
    pressEscape();
    await waitFor(() => !reader());
    pass("a forward folds and opens as in the thread, with its Forwarded message line");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the Reader walk failed:", err);
    process.exit(1);
  }
}

void main();
