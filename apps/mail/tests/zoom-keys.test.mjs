import { typesWithAltGraph } from "@/lib/mail/host-os";
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

  // Windows reports AltGr as Ctrl+Alt. The app size keys must let it type.
  const altGr = (k, code, mods = {}) => ({ ...key(k, { ctrlKey: true, altKey: true, ...mods }), code });
  check("on a Mac, Option+Cmd+0 is never AltGr", !typesWithAltGraph(altGr("}", "Digit0")));
  globalThis.document = { documentElement: { dataset: { dhOs: "windows" } } };
  try {
    check("Danish AltGr+0 types \"}\", it does not reset the size", typesWithAltGraph(altGr("}", "Digit0")));
    check("Danish AltGr+´ types \"|\", it does not grow the size", typesWithAltGraph(altGr("|", "Equal")));
    check("AltGraph alone is enough", typesWithAltGraph({ key: "@", code: "Digit2", ctrlKey: false, altKey: false, getModifierState: (m) => m === "AltGraph" }));
    check("US Ctrl+Alt+0 still resets the size", !typesWithAltGraph(altGr("0", "Digit0")));
    check("US Ctrl+Alt+= still grows the size", !typesWithAltGraph(altGr("=", "Equal")));
    check("Ctrl+Alt+F still opens search", !typesWithAltGraph(altGr("f", "KeyF")));
    check("Ctrl+0 with no Alt is not AltGr", !typesWithAltGraph(key("}", { ctrlKey: true, code: "Digit0" })));
  } finally {
    delete globalThis.document;
  }
});
