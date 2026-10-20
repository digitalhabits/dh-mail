/**
 * The script inside a message frame (lib/mail/link-bridge.ts), run for real.
 *
 * The message frame has no `allow-same-origin`. The page cannot read it, so
 * everything the page used to do in the frame's document is now done by this
 * script, and sent out as postMessage. This suite runs the exact text that
 * the CSP hash pins in a happy-dom window, with a stand-in for the page, and
 * reads what the script sends.
 *
 * happy-dom does no layout, so sizes are not checked here. Which messages
 * are sent, and what is in them, is.
 *
 * Every address and every word in the fixtures is invented.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Window } from "happy-dom";

import { MAIL_LINK_BRIDGE_JS } from "@/lib/mail/link-bridge";
import { highlightRanges } from "@/lib/mail/search-highlight";
import { frameImageOrigin, readFrameMessage } from "@/lib/mail/frame-messages";

import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A frame with `html` in its body, the script running, and a fake page. */
function frame(html, head = "") {
  const win = new Window();
  win.document.write(`<!doctype html><html><head>${head}</head><body>${html}</body></html>`);
  // happy-dom has no custom highlights. A small stand-in records the ranges.
  const registry = new Map();
  Object.defineProperty(win, "CSS", { value: { highlights: registry }, configurable: true });
  win.Highlight = class {
    constructor() {
      this.ranges = [];
    }
    add(range) {
      this.ranges.push(range);
    }
  };
  const sent = [];
  const page = {
    postMessage(message, target) {
      sent.push({ message: JSON.parse(JSON.stringify(message)), target });
    },
  };
  win.eval(`(function (parent) { ${MAIL_LINK_BRIDGE_JS} })`)(page);
  const fromPage = (data, source = page) =>
    win.dispatchEvent(new win.MessageEvent("message", { data: { source: "dh-mail", ...data }, source }));
  const of = (type) => sent.filter((s) => s.message.type === type).map((s) => s.message);
  return { win, doc: win.document, sent, page, fromPage, of, registry };
}

const click = (win, el, init = {}) =>
  el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const rightClick = (win, el) =>
  el.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

/** Every file under a directory, with its text. */
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push({ path, text: readFileSync(path, "utf8") });
  }
  return out;
}

suite(async () => {
  // --- The script cannot reach the page ------------------------------------

  const parentUses = MAIL_LINK_BRIDGE_JS.match(/\bparent\.\w+/g) ?? [];
  check(
    "the script uses the parent only to post to it",
    parentUses.length > 0 && parentUses.every((use) => use === "parent.postMessage"),
    [...new Set(parentUses)].join(", ")
  );
  check(
    "no backtick or interpolation leaked into the script text",
    !MAIL_LINK_BRIDGE_JS.includes("`") && !MAIL_LINK_BRIDGE_JS.includes("${")
  );

  const mailDir = join(process.cwd(), "../../products/mail/packages/mail");
  const view = readFileSync(join(mailDir, "components/mail/EmailHtmlView.tsx"), "utf8");
  const sandbox = /sandbox="([^"]*)"/.exec(view)?.[1] ?? "";
  check(
    "the message frame is sandboxed without allow-same-origin",
    sandbox.includes("allow-scripts") && !sandbox.includes("allow-same-origin"),
    sandbox
  );
  const readers = sourceFiles(mailDir).filter((f) => /\.contentDocument\b/.test(f.text));
  check(
    "no mail code reads a frame's document",
    readers.length === 0,
    readers.map((f) => f.path.slice(mailDir.length + 1)).join(", ")
  );

  // --- Start -------------------------------------------------------------------

  {
    const f = frame("<p>Two bits of good news.</p>");
    check("the script says hello when it starts", f.of("hello").length === 1);
    check("every message is posted to the parent with the bridge's source", f.sent.every((s) => s.message.source === "dh-mail" && s.target === "*"));
    check("nothing is measured before the page sends the config", f.of("size").length === 0);
    f.fromPage({ type: "config", zoom: 1.25, dark: false, terms: [] }, { other: true });
    check("a config from another window is ignored", f.of("size").length === 0);
    f.fromPage({ type: "config", zoom: 1.25, dark: false, terms: [] });
    const size = f.of("size")[0];
    check(
      "after the config, the frame sends its size",
      size && ["height", "natural", "narrowest", "zoom"].every((k) => typeof size[k] === "number"),
      JSON.stringify(size)
    );
    check("the config's zoom goes on the body", f.doc.body.style.zoom === "1.25", f.doc.body.style.zoom);
    f.fromPage({ type: "zoom", value: 0.8 });
    check("a later zoom goes on the body", f.doc.body.style.zoom === "0.8", f.doc.body.style.zoom);
    check("the measuring probes are gone after a read", f.doc.querySelectorAll("style[data-dh-probe]").length === 0);
  }

  // --- Links -------------------------------------------------------------------

  {
    const f = frame(
      '<span id="web" data-dh-href="https://news.example/story"><b id="inner">Read</b></span>' +
        '<a id="mail" href="mailto:ada@example.org?subject=Hi">Ada</a>' +
        '<span id="bad" data-dh-href="javascript:alert(1)">Bad</span>' +
        '<span id="rel" data-dh-href="/local/path">Relative</span>' +
        '<a id="hash" href="#top">Top</a>'
    );
    click(f.win, f.doc.getElementById("inner"));
    click(f.win, f.doc.getElementById("mail"));
    const opened = f.of("open-url").map((m) => m.url);
    check("a click inside a link span sends the address", opened[0] === "https://news.example/story", opened.join(" "));
    check("a mailto is sent as it is", opened[1] === "mailto:ada@example.org?subject=Hi", opened.join(" "));
    const before = opened.length;
    const badEvent = new f.win.MouseEvent("click", { bubbles: true, cancelable: true });
    f.doc.getElementById("bad").dispatchEvent(badEvent);
    click(f.win, f.doc.getElementById("rel"));
    click(f.win, f.doc.getElementById("hash"));
    check("a javascript: link, a relative link and an anchor send nothing", f.of("open-url").length === before);
    check("and the javascript: link does not run by itself either", badEvent.defaultPrevented);
  }

  // --- The two right-click menus -----------------------------------------------

  {
    const f = frame(
      '<a href="https://news.example/story"><img id="linked" src="dhmail://localhost/abc"></a>' +
        '<img id="alone" src="data:image/png;base64,iVBORw0KGgo=">' +
        '<a id="text" href="https://news.example/more">More</a>' +
        '<p id="words">Choir moves to Thursday.</p>'
    );
    rightClick(f.win, f.doc.getElementById("linked"));
    rightClick(f.win, f.doc.getElementById("alone"));
    rightClick(f.win, f.doc.getElementById("text"));
    const menus = f.of("link-menu");
    check("a linked picture: the link and the picture", menus[0]?.url === "https://news.example/story" && menus[0]?.image === "dhmail://localhost/abc", JSON.stringify(menus[0]));
    check("a picture alone: the picture, and no link", menus[1]?.url === "" && /^data:image\/png/.test(menus[1]?.image ?? ""), JSON.stringify(menus[1]));
    check("a text link: no picture", menus[2]?.url === "https://news.example/more" && menus[2]?.image === "", JSON.stringify(menus[2]));
    check("the menu carries the frame's own size, so the page can scale the point", typeof menus[0]?.width === "number" && typeof menus[0]?.height === "number");
    rightClick(f.win, f.doc.getElementById("words"));
    const own = f.of("message-menu")[0];
    check("a right-click on the words opens the message's own menu", own && own.selectedText === "", JSON.stringify(own));
    f.doc.getElementById("words").dispatchEvent(new f.win.MouseEvent("mousedown", { bubbles: true, button: 0 }));
    check("a press in the frame is sent, so the page closes its menus", f.of("press").length >= 1);
  }

  // --- Keys and the double click -------------------------------------------------

  {
    const f = frame("<p>Two bits of good news.</p>");
    const key = (init) => {
      const event = new f.win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      f.doc.body.dispatchEvent(event);
      return event;
    };
    const reload = key({ key: "r", metaKey: true });
    const copy = key({ key: "c", metaKey: true });
    const archive = key({ key: "a", metaKey: true, shiftKey: true });
    const plain = key({ key: "j" });
    const keys = f.of("key");
    check("each key goes to the page", keys.length === 4 && keys[0].key === "r" && keys[0].metaKey === true, JSON.stringify(keys));
    check("Cmd+R does nothing inside the frame", reload.defaultPrevented);
    check("Cmd+C still copies", !copy.defaultPrevented);
    check("Cmd+Shift+A is the page's, not select all", archive.defaultPrevented);
    check("a plain key keeps its own meaning", !plain.defaultPrevented);

    click(f.win, f.doc.body);
    click(f.win, f.doc.body);
    check("two quick clicks beside the words are one double click", f.of("dblclick").length === 1);
  }

  // --- Dark mode -----------------------------------------------------------------

  const lightness = (css) => {
    const m = /hsla?\(\s*[\d.]+(?:deg)?[ ,]+[\d.]+%[ ,]+([\d.]+)%/.exec(css || "");
    return m ? Number(m[1]) : null;
  };
  {
    // A browser hands back a computed colour as rgb(), which is what the
    // script reads; happy-dom hands back what was written, so the fixtures
    // write rgb().
    const f = frame(
      '<div id="card" style="background-color:rgb(255, 255, 255);color:rgb(17, 17, 17);border:1px solid rgb(221, 221, 221)">' +
        '<p id="words">Choir moves to Thursday.</p>' +
        '<img id="pic" src="data:image/png;base64,AAAA" style="color:rgb(17, 17, 17)">' +
        "</div>"
    );
    f.fromPage({ type: "config", zoom: 1, dark: false, terms: [] });
    const card = f.doc.getElementById("card");
    check("no re-lighting without dark mode", !/hsl/.test(card.getAttribute("style")), card.getAttribute("style"));
    f.fromPage({ type: "config", zoom: 1, dark: true, terms: [] });
    const bg = lightness(card.style.getPropertyValue("background-color"));
    const fg = lightness(card.style.getPropertyValue("color"));
    check("a white card turns dark", bg !== null && bg < 30, card.getAttribute("style"));
    check("its dark words turn light", fg !== null && fg > 70, card.getAttribute("style"));
    check("a drawn border is turned with them", /hsl/.test(card.style.getPropertyValue("border-color")), card.getAttribute("style"));
    check("a picture keeps its own colours", !/hsl/.test(f.doc.getElementById("pic").getAttribute("style")), f.doc.getElementById("pic").getAttribute("style"));
  }
  {
    const f = frame(
      '<div id="card" style="background-color:rgb(255, 255, 255);color:rgb(17, 17, 17)">Hej</div>',
      '<meta name="color-scheme" content="light dark">'
    );
    f.fromPage({ type: "config", zoom: 1, dark: true, terms: [] });
    check(
      "a mail that declares its own dark styles is left to them",
      !/hsl/.test(f.doc.getElementById("card").getAttribute("style")) &&
        f.doc.documentElement.style.getPropertyValue("color-scheme") === "dark",
      f.doc.getElementById("card").getAttribute("style")
    );
  }

  // --- Search words and find -------------------------------------------------------

  {
    const text = "Hôtel à PARIS, then a Parisian trip. 🎉 paris";
    const f = frame(`<p id="p">${text}</p><style>p{}</style>`);
    f.fromPage({ type: "config", zoom: 1, dark: false, terms: ["paris", "hotel"] });
    const painted = f.registry.get("dh-search-hit")?.ranges.map((r) => r.toString()) ?? [];
    const expected = highlightRanges(text, ["paris", "hotel"]).map(([a, b]) => Array.from(text).slice(a, b).join(""));
    check(
      "the frame paints the search words as the list paints them",
      JSON.stringify(painted) === JSON.stringify(expected),
      `${JSON.stringify(painted)} vs ${JSON.stringify(expected)}`
    );
    f.fromPage({ type: "terms", terms: [] });
    check("no words, no paint", !f.registry.has("dh-search-hit"));

    f.fromPage({ type: "find", id: 7, needle: "paris" });
    const result = f.of("find-result")[0];
    check("find answers with its id and one place per match", result?.id === 7 && result?.tops?.length === 3, JSON.stringify(result));
    check("find paints every match", f.registry.get("mail-find")?.ranges.length === 3);
    f.fromPage({ type: "find-show", id: 8, index: 1 });
    const shown = f.of("find-shown")[0];
    check("showing one match paints it on top and says where it is", shown?.id === 8 && f.registry.get("mail-find-active")?.ranges.length === 1, JSON.stringify(shown));
    f.fromPage({ type: "find-clear" });
    check("clearing find takes its paint away", !f.registry.has("mail-find") && !f.registry.has("mail-find-active"));
  }

  // --- The page side ---------------------------------------------------------------

  {
    const view = {};
    const message = (source, data) => ({ source, data });
    const fake = { contentWindow: view };
    check(
      "the page reads a message from the frame's own window",
      readFrameMessage(message(view, { source: "dh-mail", type: "size" }), fake)?.type === "size"
    );
    check(
      "and not one from another window, even with the right source",
      readFrameMessage(message({}, { source: "dh-mail", type: "open-url", url: "https://x.example" }), fake) === null
    );
    check(
      "and not one without the bridge's source",
      readFrameMessage(message(view, { type: "size" }), fake) === null
    );
    check("an origin goes into the frame's CSP as it is", frameImageOrigin("tauri://localhost") === "tauri://localhost");
    check(
      "a value that could add a directive does not",
      frameImageOrigin("http://a.example; script-src *") === "" && frameImageOrigin("null") === ""
    );
  }

  await sleep(0);
});
