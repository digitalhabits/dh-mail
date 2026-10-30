import {
  applySurfaceColors,
  effectiveSurfaceColor,
  isDarkColor,
  readSurfaceColors,
  resetSurfaceColors,
  setSurfaceColor,
  surfaceAt,
  swatchesFor,
} from "@/lib/mail/surface-colors";
import { check, suite } from "./harness.mjs";

// The colours chosen in Settings > General > Colours. Node has no
// localStorage or window events, so here are small ones.
const store = new Map();
globalThis.window = { dispatchEvent: () => true };
globalThis.Event = class {
  constructor(type) {
    this.type = type;
  }
};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

function fakeRoot() {
  const props = new Map();
  const attrs = new Map();
  return {
    props,
    attrs,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
  };
}

suite(async () => {
  check("nothing set reads as no colours", Object.keys(readSurfaceColors()).length === 0);

  setSurfaceColor("list", "#FAFAFA");
  check("a colour is kept, in lower case", readSurfaceColors().list === "#fafafa");

  setSurfaceColor("rail", "#f0eae1");
  check("the default colour is not kept", readSurfaceColors().rail === undefined);

  setSurfaceColor("top", "red");
  check("a colour that is not #rrggbb is not kept", readSurfaceColors().top === undefined);

  setSurfaceColor("list", null);
  check("clearing a colour removes the stored value", !store.size);

  store.set("redd-plan-mail-surface-colors", "{not json");
  check("a broken stored value reads as no colours", Object.keys(readSurfaceColors()).length === 0);
  store.set("redd-plan-mail-surface-colors", JSON.stringify({ reader: "#e9e4da" }));
  check("the website's sand reads as Mail's sand", readSurfaceColors().reader === "#ebe4d8");
  store.clear();

  setSurfaceColor("rail", "#334455");
  setSurfaceColor("reader", "#ffffff");
  const root = fakeRoot();
  applySurfaceColors(readSurfaceColors(), root);
  check("each set colour goes on the root", root.props.get("--mail-user-rail") === "#334455" && root.props.get("--mail-user-reader") === "#ffffff");
  check("the rail's hover follows its colour", String(root.props.get("--mail-user-rail-hover")).includes("#334455"));
  check("a colour not set is not written", !root.props.has("--mail-user-top"));

  resetSurfaceColors();
  applySurfaceColors(readSurfaceColors(), root);
  check("reset takes every colour off the root", root.props.size === 0);

  // A right-click target, as the selectors it sits inside.
  const at = (inside, theme = "light") => ({
    closest: (selector) => {
      const hit = selector.split(",").some((one) => inside.includes(one.trim()));
      if (!hit) return null;
      return { getAttribute: (name) => (name === "data-theme" ? theme : null) };
    },
  });
  check("the list's head wins over the list", surfaceAt(at([".mail-shell", "[data-list-expanded]", ".mail-list-head"])) === "listHead");
  check("the list's background is the list", surfaceAt(at([".mail-shell", "[data-list-expanded]"])) === "list");
  check("the reader's background is the reader", surfaceAt(at([".mail-shell", ".mail-reading-pane"])) === "reader");
  check("the top bar", surfaceAt(at([".mail-shell", ".mail-titlebar"])) === "top");
  check("the folder list", surfaceAt(at([".mail-shell", "[data-folder-rail]"])) === "rail");
  check("a message keeps its own menu", surfaceAt(at([".mail-shell", ".mail-reading-pane", ".mail-bubble-card"])) === null);
  check("a button keeps its own menu", surfaceAt(at([".mail-shell", "[data-folder-rail]", "button"])) === null);
  check("not in the dark theme", surfaceAt(at([".mail-shell", ".mail-reading-pane"], "dark")) === null);
  check("not outside the mail window", surfaceAt(at([".mail-reading-pane"])) === null);
  check("the thread's header is its own part", surfaceAt(at([".mail-shell", ".mail-reading-pane", ".mail-thread-header"])) === "readerHead");
  check("so is the thread's row of actions", surfaceAt(at([".mail-shell", ".mail-reading-pane", ".mail-thread-toolbar"])) === "readerHead");

  // The thread's header has a default of its own, apart from the thread's.
  resetSurfaceColors();
  setSurfaceColor("reader", "#e6eff2");
  check("an unset header keeps its own default", effectiveSurfaceColor(readSurfaceColors(), "readerHead") === "#f5f1ea");
  setSurfaceColor("readerHead", "#e6eff2");
  check("a header can take the thread's colour", readSurfaceColors().readerHead === "#e6eff2");

  // A dark part is marked, so its words go cream.
  check("the website's green is dark", isDarkColor("#005d53"));
  check("ink is dark", isDarkColor("#1b3d4a"));
  check("mist is light", !isDarkColor("#d6e5ea"));
  check("cream is light", !isDarkColor("#f5f1ea"));
  resetSurfaceColors();
  setSurfaceColor("top", "#005d53");
  setSurfaceColor("reader", "#1b3d4a");
  const marked = fakeRoot();
  applySurfaceColors(readSurfaceColors(), marked);
  const dark = String(marked.attrs.get("data-mail-dark")).split(" ");
  check("a dark top bar is marked", dark.includes("top"));
  check("a dark thread is marked, and its light header is not", dark.includes("reader") && !dark.includes("readerHead"));
  check("a light part is not marked", !dark.includes("list"));
  setSurfaceColor("readerHead", "#f5f1ea");
  applySurfaceColors(readSurfaceColors(), marked);
  check("a light header on a dark thread is not marked", !String(marked.attrs.get("data-mail-dark")).includes("readerHead"));
  resetSurfaceColors();
  applySurfaceColors(readSurfaceColors(), marked);
  check("with no dark part, the mark goes", !marked.attrs.has("data-mail-dark"));

  // A colour set on one part is an option for every part.
  resetSurfaceColors();
  setSurfaceColor("top", "#123456");
  setSurfaceColor("rail", "#123456");
  setSurfaceColor("list", "#f5f1ea");
  const values = swatchesFor(readSurfaceColors()).map((s) => s.value);
  check("a colour in use is offered, once", values.filter((v) => v === "#123456").length === 1);
  check("it comes after the design system's", values.indexOf("#123456") > values.indexOf("#f5f1ea"));
  check("a design-system colour in use is not offered twice", values.filter((v) => v === "#f5f1ea").length === 1);
  resetSurfaceColors();
});
