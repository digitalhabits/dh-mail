/**
 * The way home from the floating reply.
 *
 * The button that sends a reply to the card is the button the reader
 * reaches for to bring it back. So in the card it has to open the thread
 * the reply answers — not simply drop the card and leave the reader
 * wherever they had got to.
 *
 * Read as text: the card is a pane inside a page, and both ends of the
 * handover are React. What can be checked here is that the button in the
 * card asks to go back, and that the page answers by opening that thread.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { check, suite } from "./harness.mjs";

// From the working directory, not from this file: the harness compiles each
// test into a temp directory, so the file's own path leads nowhere.
const src = (name) =>
  readFileSync(
    join(process.cwd(), "../../products/mail/packages/mail/components/mail", name),
    "utf8"
  );

suite(async () => {
  const pane = src("ThreadPane.tsx");
  const button = pane.slice(
    pane.lastIndexOf("{onFloatReply", pane.indexOf("<PictureInPicture2")),
    pane.indexOf("<PictureInPicture2")
  );

  check(
    "in the thread the button sends the reply to the card",
    button.includes("floatReply"),
    button.trim().split("\n").slice(-3).join("\n")
  );
  // Since 7c1b67ef the card does not draw that button: a button to pop out
  // what is already out says nothing. The way home is in the card's heading.
  check(
    "the card does not draw the pop-out button",
    button.startsWith("{onFloatReply && !floating ?"),
    button.trim().split("\n")[0]
  );
  /*
    Since the card was given the window buttons, the heading has three of
    them — put away, fill the window, close — and a fourth that opened the
    thread was one too many: Close already puts the card away, and the
    draft stays on the thread either way. So the way home is the key it
    always shared with the hand-over.
  */
  check(
    "the card's heading has no button back to the thread",
    !pane.includes('t("backToThread")'),
    pane.includes("backToThread") ? "still drawn" : "gone"
  );
  const key = pane.slice(
    pane.indexOf("floatMessageShortcutRef.current = () => {"),
    pane.indexOf("floatReply();")
  );
  check(
    "and the key that floated the reply brings it home",
    key.includes("if (floating) {") && key.includes("onUnfloatReply?.();"),
    key.trim().split("\n").slice(1, 4).join(" ").trim()
  );

  // Coming back to the window must not open the floating reply a second
  // time, in the thread, from the draft the hand-over saved.
  // The function lives with the card and the pop-out now. The pane keeps
  // only the listener that calls it.
  const homeHook = src("use-composer-home.ts");
  const adopt = homeHook.slice(
    homeHook.indexOf("const adoptStoredDraft"),
    homeHook.indexOf("const bringBackPopout")
  );
  check(
    "the thread leaves the draft alone while the card holds it",
    adopt.includes("replyFloatingRef.current) return"),
    adopt.trim().split("\n").slice(0, 4).join("\n")
  );
  check(
    "and the pane still looks for a draft when its window comes to the front",
    pane.includes('window.addEventListener("focus", adoptStoredDraft)')
  );

  /**
   * The other end: coming home is opening the thread, not closing the card.
   * The card is mounted from MailPage, which is the only place that knows
   * what the reader is looking at and can move them.
   */
  const page = src("MailPage.tsx");
  const card = page.slice(page.indexOf("{floatingReply ? ("));
  const home = card.slice(
    card.indexOf("onUnfloatReply={"),
    card.indexOf("onFloatReply={")
  );
  check(
    "the page answers by selecting the thread the reply answers",
    home.includes("setSelected({") && home.includes("floatingReply.threadId"),
    home.trim()
  );
  check(
    "and the card goes, so there is one composer and not two",
    home.includes("setFloatingReply(null)"),
    home.trim()
  );
});
