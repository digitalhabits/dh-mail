/**
 * The handover between the thread and its pop-out.
 *
 * One message being written has one place. While a pop-out is open, the
 * thread shows a strip where the reply box would be, and the strip's two
 * ways back — Show and Bring back — are these three commands.
 *
 * What is checked here is the edge: what the shell is asked, and what the
 * answer is when there is no shell to ask. The strip itself needs a real
 * window and a real second window, so a person checks that.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  focusChatPopout,
  handBackChatPopout,
  isChatPopoutOpen,
} from "@/lib/native-shell";

import { check, suite } from "./harness.mjs";

const THREAD = { account: "you@example.org", threadId: "t-42" };

/** A shell that answers, and remembers what it was asked. */
function shell(answer) {
  const asked = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          asked.push({ cmd, args });
          if (typeof answer === "function") return answer(cmd, args);
          return answer;
        },
      },
    },
  };
  return asked;
}

suite(async () => {
  delete globalThis.window;
  check(
    "outside the desktop app there is no pop-out, so the composer stays",
    (await isChatPopoutOpen(THREAD)) === false
  );

  shell(() => {
    throw new Error("no such command: chat_popout_open");
  });
  check(
    "a shell without the command answers no rather than throwing — an older build, or another app's",
    (await isChatPopoutOpen(THREAD)) === false
  );

  let asked = shell(true);
  const open = await isChatPopoutOpen(THREAD);
  check("the shell is asked about this one thread, and it answers", open === true);
  check(
    "asked by account and thread, which is what names the window",
    asked[0]?.cmd === "chat_popout_open" &&
      asked[0].args.account === THREAD.account &&
      asked[0].args.threadId === THREAD.threadId,
    JSON.stringify(asked[0])
  );

  asked = shell(null);
  await focusChatPopout(THREAD);
  check(
    "Show brings that thread's window to the front",
    asked[0]?.cmd === "focus_chat_popout" &&
      asked[0].args.threadId === THREAD.threadId,
    JSON.stringify(asked[0])
  );

  asked = shell(null);
  await handBackChatPopout(THREAD);
  check(
    "Bring back asks that window to hand over, and does not close it from here",
    asked.length === 1 &&
      asked[0].cmd === "hand_back_chat_popout" &&
      asked[0].args.threadId === THREAD.threadId,
    JSON.stringify(asked)
  );

  delete globalThis.window;
  check(
    "both are quiet outside the desktop app, where there is nothing to ask",
    (await focusChatPopout(THREAD)) === undefined &&
      (await handBackChatPopout(THREAD)) === undefined
  );

  /**
   * The Rust end, read as text: nothing in this process can start a window.
   *
   * `emit` on a window goes to every window, not to that one. Handing one
   * thread back would then close every pop-out that was open — silently,
   * and only for a reader with two of them.
   */
  // From the working directory, not from this file: the harness compiles each
  // test into a temp directory, so the file's own path leads nowhere.
  const rust = readFileSync(
    join(process.cwd(), "../../products/mail/crates/mail-native/src/popout.rs"),
    "utf8"
  );
  const handBack = rust.slice(rust.indexOf("fn hand_back_chat_popout"));
  const body = handBack.slice(0, handBack.indexOf("\n}"));
  check(
    "hand back is emitted to that one window, or every pop-out closes with it",
    body.includes("emit_to(window.label()"),
    body.trim().split("\n").slice(-4).join("\n")
  );
});
