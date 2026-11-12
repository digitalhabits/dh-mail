/**
 * The walk itself — see mounted-sender-rule.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { MenuShell } from "@/components/mail/MenuShell";
import { SenderRuleDialogHost } from "@/components/mail/SenderRuleDialog";
import { SenderRulesRow } from "@/components/mail/sender-rule-menu";
import { setMailApiTransport } from "@/lib/mail/api";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "vera@mail.example";
const SENDER = { name: "Help Desk", email: "desk@college.example" };

/** What the app answers for the row's sender, and every rule it was asked to keep or remove. */
let senderState = { sender: SENDER, domain: "college.example", rule: null, here: { sender: 1, domain: 3 } };
const saved = [];
const removed = [];
const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost");
  if (url.pathname === "/api/mail/rules/sender") return json({ success: true, ...senderState });
  if (url.pathname === "/api/mail/rules/save") {
    saved.push(JSON.parse(String(init.body)));
    return json({ success: true, moved: 1 });
  }
  if (url.pathname === "/api/mail/rules/remove") {
    removed.push(JSON.parse(String(init.body)).id);
    return json({ success: true });
  }
  if (url.pathname === "/api/mail/folders") {
    return json({
      folders: [
        { account: ACCOUNT, name: "Inbox", count: 4, role: "inbox" },
        { account: ACCOUNT, name: "Clients", count: 2 },
        { account: ACCOUNT, name: "Clients/Ferries", count: 1 },
        { account: ACCOUNT, name: "Garden", count: 5 },
        { account: "other@mail.example", name: "Elsewhere", count: 1 },
      ],
    });
  }
  return json({ success: true });
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => (el.textContent || "").includes(text));
const item = (text) => byText("[role=menuitem]", text);

let root = null;
let dismissed = 0;
/** A menu with the rules line in it, as a row's menu has, and the page's dialog host. */
async function openMenu() {
  root?.unmount();
  document.body.innerHTML = '<div id="root"></div>';
  dismissed = 0;
  root = createRoot(document.getElementById("root"));
  const Menu = () => {
    const [open, setOpen] = React.useState(true);
    const dismiss = () => {
      dismissed += 1;
      setOpen(false);
    };
    return React.createElement(
      React.Fragment,
      null,
      open
        ? React.createElement(
            MenuShell,
            { x: 10, y: 10, label: "Conversation", onDismiss: dismiss },
            React.createElement(SenderRulesRow, { account: ACCOUNT, threadId: "t1", onDismiss: dismiss })
          )
        : null,
      React.createElement(SenderRuleDialogHost)
    );
  };
  root.render(React.createElement(Menu));
  await sleep(80);
}

async function main() {
  // No sender: no line.
  senderState = { sender: null, domain: "", rule: null, here: { sender: 0, domain: 0 } };
  await openMenu();
  assert(!item("Rules for"), "a conversation with no sender has no rules line");
  pass("the line is not drawn when there is no sender");

  // One click keeps a rule.
  senderState = { sender: SENDER, domain: "college.example", rule: null, here: { sender: 1, domain: 3 } };
  await openMenu();
  const line = await waitFor(() => item("Rules for Help Desk"));
  assert(line, "the line names the sender");
  clickEl(line);
  await waitFor(() => item("Always archive"));
  assert(byText("div", "desk@college.example"), "the panel says whose future mail");
  assert(item("Always move to Junk") && item("Always move to a folder") && item("Always send to Trash") && item("More options"), "every choice is there");
  assert(!item("Remove this rule"), "with no rule, there is none to remove");
  clickEl(item("Always archive"));
  await waitFor(() => saved.length === 1);
  assert.deepEqual(
    saved[0],
    { account: ACCOUNT, match: "sender", value: SENDER.email, name: SENDER.name, action: "archive", moveExisting: true },
    "the rule is for the address, to Archive, and takes the mail already here"
  );
  assert(dismissed > 0, "and the menu closes");
  pass("one click on a choice keeps a rule for the sender");

  // A folder is picked in the dialog.
  await openMenu();
  clickEl(await waitFor(() => item("Rules for Help Desk")));
  clickEl(await waitFor(() => item("Always move to a folder")));
  const title = await waitFor(() => byText("h2", "Rule for Help Desk"));
  assert(title, "the dialog opens, named for the sender");
  const chosen = (name) => byText("[role=radio]", name)?.getAttribute("aria-checked") === "true";
  assert(chosen("Folder") && chosen("This sender"), "with Folder and This sender chosen");
  const save = () => byText("button", "Save rule");
  assert(save().disabled, "Save waits for a folder");
  const option = (name) => byText("[role=option]", name);
  assert(option("Clients") && option("Ferries") && option("Garden"), "the mailbox's own folders are listed");
  assert(!option("Inbox") && !option("Elsewhere"), "not the provider's own, nor another mailbox's");
  typeInto(document.querySelector('input[placeholder="Filter folders…"]'), "ferr");
  await waitFor(() => !option("Garden"));
  clickEl(option("Ferries"));
  await waitFor(() => !save().disabled);
  // Everyone at the domain: the count of mail already here follows.
  assert(byText("label", "Also move the 1 email already here"), "the mail already here is counted for the sender");
  clickEl(byText("[role=radio]", "Everyone at college.example"));
  await waitFor(() => byText("label", "Also move the 3 emails already here"));
  clickEl(byText("label", "Also move").querySelector("input"));
  clickEl(save());
  await waitFor(() => saved.length === 2);
  assert.deepEqual(
    saved[1],
    { account: ACCOUNT, match: "domain", value: "college.example", name: SENDER.name, action: "folder", folderName: "Clients/Ferries", moveExisting: false },
    "the rule is for the domain, to the folder picked, and leaves the mail already here"
  );
  await waitFor(() => !byText("h2", "Rule for Help Desk"));
  pass("the dialog keeps a rule for a domain and a folder");

  // A domain many people share: the dialog does not offer it.
  senderState = { sender: { name: "Ann", email: "ann@gmail.com" }, domain: "", rule: null, here: { sender: 0, domain: 0 } };
  await openMenu();
  clickEl(await waitFor(() => item("Rules for Ann")));
  clickEl(await waitFor(() => item("More options")));
  await waitFor(() => byText("h2", "Rule for Ann"));
  assert(!byText("[role=radio]", "Everyone at"), "no rule for everyone at a shared domain");
  assert(!byText("label", "Also move"), "and no word of mail already here when there is none");
  pass("the dialog leaves out what does not apply");

  // A sender with a rule.
  senderState = {
    sender: SENDER,
    domain: "college.example",
    rule: { id: "r1", account: ACCOUNT, match: "sender", value: SENDER.email, action: "folder", folderName: "Garden", name: SENDER.name, createdAt: 1 },
    here: { sender: 0, domain: 0 },
  };
  await openMenu();
  clickEl(await waitFor(() => item("Rules for Help Desk")));
  const inUse = await waitFor(() => item("Always move to Garden"));
  assert(inUse && inUse.textContent.includes("In use"), "the rule in use is marked, with its folder");
  clickEl(item("Remove this rule"));
  await waitFor(() => removed.length === 1);
  assert.equal(removed[0], "r1");
  pass("a sender's rule is shown, and can be removed");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
