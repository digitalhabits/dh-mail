/**
 * The walk — see mounted-draft-not-discarded.test.mjs.
 */

import { discardDraftRows } from "@/components/mail/draft-discard-batch";
import { setMailApiTransport } from "@/lib/mail/api";
import { flushPendingDiscards } from "@/lib/mail/pending-discard";
import { toast } from "@/lib/mail/toast";


let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail == null ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const draft = (id) => ({
  id,
  origin: "exchange",
  account: "ulla@aavang.example",
  threadId: `thread-${id}`,
  subject: "Chairs",
  snippet: "",
  to: ["signe@torvet.example"],
  updatedAt: null,
});

async function main() {
  const errors = [];
  toast.error = (message) => errors.push(String(message));

  // ---- The server refuses -----------------------------------------------
  let refreshed = 0;
  setMailApiTransport(async () =>
    new Response(JSON.stringify({ error: "ews: Access is denied." }), { status: 500 })
  );
  await discardDraftRows([draft("d1")], () => refreshed++);
  flushPendingDiscards();
  await wait(20);
  check("a refused delete tells the reader", errors.length === 1, JSON.stringify(errors));
  check("with the server's reason", errors[0]?.includes("Access is denied."), errors[0]);
  check("and the list is read again", refreshed >= 2, String(refreshed));

  // ---- The server deletes it --------------------------------------------
  errors.length = 0;
  setMailApiTransport(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  await discardDraftRows([draft("d2")], () => {});
  flushPendingDiscards();
  await wait(20);
  check("a delete that works says nothing more", errors.length === 0, JSON.stringify(errors));
}

main()
  .catch((err) => {
    console.error("FAIL ", err?.message || err);
    failed++;
  })
  .finally(() => process.exit(failed ? 1 : 0));
