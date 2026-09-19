/**
 * "Delete forever" takes the picked conversation's messages that are in
 * Trash or Junk, and nothing else.
 *
 * It is the one action that cannot be undone, so what these check is mostly
 * what it must never do: delete a whole thread when one message of it is in
 * Trash, touch a folder that was not named, or run with no conversation at
 * all. There is no "empty the folder" in this app on purpose, and the last
 * check keeps it that way.
 */

import * as gmail from "@/lib/gmail/api";
import * as outlook from "@/lib/outlook/api";

import { check, suite } from "./harness.mjs";

/** Every request the code made, and an answer for each. */
function fakeNetwork(answer) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const request = {
      // URLSearchParams writes a space as "+", which decodeURIComponent leaves.
      url: decodeURIComponent(String(url).replace(/\+/g, " ")),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : null,
    };
    sent.push(request);
    const reply = answer(request) ?? { status: 200, json: {} };
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  return sent;
}

suite(async () => {
  // ---- Gmail, on the REST path ---------------------------------------------
  {
    const sent = fakeNetwork((r) =>
      r.url.includes("/threads/th1")
        ? {
            status: 200,
            json: {
              id: "th1",
              messages: [
                { id: "a", labelIds: ["TRASH"] },
                { id: "b", labelIds: ["INBOX", "UNREAD"] },
                { id: "c", labelIds: ["TRASH", "Work"] },
                { id: "d", labelIds: ["SPAM"] },
              ],
            },
          }
        : { status: 204 }
    );
    const ids = await gmail.threadMessageIdsWithLabel("tok", "th1", "TRASH");
    check(
      "only the messages in Trash are named, not the one in the inbox",
      ids.join(",") === "a,c",
      ids.join(",")
    );
    await gmail.deleteMessagesForever("tok", ids);
    const deletes = sent.filter((r) => r.url.endsWith("/messages/batchDelete"));
    check(
      "they go in one batchDelete, by message id",
      deletes.length === 1 &&
        deletes[0].method === "POST" &&
        JSON.stringify(deletes[0].body) === '{"ids":["a","c"]}',
      JSON.stringify(deletes)
    );
    check(
      "the thread itself is never deleted: that would take the inbox message too",
      !sent.some((r) => r.method === "DELETE"),
      JSON.stringify(sent.map((r) => `${r.method} ${r.url}`))
    );
  }

  {
    const sent = fakeNetwork(() => ({ status: 204 }));
    await gmail.deleteMessagesForever("tok", []);
    check("no ids, no request", sent.length === 0, String(sent.length));
  }

  // ---- Outlook ---------------------------------------------------------------
  {
    let listed = 0;
    const sent = fakeNetwork((r) => {
      if (r.url.includes("/mailFolders/")) {
        listed += 1;
        // The first listing has two messages; after they go, none.
        return { status: 200, json: { value: listed === 1 ? [{ id: "m1" }, { id: "m2" }] : [] } };
      }
      if (r.url.endsWith("/m2/permanentDelete")) return { status: 404, json: { error: { code: "ErrorItemNotFound" } } };
      return { status: 204 };
    });
    const removed = await outlook.purgeOutlookConversation("tok", "deleteditems", "conv'1");
    const lists = sent.filter((r) => r.url.includes("/mailFolders/"));
    check(
      "the listing is of Deleted Items, and of the one conversation",
      lists.every(
        (r) =>
          r.url.includes("/me/mailFolders/deleteditems/messages") &&
          r.url.includes("conversationId eq 'conv''1'")
      ),
      lists[0]?.url
    );
    const purges = sent.filter((r) => r.url.endsWith("/permanentDelete"));
    check(
      "each message is deleted with permanentDelete, which a plain DELETE is not",
      purges.length === 2 && purges.every((r) => r.method === "POST") && !sent.some((r) => r.method === "DELETE"),
      JSON.stringify(sent.map((r) => `${r.method} ${r.url}`))
    );
    check("a message already gone is not a failure", removed === 2, String(removed));
  }

  {
    const sent = fakeNetwork(() => ({ status: 200, json: { value: [{ id: "x" }] } }));
    let refused = false;
    try {
      await outlook.purgeOutlookConversation("tok", "deleteditems", "  ");
    } catch {
      refused = true;
    }
    check(
      "no conversation named: refused before any request, so never the whole folder",
      refused && sent.length === 0,
      `${refused} ${sent.length}`
    );
  }

  // ---- What must not exist ---------------------------------------------------
  const emptying = [...Object.keys(gmail), ...Object.keys(outlook)].filter((name) =>
    /^empty|purge.*folder$/i.test(name)
  );
  check(
    "neither provider client has a call that empties a folder",
    emptying.length === 0,
    emptying.join(",")
  );
});
