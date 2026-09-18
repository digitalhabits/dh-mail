//! Writes still in flight, counted per window.
//!
//! A delete, an archive, a send: the page removes the row at once and tells
//! the mailbox in the background. The background work runs in the webview,
//! so a window closed right after the click killed the request — the app
//! said "moved to Trash" and the mailbox was never told, and the mail was
//! back on the next open. The page reports how many such writes it has in
//! flight; the shells hold a closing window (and a quitting app) open until
//! the count reaches zero, with a cap so a dead network cannot hold it for
//! ever.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn map() -> &'static Mutex<HashMap<String, usize>> {
  static MAP: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The page says how many writes it has in flight. Zero clears its entry.
#[tauri::command]
pub fn set_pending_mail_writes(window: tauri::Window, count: usize) {
  let mut map = map().lock().unwrap();
  if count == 0 {
    map.remove(window.label());
  } else {
    map.insert(window.label().to_string(), count);
  }
}

/// Writes this window still owes the mailbox.
pub fn pending_for(label: &str) -> usize {
  map().lock().unwrap().get(label).copied().unwrap_or(0)
}

/// Writes every window together still owes the mailbox.
pub fn pending_total() -> usize {
  map().lock().unwrap().values().sum()
}

/// A destroyed window can finish nothing; its count must not hold the app.
pub fn forget_window(label: &str) {
  map().lock().unwrap().remove(label);
}
