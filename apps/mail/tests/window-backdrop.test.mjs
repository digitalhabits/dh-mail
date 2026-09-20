/**
 * The colour the page hands the shell for the window.
 *
 * The window takes it as it is, so a see-through colour or an unread form
 * must not get through: the window would show the desktop, or keep a stale
 * colour with no error anybody sees.
 */

import { solidHex } from "@/lib/mail/solid-hex";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "a computed rgb() is sent as #rrggbb, which is all the shell reads",
    solidHex("rgb(26, 39, 53)") === "#1a2735" && solidHex("rgb(250 248 245)") === "#faf8f5",
    String(solidHex("rgb(26, 39, 53)"))
  );
  check(
    "a full alpha still counts as solid",
    solidHex("rgba(26, 39, 53, 1)") === "#1a2735" && solidHex("rgb(26 39 53 / 100%)") === "#1a2735"
  );
  check(
    "a see-through colour is passed over, so the read goes on to the element under it",
    solidHex("rgba(0, 0, 0, 0)") === null &&
      solidHex("rgba(42, 157, 143, 0.1)") === null &&
      solidHex("rgb(0 0 0 / 50%)") === null
  );
  check(
    "a form this does not read is passed over, not guessed at",
    solidHex("color(srgb 0.1 0.2 0.3)") === null && solidHex("transparent") === null
  );
});
