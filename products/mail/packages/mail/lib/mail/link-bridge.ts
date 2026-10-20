/**
 * The script that runs inside a message frame, and the CSP hash that permits
 * it.
 *
 * The message frame is sandboxed without `allow-same-origin`. Its document
 * has an opaque origin, so the page cannot read it and a script in it cannot
 * reach the page or the Tauri bridge. Each thing the page needs from the
 * message goes through this script, as a postMessage:
 *
 *   frame → page   open-url, size, key, pinch-wheel, pinch-scale, dblclick,
 *                  press, link-menu, message-menu, find-result, find-shown
 *   page → frame   config, zoom, terms, find, find-show, find-clear
 *
 * Each message carries `source: "dh-mail"`. The page accepts a message only
 * from the frame's own window (`event.source`), and the frame accepts one
 * only from its parent. The frame posts to `"*"`, because it cannot read the
 * page's origin. Only the parent window gets the message.
 *
 * The script and its hash must agree byte for byte. `script-src` names the
 * sha256 of the script, in the frame's own CSP and in the app CSP
 * (`apps/mail/src-tauri/tauri.conf.json`). If the two drift, the browser
 * refuses the script with no message, and the frame does nothing.
 * `apps/mail/tests/link-bridge.test.mjs` computes the hash again and fails
 * when they drift.
 *
 * The parts are in `frame-script/`. They are plain JavaScript text, kept
 * readable. Each part is a String.raw template, so the bytes are the source.
 */

import { FRAME_DARK_JS } from "@/lib/mail/frame-script/dark";
import { FRAME_INPUT_JS } from "@/lib/mail/frame-script/input";
import { FRAME_PAINT_JS } from "@/lib/mail/frame-script/paint";
import { FRAME_SIZE_JS } from "@/lib/mail/frame-script/size";

/** What the frame and the page put in `source` on each message. */
export const MAIL_FRAME_MSG_SOURCE = "dh-mail";

const FRAME_CORE_JS = String.raw`
"use strict";
document.documentElement.setAttribute("data-dh-bridge", "1");
var configured = false;
function send(message) {
  message.source = "dh-mail";
  try { parent.postMessage(message, "*"); } catch (e) {}
}
`;

/*
  Messages from the page. Only from the parent window: a message from any
  other window is not the page's.
*/
const FRAME_BOOT_JS = String.raw`
window.addEventListener("message", function (event) {
  if (event.source !== parent) return;
  var data = event.data;
  if (!data || data.source !== "dh-mail") return;
  if (data.type === "config") {
    if (typeof data.zoom === "number" && data.zoom > 0 && document.body) {
      document.body.style.zoom = String(data.zoom);
    }
    if (data.dark) recolorForDark();
    paintSearchWords(data.terms);
    configured = true;
    measure();
    scheduleMeasure();
  } else if (data.type === "zoom") {
    setZoom(data.value);
  } else if (data.type === "measure") {
    scheduleMeasure();
  } else if (data.type === "terms") {
    paintSearchWords(data.terms);
  } else if (data.type === "find") {
    find(data.id, data.needle);
  } else if (data.type === "find-show") {
    showFound(data.id, data.index);
  } else if (data.type === "find-clear") {
    clearFind();
  }
});
send({ type: "hello" });
`;

/**
 * Runs inside the email iframe, in its own realm. See the parts in
 * `frame-script/` for what each piece does.
 */
export const MAIL_LINK_BRIDGE_JS =
  "(function(){" +
  FRAME_CORE_JS +
  FRAME_INPUT_JS +
  FRAME_SIZE_JS +
  FRAME_DARK_JS +
  FRAME_PAINT_JS +
  FRAME_BOOT_JS +
  "})();";

/** sha256-base64 of MAIL_LINK_BRIDGE_JS (CSP script-src). */
export const MAIL_LINK_BRIDGE_CSP_HASH =
  "sha256-pt3sKmwnZcIp4/Hkl0wYill7JkJ0h7QNC7NLoq5GwJk=";
