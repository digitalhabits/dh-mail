/**
 * The frame script and the hash that permits it.
 *
 * The CSP inside an email frame names the sha256 of the frame script. Edit
 * the script without recomputing the hash and the browser refuses to run it
 * with no message: links stop working, and the frame never sends its size.
 * The page has no other way into the frame, because the frame has an opaque
 * origin. Nothing else notices, which is what this suite is for.
 *
 * What the script does is in frame-script.test.mjs.
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
    MAIL_LINK_BRIDGE_JS.includes("if (/^mailto:/i.test(raw)) return raw;")
  );

  check(
    "an in-page anchor is still ignored",
    MAIL_LINK_BRIDGE_JS.includes('raw.charAt(0) === "#"')
  );

  check(
    "the bridge never reads the parent's location, which an opaque frame cannot",
    !MAIL_LINK_BRIDGE_JS.includes("parent.location")
  );

  check(
    "the bridge reads only messages from its parent",
    MAIL_LINK_BRIDGE_JS.includes("if (event.source !== parent) return;")
  );
});
