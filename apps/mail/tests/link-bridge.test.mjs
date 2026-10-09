/**
 * The click bridge and the hash that permits it.
 *
 * The CSP inside an email frame names the sha256 of the bridge script. Edit
 * the script without recomputing the hash and the browser silently refuses to
 * run it: links stop working, and worst in the desktop app, where the
 * parent-side fallback listener is the unreliable one. Nothing else notices,
 * which is what this suite is for.
 */

import crypto from "node:crypto";

import {
  MAIL_LINK_BRIDGE_CSP_HASH,
  MAIL_LINK_BRIDGE_JS,
} from "@/lib/mail/link-bridge";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const actual =
    "sha256-" +
    crypto.createHash("sha256").update(MAIL_LINK_BRIDGE_JS, "utf8").digest("base64");

  check(
    "the pinned hash is the hash of the script the frame runs",
    actual === MAIL_LINK_BRIDGE_CSP_HASH,
    actual === MAIL_LINK_BRIDGE_CSP_HASH
      ? actual
      : `script hashes to ${actual}, the constant says ${MAIL_LINK_BRIDGE_CSP_HASH}`
  );

  check(
    "the bridge hands a mailto out rather than dropping it",
    MAIL_LINK_BRIDGE_JS.includes("/^mailto:/i.test(r)) return r") ||
      MAIL_LINK_BRIDGE_JS.includes("if(/^mailto:/i.test(r))return r")
  );

  check(
    "an in-page anchor is still ignored",
    MAIL_LINK_BRIDGE_JS.includes('r.charAt(0)==="#"')
  );

  check(
    "the bridge posts to the parent origin, not to *",
    MAIL_LINK_BRIDGE_JS.includes("parent.location.origin") &&
      !MAIL_LINK_BRIDGE_JS.includes('postMessage(m,"*")')
  );
});
