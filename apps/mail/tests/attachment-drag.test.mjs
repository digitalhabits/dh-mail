/**
 * Dragging an attachment out of the window.
 *
 * A page cannot hand a file to Finder, so this host reads the bytes, has the
 * native side write a copy, and starts a real drag from it. What is checked
 * here is the order that makes it work: the file is read while the button is
 * going down, and `dragstart` only asks for the drag.
 *
 * The drag itself is a pointer, a window, and Finder, so a person checks that.
 */

import { setMailApiTransport } from "@/lib/mail/api";
import {
  hostDragsAttachments,
  prepareAttachmentDrag,
  startAttachmentDrag,
} from "@/lib/mail/attachment-source";

import { check, suite } from "./harness.mjs";

const FILE = {
  path: "/api/mail/attachment?account=you%40example.org&attachmentId=a1&download=1",
  filename: "Kontrakt.pdf",
  mimeType: "application/pdf",
};

/** A shell that answers, and remembers what it was asked. */
function shell() {
  const asked = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          asked.push({ cmd, args });
          if (cmd === "stage_attachment_for_drag") return "/tmp/drag/Kontrakt.pdf";
          return null;
        },
      },
    },
  };
  return asked;
}

/** A drag event, as far as the seam is concerned. */
function dragEvent() {
  const put = [];
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    dataTransfer: { setData: (type, value) => put.push({ type, value }), put },
  };
}

/** Let the reads and the invokes that follow them settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

suite(async () => {
  check(
    "a webview has no way of its own, so this host drags the file itself",
    hostDragsAttachments === true
  );

  let reads = 0;
  setMailApiTransport(async (path) => {
    reads += 1;
    check("the file is read from the path the tile shows", path === FILE.path);
    return new Response(new Uint8Array([1, 2, 3]));
  });

  let asked = shell();
  prepareAttachmentDrag(FILE);
  await settle();
  check(
    "the button going down reads the file and stages a copy, before any drag",
    asked.length === 1 && asked[0].cmd === "stage_attachment_for_drag",
    JSON.stringify(asked.map((a) => a.cmd))
  );
  check(
    "staged under the name the sender gave it, bytes and all",
    asked[0]?.args.filename === FILE.filename &&
      asked[0].args.contentBase64 === "AQID",
    JSON.stringify(asked[0]?.args)
  );

  const event = dragEvent();
  startAttachmentDrag(event, FILE);
  await settle();
  check(
    "the drag the page would start is stopped — it carries nothing Finder wants",
    event.prevented === true
  );
  check(
    "and the shell is asked to drag the copy that is already on disk",
    asked.length === 2 &&
      asked[1].cmd === "drag_files" &&
      asked[1].args.paths[0] === "/tmp/drag/Kontrakt.pdf",
    JSON.stringify(asked[1])
  );
  check(
    "the same file is read once, however often it is picked up",
    reads === 1,
    `read ${reads} times`
  );

  /**
   * A file nobody got ready: the drag still has to ask for it.
   *
   * It is the one that arrives late — the reader who starts dragging without
   * a press this seam saw. Late is better than never.
   */
  asked = shell();
  const other = { ...FILE, path: `${FILE.path}&other=1` };
  setMailApiTransport(async () => new Response(new Uint8Array([9])));
  startAttachmentDrag(dragEvent(), other);
  await settle();
  check(
    "an unprepared file is staged and dragged from the one event",
    asked.map((a) => a.cmd).join(",") === "stage_attachment_for_drag,drag_files",
    JSON.stringify(asked.map((a) => a.cmd))
  );
});
