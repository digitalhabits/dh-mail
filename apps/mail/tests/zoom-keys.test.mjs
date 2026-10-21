import { zoomKeyDirection } from "@/lib/mail/zoom-keys";
import { check, suite } from "./harness.mjs";

// Cmd/Ctrl+Plus and Minus in a popped-out window step its text size.
const key = (key, mods = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, key, ...mods });

suite(async () => {
  check("Cmd+= is bigger", zoomKeyDirection(key("=", { metaKey: true })) === 1);
  check("Cmd+Shift+= (\"+\" on a US keyboard) is bigger", zoomKeyDirection(key("+", { metaKey: true })) === 1);
  check("Ctrl+Plus on Windows is bigger", zoomKeyDirection(key("+", { ctrlKey: true })) === 1);
  check("Cmd+Minus is smaller", zoomKeyDirection(key("-", { metaKey: true })) === -1);
  check("Cmd+Shift+Minus (\"_\") is smaller", zoomKeyDirection(key("_", { metaKey: true })) === -1);
  check("a plain = typed in the reply is not a zoom", zoomKeyDirection(key("=")) === null);
  check("Option+Cmd+Plus is left for the app size", zoomKeyDirection(key("=", { metaKey: true, altKey: true })) === null);
  check("other Cmd keys are not a zoom", zoomKeyDirection(key("c", { metaKey: true })) === null);
});
