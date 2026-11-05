/**
 * The walk — see mounted-link-box-paste.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const SUBJECT = "Plant sale on the square";
const ADDRESS = "https://haveklub.example/plantesalg";

setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/threads")
    return json({
      threads: [
        {
          account: ACCOUNT,
          threadId: "plants-1",
          subject: SUBJECT,
          fromName: "Asta Holm",
          fromEmail: "asta@haveklub.example",
          snippet: "We have forty tomato plants and no table.",
          lastAt: "2026-08-21T07:45:00.000Z",
          unread: false,
          messageCount: 1,
          tab: "other",
          externalParticipants: [{ name: "Asta Holm", email: "asta@haveklub.example" }],
        },
      ],
      nextCursor: null,
    });
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  if (p === "/api/mail/contacts") return json({ contacts: [], sources: [] });
  if (p === "/api/mail/contact-lists") return json({ lists: [] });
  return json({});
});

const key = (target, init) => {
  const event = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

async function main() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts: [ACCOUNT], viewerId: "link-box-viewer", ownAddresses: [ACCOUNT] }));
  await waitFor(() => (document.body.textContent || "").includes(SUBJECT));

  // A new message, with words to make a link of.
  key(window, { key: "n", code: "KeyN", metaKey: true });
  assert(await waitFor(() => document.querySelector(".ql-editor")), "Command+N opens a new message");
  const editor = document.querySelector(".ql-editor");
  editor.innerHTML = "<p>Tjek the plan</p>";
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(300);
  const { Quill } = await import("react-quill-new");
  const quill = Quill.find(editor.parentElement);
  editor.focus();
  quill.setSelection(0, 4);
  key(editor, { key: "k", code: "KeyK", metaKey: true });
  const box = document.querySelector(".ql-tooltip.ql-editing input[type=text]");
  assert(box, "Command+K opens the link box on the words");
  // A browser's select() puts the caret in the box. This DOM does not.
  box.focus();
  box.value = "";

  // The shell, for this key only: its clipboard holds an address and a line break.
  const asked = [];
  window.__TAURI_INTERNALS__ = {
    invoke: async (command) => {
      asked.push(command);
      return command === "read_clipboard_text" ? `${ADDRESS}\n` : null;
    },
  };
  try {
    const paste = key(box, { key: "v", code: "KeyV", metaKey: true });
    assert(paste.defaultPrevented, "the box takes Command+V");
    assert(await waitFor(() => box.value === ADDRESS), `the box holds the address, got "${box.value}"`);
    assert.deepEqual(asked, ["read_clipboard_text"], "read from the app's clipboard");
    pass("Command+V in the link box pastes the address, on one line");

    // Paste without formatting is not this key.
    const plain = key(box, { key: "V", code: "KeyV", metaKey: true, altKey: true, shiftKey: true });
    assert(!plain.defaultPrevented, "Option+Shift+Command+V is left alone");
    pass("only Command+V is taken");
  } finally {
    delete window.__TAURI_INTERNALS__;
  }

  // Outside the app, the browser pastes.
  const web = key(box, { key: "v", code: "KeyV", metaKey: true });
  assert(!web.defaultPrevented, "a browser keeps its own paste");
  pass("outside the app, Command+V is the browser's");

  root.unmount();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
