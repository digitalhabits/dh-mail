/**
 * The walk itself — see mounted-editor-keeps-styles.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { RichTextEditor } from "@/components/ui/RichTextEditor";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAVED = '<p><span style="font-size: 8pt; color: rgb(128, 128, 128);">Ragna Holm</span></p>';

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(RichTextEditor, { defaultValue: SAVED, onChange: () => {} }));
    for (let i = 0; i < 50 && !document.querySelector(".ql-editor"); i++) await sleep(100);
    await sleep(300);
    const editor = document.querySelector(".ql-editor");
    assert(editor, "the editor is there");
    const html = editor.innerHTML;
    assert(/font-size:\s*8pt/.test(html), `the size stays: ${html}`);
    assert(/color:\s*(#808080|rgb\(128,\s*128,\s*128\))/.test(html), `the colour stays: ${html}`);
    pass("saved text opens with its own size and colour");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the editor walk failed:", err);
    process.exit(1);
  }
}

void main();
