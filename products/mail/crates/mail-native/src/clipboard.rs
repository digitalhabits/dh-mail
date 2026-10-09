//! Reading the pasteboard, for paste without formatting.
//!
//! Cmd+Shift+V has to put the words in without their styling, and the only
//! way a page can do that is to have the words. Asking the page's own
//! clipboard for them — `navigator.clipboard.readText()` — puts a Paste
//! button on screen in WebKit: the reader presses the shortcut, then presses
//! a button to confirm the thing they just asked for.
//!
//! The app has no such problem. It is the app the pasteboard belongs to, so
//! it reads it and hands the text over, and the shortcut does what it says.
//!
//! Text only. A picture on the pasteboard is a picture the composer already
//! handles through an ordinary paste, and this is the plain-words path.

#![cfg(target_os = "macos")]

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};

/// What is on the pasteboard as plain text, or nothing.
#[tauri::command]
pub fn read_clipboard_text() -> Option<String> {
  // Safety: AppKit, on the main thread — a synchronous command, which Tauri
  // runs there. NSPasteboard is read-only here.
  unsafe {
    let board = NSPasteboard::generalPasteboard();
    board
      .stringForType(NSPasteboardTypeString)
      .map(|text| text.to_string())
  }
}
