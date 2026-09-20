/**
 * The walk itself — see mounted-editor-keeps.test.mjs.
 *
 * The editor takes HTML three ways, and all three are checked, because they
 * are different paths through Quill and a rule kept by one is not kept by
 * the others:
 *
 * - the first value it is built with,
 * - a value handed to it later, which is the path every entry point uses,
 *   because each one sets state and then remounts the box,
 * - a paste.
 *
 * What the editor drops, it drops on all three: the style block, the SVG,
 * and the words of the style block, which are not read back as writing.
 * What it keeps, it keeps on all three: a picture, including one on a
 * sender's server. Those checks are a record of how Quill behaves today.
 * If one fails after an editor upgrade, read the new answer and decide
 * again. Do not simply write the line to match.
 *
 * The last section is the one that holds the rule: markup handed over the
 * way an entry point hands it over asks nobody for a picture.
 *
 * Every fixture is invented.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";

import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The picture on somebody else's server. Nothing must fetch it. */
const BEACON = "https://beacon.test/opened.png";

/**
 * A message nobody sent, carrying the four things worth asking about.
 *
 * The words and the link must live. The style block, the SVG and the
 * picture on a stranger's server are the ones the app's own document must
 * not take.
 */
const HOSTILE =
  "<p>Two bits of good news.</p>" +
  "<style>body *{visibility:hidden}</style>" +
  '<svg width="10" height="10"><circle cx="5" cy="5" r="4"></circle></svg>' +
  `<img src="${BEACON}" width="20" height="20">` +
  '<p>See <a href="https://notes.example.org/a">the notes</a>.</p>' +
  "<blockquote>A line from before.</blockquote>";

/** A picture the message carries itself. This one must live. */
const CARRIED =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

/** What the editor is holding, as markup and as words. */
function editorNow() {
  const box = document.querySelector(".ql-editor");
  return {
    html: box ? box.innerHTML : "",
    text: box ? (box.textContent || "").replace(/\s+/g, " ").trim() : "",
  };
}

/** Everything the app's own document is now asked to fetch or apply. */
function pageNow() {
  return {
    styles: [...document.querySelectorAll(".ql-editor style")].length,
    svgs: [...document.querySelectorAll(".ql-editor svg")].length,
    remoteImages: [...document.querySelectorAll(".ql-editor img")]
      .map((el) => el.getAttribute("src") || "")
      .filter((src) => /^https?:/i.test(src)),
  };
}

function Host({ mode, html }) {
  const [value, setValue] = React.useState(mode === "first" ? html : "");
  React.useEffect(() => {
    if (mode === "first") return;
    const timer = setTimeout(() => setValue(html), 150);
    return () => clearTimeout(timer);
  }, [mode, html]);
  return React.createElement(RichTextEditor, {
    value,
    onChange: setValue,
    placeholder: "Write a reply",
  });
}

async function mount(mode, html = HOSTILE) {
  document.body.innerHTML = '<div id="r"></div>';
  const root = createRoot(document.getElementById("r"));
  root.render(React.createElement(Host, { mode, html }));
  await sleep(600);
  return root;
}

suite(async () => {
  // --- The first value it is built with -----------------------------------

  let root = await mount("first");
  const box = document.querySelector(".ql-editor");
  check("the editor is running", Boolean(box), box ? "yes" : "no .ql-editor");
  if (!box) {
    root.unmount();
    return;
  }

  let now = editorNow();
  let page = pageNow();
  check(
    "first value: the words come through",
    now.text.includes("Two bits of good news"),
    now.text
  );
  check(
    "first value: the link comes through, with its address",
    now.html.includes('href="https://notes.example.org/a"'),
    now.html.slice(0, 160)
  );
  check("first value: no style block is left in the page", page.styles === 0, page.styles);
  check("first value: no SVG is left in the page", page.svgs === 0, page.svgs);
  check(
    "first value: the words of the style block are not read as writing",
    !now.text.includes("visibility:hidden"),
    now.text
  );
  check(
    "first value: a picture on a stranger's server comes through — so an entry point must take it out",
    page.remoteImages.includes(BEACON),
    page.remoteImages.join(" ")
  );
  root.unmount();

  // --- A value handed to it later -----------------------------------------

  root = await mount("later");
  await sleep(600);
  now = editorNow();
  page = pageNow();
  check(
    "a later value: the words come through",
    now.text.includes("Two bits of good news"),
    now.text
  );
  check(
    "a later value: the link comes through, with its address",
    now.html.includes('href="https://notes.example.org/a"'),
    now.html.slice(0, 160)
  );
  check("a later value: no style block is left in the page", page.styles === 0, page.styles);
  check("a later value: no SVG is left in the page", page.svgs === 0, page.svgs);
  check(
    "a later value: the words of the style block are not read as writing",
    !now.text.includes("visibility:hidden"),
    now.text
  );
  check(
    "a later value: a picture on a stranger's server comes through",
    page.remoteImages.includes(BEACON),
    page.remoteImages.join(" ")
  );

  // --- A paste ------------------------------------------------------------

  const quill = document.querySelector(".ql-editor");
  const data = {
    types: ["text/html", "text/plain"],
    getData: (type) => (type === "text/html" ? HOSTILE : "Two bits of good news."),
  };
  // The window's own Event, not Node's global of the same name: happy-dom
  // refuses an event it did not make.
  const paste = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: data });
  quill.dispatchEvent(paste);
  await sleep(600);

  now = editorNow();
  page = pageNow();
  check("a paste: the words come through", now.text.includes("Two bits of good news"), now.text);
  check("a paste: no style block is left in the page", page.styles === 0, page.styles);
  check("a paste: no SVG is left in the page", page.svgs === 0, page.svgs);
  check(
    "a paste: the words of the style block are not read as writing",
    !now.text.includes("visibility:hidden"),
    now.text
  );
  check(
    "a paste: a picture on a stranger's server comes through",
    page.remoteImages.includes(BEACON),
    page.remoteImages.join(" ")
  );
  root.unmount();

  // --- As an entry point hands it over ------------------------------------

  const handed = dropRemoteImagesForEditing(
    `${HOSTILE}<p>And one carried in the message.</p><img src="${CARRIED}" width="20">`
  );

  check(
    "the picture on a stranger's server is out before the editor sees it",
    !handed.includes(BEACON),
    handed.slice(0, 160)
  );
  check(
    "the picture the message carries itself stays",
    handed.includes(CARRIED),
    handed.slice(-120)
  );
  check(
    "the words stay",
    handed.includes("Two bits of good news"),
    handed.slice(0, 60)
  );
  check(
    "the link stays, with its address",
    handed.includes('href="https://notes.example.org/a"'),
    handed.slice(0, 200)
  );
  check(
    "the quoted line stays",
    handed.includes("A line from before"),
    handed.slice(-160)
  );

  /*
    And the same tag shouted. A provider writes the markup for two of the
    three entry points, and no DOM of ours makes it lower case first.
  */
  const shouted = dropRemoteImagesForEditing(
    `<p>Two bits of good news.</p><IMG SRC="${BEACON}" WIDTH="20">` +
      `<Img Src="${BEACON}">`
  );
  check(
    "a picture in capitals goes too",
    !shouted.includes(BEACON),
    shouted
  );
  check(
    "and the words around it are not touched",
    shouted.includes("Two bits of good news"),
    shouted
  );

  root = await mount("later", handed);
  await sleep(600);
  now = editorNow();
  page = pageNow();
  check(
    "handed over this way, the page asks nobody for a picture",
    page.remoteImages.length === 0,
    page.remoteImages.join(" ")
  );
  check(
    "and the reader still has the words and the link",
    now.text.includes("Two bits of good news") &&
      now.html.includes('href="https://notes.example.org/a"'),
    now.text
  );
  root.unmount();
});
