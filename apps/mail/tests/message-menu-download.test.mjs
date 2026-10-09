/**
 * "Download attachment" on the message's own menu.
 *
 * The tiles are not always where the reader is: a long message puts them
 * above the fold, so the menu beside the bubble offers the same save. What
 * is checked here is what that menu does — every file the provider holds,
 * asked for as a download, and nothing that is still on its way out.
 *
 * Whether the item is in the menu at all is a rendered popover, so a person
 * checks that.
 */

import { setMailApiTransport } from "@/lib/mail/api";
import {
  savableAttachments,
  saveMessageAttachments,
} from "@/lib/mail/attachment-save";

import { check, suite } from "./harness.mjs";

const ACCOUNT = "you@example.org";
const MESSAGE = "m1";
const FILES = [
  {
    attachmentId: "a1",
    filename: "Invoice SCU-0001.pdf",
    mimeType: "application/pdf",
    size: 129_000,
  },
  {
    attachmentId: "a2",
    filename: "Vilkår.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 20_000,
  },
  // Still being attached to a draft going out: the provider has nothing to read.
  {
    attachmentId: "local-3",
    filename: "Notat.txt",
    mimeType: "text/plain",
    size: 12,
  },
];

/** A shell that answers, and remembers what it was asked to write. */
function shell() {
  const saved = [];
  globalThis.window = {
    // The pause between saves; a browser refuses a burst of downloads.
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "save_attachment") {
            saved.push(args);
            return `/Users/you/Downloads/${args.filename}`;
          }
          return null;
        },
      },
    },
  };
  return saved;
}

suite(async () => {
  check(
    "a file still going out is not offered — there is nothing to read yet",
    savableAttachments(FILES).map((a) => a.attachmentId).join(",") === "a1,a2",
    savableAttachments(FILES)
      .map((a) => a.attachmentId)
      .join(",")
  );

  const saved = shell();
  const read = [];
  setMailApiTransport(async (path) => {
    read.push(path);
    return new Response(new Uint8Array([1, 2, 3]));
  });

  await saveMessageAttachments({
    account: ACCOUNT,
    messageId: MESSAGE,
    attachments: FILES,
  });

  check(
    "each file the provider holds is read once, and the pending one is not",
    read.length === 2,
    read.join(" | ")
  );
  check(
    "read as a download, from this message and this account",
    read.every(
      (path) =>
        path.includes("download=1") &&
        path.includes(`messageId=${MESSAGE}`) &&
        path.includes("account=you%40example.org")
    ),
    read.join(" | ")
  );
  check(
    "the two files are asked for by their own ids",
    read[0]?.includes("attachmentId=a1") && read[1]?.includes("attachmentId=a2"),
    read.join(" | ")
  );
  check(
    "and the shell writes both, under the names the sender gave them",
    saved.map((a) => a.filename).join(",") ===
      "Invoice SCU-0001.pdf,Vilkår.docx",
    saved.map((a) => a.filename).join(",")
  );
  check(
    "saved, not opened — the reader asked for the file, not a look at it",
    saved.every((a) => a.open === false),
    JSON.stringify(saved.map((a) => a.open))
  );
});
