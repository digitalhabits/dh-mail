/**
 * Cmd+V in the link box that Cmd+K opens.
 *
 * In the Mac app, Cmd+V put nothing in that box (a KU tester, 2026-11-05).
 * Every other box in the app pastes. So the box does the paste itself, the
 * way the editor's own paste-without-formatting key does: it reads the
 * clipboard through the app, which needs no Paste button, and puts the
 * text in at the caret.
 *
 * Outside the desktop app the browser's own paste is left alone.
 */

import { isNativeShell, readClipboardText } from "@/lib/native-shell";

/** Put the text in the box at the caret, over any text that is selected. */
export function pasteIntoLinkBox(box: HTMLInputElement, text: string): void {
  // An address is one line. A copied address can end in a line break.
  const clean = text.replace(/\s*[\r\n]+\s*/g, "").trim();
  if (!clean) return;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? start;
  box.setRangeText(clean, start, end, "end");
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

/** True for Cmd+V and for nothing else: not Paste without Formatting. */
function isPasteKey(event: KeyboardEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === "KeyV"
  );
}

/** Listen on the link box. Answers the function that stops listening. */
export function bindLinkBoxPaste(box: HTMLInputElement): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isPasteKey(event) || !isNativeShell()) return;
    event.preventDefault();
    void readClipboardText()
      .then((text) => text ?? navigator.clipboard?.readText?.())
      .then((text) => {
        if (typeof text === "string") pasteIntoLinkBox(box, text);
      })
      .catch(() => {
        // Nothing readable: nothing is pasted.
      });
  };
  box.addEventListener("keydown", onKeyDown);
  return () => box.removeEventListener("keydown", onKeyDown);
}
