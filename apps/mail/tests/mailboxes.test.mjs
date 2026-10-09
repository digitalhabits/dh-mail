import { handleStandaloneMailApi } from "../src/standalone-api";
import { check, suite } from "./harness.mjs";
/** Every store call this request made, in order. */

let calls = [];

const ROWS = {
  gmail: [
    { email: "me@gmail.com", ownerId: "local", historyId: "42", lastSyncedAt: "2026-08-01T00:00:00.000Z", lastSyncError: null, inMailTab: true },
  ],
  outlook: [
    { email: "me@outlook.com", ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: false },
  ],
};

/** Answers what the Rust store would, for the few operations these paths use. */
function fakeStore(overrides = {}) {
  calls = [];
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      if (cmd !== "mail_store_call") return null;
      calls.push({ op: args.op, args: args.args });
      if (args.op in overrides) return overrides[args.op];
      if (args.op === "accounts.listForOwner") return ROWS[args.args.provider] ?? [];
      // Reorder checks that every address in the list belongs to this owner.
      if (args.op === "accounts.listOwnedEmails") return args.args.emails;
      if (args.op === "accounts.remove") return true;
      return null;
    } } },
  };
}

const json = async (res) => ({ status: res.status, body: await res.json() });

suite(async () => {
  // ---- GET -----------------------------------------------------------------
  fakeStore();
  let r = await json(await handleStandaloneMailApi("/api/gmail/accounts"));
  check("gmail: lists the connected mailboxes",
    r.status === 200 && r.body.accounts?.[0]?.email === "me@gmail.com",
    JSON.stringify(r.body).slice(0, 80));
  check("gmail: reads only this owner's rows, not every owner's",
    calls[0]?.op === "accounts.listForOwner" && calls[0]?.args.ownerId === "local",
    JSON.stringify(calls[0]));
  check("gmail: says the client is configured, which enables the connect button",
    r.body.configError === null, String(r.body.configError));

  fakeStore();
  r = await json(await handleStandaloneMailApi("/api/outlook/accounts"));
  check("outlook: reads the outlook rows, not gmail's",
    r.body.accounts?.[0]?.email === "me@outlook.com" &&
      calls[0]?.args.provider === "outlook",
    calls[0]?.args.provider);

  // The interface reads `accounts` on both and `success` on outlook. Answering
  // both shapes means one branch here instead of two.
  check("outlook: answers the shape the interface reads", r.body.success === true);

  // ---- PATCH: reorder ------------------------------------------------------
  fakeStore();
  r = await json(await handleStandaloneMailApi("/api/outlook/accounts", {
    method: "PATCH",
    body: JSON.stringify({ order: ["b@x.com", "a@x.com"] }),
  }));
  const order = calls.find((c) => c.op === "accounts.setSortOrder");
  check("drag to reorder writes the new order for the right provider",
    r.status === 200 && order?.args.provider === "outlook" &&
      JSON.stringify(order?.args.emails) === '["b@x.com","a@x.com"]',
    JSON.stringify(order?.args));

  // Reordering a list holding an address this owner does not have is a client
  // that lost track of the real one, not a request to invent a row.
  fakeStore({ "accounts.listOwnedEmails": [] });
  r = await json(await handleStandaloneMailApi("/api/gmail/accounts", {
    method: "PATCH",
    body: JSON.stringify({ order: ["ghost@x.com"] }),
  }));
  check("reordering an unknown mailbox answers 404, the status the core meant",
    r.status === 404 && !calls.some((c) => c.op === "accounts.setSortOrder"),
    `${r.status} ${r.body.error}`);

  // ---- PATCH: show/hide ----------------------------------------------------
  fakeStore({ "accounts.setInMailTab": true });
  r = await json(await handleStandaloneMailApi("/api/gmail/accounts", {
    method: "PATCH",
    body: JSON.stringify({ email: "me@gmail.com", inMailTab: false }),
  }));
  const hide = calls.find((c) => c.op === "accounts.setInMailTab");
  check("hiding a mailbox writes the flag",
    r.status === 200 && hide?.args.inMailTab === false && hide?.args.provider === "gmail",
    JSON.stringify(hide?.args));

  fakeStore();
  r = await json(await handleStandaloneMailApi("/api/gmail/accounts", {
    method: "PATCH",
    body: JSON.stringify({ email: "me@gmail.com" }),
  }));
  check("a PATCH with no flag is refused rather than guessed at",
    r.status === 400, `${r.status} ${r.body.error}`);

  // ---- DELETE --------------------------------------------------------------
  fakeStore();
  r = await json(await handleStandaloneMailApi(
    "/api/outlook/accounts?email=me%40outlook.com", { method: "DELETE" }));
  const removed = calls.find((c) => c.op === "accounts.remove");
  check("disconnect removes the row for that provider and owner",
    r.status === 200 && removed?.args.provider === "outlook" &&
      removed?.args.email === "me@outlook.com" && removed?.args.ownerId === "local",
    JSON.stringify(removed?.args));

  fakeStore({ "accounts.remove": false });
  r = await json(await handleStandaloneMailApi(
    "/api/gmail/accounts?email=nobody%40x.com", { method: "DELETE" }));
  check("disconnecting a mailbox that is not there answers 404, not success",
    r.status === 404, String(r.status));

  fakeStore();
  r = await json(await handleStandaloneMailApi("/api/gmail/accounts", { method: "DELETE" }));
  check("a DELETE with no address is refused before it deletes anything",
    r.status === 400 && !calls.some((c) => c.op === "accounts.remove"),
    `${r.status}, ${calls.length} store calls`);

  // ---- Anything else -------------------------------------------------------
  fakeStore();
  r = await json(await handleStandaloneMailApi("/api/gmail/accounts", { method: "PUT" }));
  check("an unhandled method says so instead of falling through to a read",
    r.status === 405, String(r.status));
});
