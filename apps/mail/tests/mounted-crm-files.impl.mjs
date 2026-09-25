/**
 * The walk itself — see mounted-crm-files.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import { setMailApiTransport } from "@/lib/mail/api";
import { closeCrmProposal, proposeCrmFromThread } from "@/components/mail/CrmProposalHost";
import { toastSink } from "./shims/sonner.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const PDF = {
  messageId: "m1",
  attachmentId: "a1",
  filename: "choir-budget.pdf",
  mimeType: "application/pdf",
};

let requests = [];
/** How long a file download takes before it fails. */
let downloadMs = 0;
setMailApiTransport(async (path, init) => {
  requests.push({ path, body: init?.body ? JSON.parse(init.body) : null });
  if (path.includes("/api/mail/attachment")) {
    await sleep(downloadMs);
    return new Response("broken", { status: 500 });
  }
  if (path.startsWith("/api/mail/crm-propose")) {
    return new Response(JSON.stringify({ candidates: [], proposals: [], statusOptions: {}, dropped: [] }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
});

const toasts = [];
toastSink.push = (t) => toasts.push(t);
const proposals = () => requests.filter((r) => r.path.startsWith("/api/mail/crm-propose"));
const downloads = () => requests.filter((r) => r.path.includes("/api/mail/attachment"));

async function main() {
  try {
    await proposeCrmFromThread({ account: ACCOUNT, threadId: "t1", includeAttachments: true, attachments: [PDF] });
    assert.equal(downloads().length, 1, "the file is downloaded");
    assert(toasts.some((t) => t.kind === "error" && String(t.message).includes("choir-budget.pdf")), `the failed file is named: ${JSON.stringify(toasts)}`);
    assert.equal(proposals().length, 2, "the proposal is still asked for (match, then the proposal)");
    assert.deepEqual(proposals()[1].body.attachments, [], "without the file it could not read");
    pass("with the files included, a file that fails is named, and the proposal goes on without it");

    requests = [];
    await proposeCrmFromThread({ account: ACCOUNT, threadId: "t1", includeAttachments: false, attachments: [PDF] });
    assert.equal(downloads().length, 0, "no file is downloaded");
    assert.equal(proposals()[1]?.body.attachments, undefined, "and none is sent");
    pass("without them, no file is downloaded and none is sent");

    requests = [];
    downloadMs = 200;
    const asked = proposeCrmFromThread({ account: ACCOUNT, threadId: "t2", includeAttachments: true, attachments: [PDF] });
    await sleep(50);
    closeCrmProposal();
    await asked;
    assert.equal(proposals().length, 0, "no proposal after it was closed");
    pass("closed while a file is being read, no proposal is asked for");

    process.exit(0);
  } catch (err) {
    console.error("the CRM files walk failed:", err);
    console.error("requests:", JSON.stringify(requests.map((r) => r.path)));
    process.exit(1);
  }
}

void main();
