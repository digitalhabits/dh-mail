/**
 * The door to the Exchange (EWS) commands in Rust.
 *
 * The commands themselves are tested in mail-native (`ews.rs`, `ntlm.rs`).
 * Built as the internal app. This checks the side the interface sees: the
 * command names and arguments, the error codes, and the debug command.
 */

import assert from "node:assert/strict";

import {
  exchangeReady,
  fetchExchangeBodies,
  fetchExchangePart,
  syncExchangeHierarchy,
  syncExchangeItems,
  ExchangeError,
  callExchange,
  connectExchange,
  describeInbox,
  exchangeErrorCode,
  exchangeInbox,
  installExchangeDebug,
} from "@/lib/mail/exchange-native";

const SUMMARY = { displayName: "Inbox", totalCount: 12, unreadCount: 3, childFolderCount: 2 };

/** Error codes come from the start of the message. */
assert.equal(exchangeErrorCode("ews:refused: The server refused the password."), "ews:refused");
assert.equal(exchangeErrorCode("ews:busy: The server is busy."), "ews:busy");
assert.equal(exchangeErrorCode("something else"), null);
assert.equal(exchangeErrorCode("ews:unknown: no"), null);

assert.equal(describeInbox(SUMMARY), "Inbox: 12 messages, 3 unread, 2 subfolders");

// The runner bundles to CommonJS, which has no top-level await.
(async () => {
  /** No desktop shell: each call refuses before it asks. */
  globalThis.window = globalThis;
  await assert.rejects(exchangeInbox("someone@example.com"), (err) => {
    assert.ok(err instanceof ExchangeError);
    assert.equal(err.code, "ews:unavailable");
    return true;
  });

  /** With a shell: the command names and arguments that Rust expects. */
  const calls = [];
  let answer = async () => SUMMARY;
  globalThis.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      calls.push([command, args]);
      return answer(command, args);
    },
  };

  assert.deepEqual(
    await connectExchange({
      email: "someone@example.com",
      username: "EXAMPLE\\someone",
      password: "secret",
      url: "https://mail.example.com/EWS/Exchange.asmx",
    }),
    SUMMARY
  );
  assert.deepEqual(calls.at(-1), [
    "mail_ews_connect",
    {
      email: "someone@example.com",
      username: "EXAMPLE\\someone",
      password: "secret",
      url: "https://mail.example.com/EWS/Exchange.asmx",
      ownerId: "local",
    },
  ]);

  /** The phase 2 commands: the names and the argument names Rust takes. */
  answer = async () => ({ folders: [], deleted: [], wellKnown: null, syncState: "s" });
  await syncExchangeHierarchy("someone@example.com", null);
  assert.deepEqual(calls.at(-1), ["mail_ews_sync_hierarchy", { account: "someone@example.com", syncState: null }]);
  await syncExchangeItems("someone@example.com", "f1", "s1");
  assert.deepEqual(calls.at(-1), ["mail_ews_sync_items", { account: "someone@example.com", folderId: "f1", syncState: "s1" }]);
  await fetchExchangeBodies("someone@example.com", ["i1"]);
  assert.deepEqual(calls.at(-1), ["mail_ews_fetch_bodies", { account: "someone@example.com", itemIds: ["i1"] }]);
  await fetchExchangePart("someone@example.com", "i1", "2");
  assert.deepEqual(calls.at(-1), ["mail_ews_fetch_part", { account: "someone@example.com", itemId: "i1", section: "2" }]);
  await exchangeReady("someone@example.com");
  assert.deepEqual(calls.at(-1), ["mail_ews_ready", { account: "someone@example.com" }]);

  answer = async () => "<xml/>";
  assert.equal(await callExchange("someone@example.com", "<soap/>"), "<xml/>");
  assert.deepEqual(calls.at(-1), ["mail_ews_call", { account: "someone@example.com", body: "<soap/>" }]);

  /** A refusal from Rust keeps its code. */
  answer = async () => {
    throw "ews:refused: The server refused the password. Connect the account again with the current password.";
  };
  await assert.rejects(exchangeInbox("someone@example.com"), (err) => {
    assert.ok(err instanceof ExchangeError);
    assert.equal(err.code, "ews:refused");
    return true;
  });

  /** The debug command asks for the password when it is not given, and prints the inbox. */
  answer = async () => SUMMARY;
  const printed = [];
  const info = console.info;
  console.info = (line) => printed.push(line);
  const prompts = [];
  globalThis.prompt = (text) => {
    prompts.push(text);
    return "typed";
  };
  installExchangeDebug(globalThis);
  await globalThis.dhExchange.connect({
    email: "someone@example.com",
    username: "someone@example.com",
    url: "https://mail.example.com/EWS/Exchange.asmx",
  });
  assert.deepEqual(prompts, ["Password for someone@example.com"]);
  assert.equal(calls.at(-1)[1].password, "typed");
  await globalThis.dhExchange.inbox("someone@example.com");
  console.info = info;
  assert.deepEqual(calls.at(-1), ["mail_ews_inbox", { account: "someone@example.com" }]);
  assert.deepEqual(printed, [
    "[exchange] Inbox: 12 messages, 3 unread, 2 subfolders",
    "[exchange] Inbox: 12 messages, 3 unread, 2 subfolders",
  ]);

  console.log("exchange-native-internal: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
