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
  const back = pane.slice(
    pane.lastIndexOf("<button", pane.indexOf('t("backToThread")')),
    pane.indexOf("</button>", pane.indexOf('t("backToThread")'))
  );
  check(
    "in the card, the heading's button brings the reply home",
    back.includes("onClick={onUnfloatReply}"),
    back.trim()
  );

  // Coming back to the window must not open the floating reply a second
  // time, in the thread, from the draft the hand-over saved.
  const adopt = pane.slice(
    pane.indexOf("const adoptStoredDraft"),
    pane.indexOf('window.addEventListener("focus", adoptStoredDraft)')
  );
  check(
    "the thread leaves the draft alone while the card holds it",
    adopt.includes("replyFloatingRef.current) return"),
    adopt.trim().split("\n").slice(0, 4).join("\n")
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
