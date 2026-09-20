//! The colour behind the page.
//!
//! A window has a colour of its own, under every web view in it. It shows
//! whenever the page is not there to cover it: before the first paint at
//! launch, and for a few frames each time the window grows, because the
//! window grows at once and the web views lay out again a moment later.
//!
//! The colour in `tauri.conf.json` is the light theme's cream, and a fixed
//! value cannot be anything else. On a dark theme that was a cream flash at
//! launch and a cream border on every zoom. So the page says what it paints
//! (`set_window_backdrop`), the window takes that colour, and the colour is
//! kept in a file for the next launch, when no page is up yet to ask.

use std::path::PathBuf;

use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime};

const FILE: &str = "window-backdrop";

/// `#rrggbb` only. The page sends what it read from its own styles, and a
/// colour with an alpha would make the window see-through.
pub fn parse(hex: &str) -> Option<Color> {
  let digits = hex.trim().strip_prefix('#')?;
  if digits.len() != 6 || !digits.is_ascii() {
    return None;
  }
  let part = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
  Some(Color(part(0)?, part(2)?, part(4)?, 255))
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
  app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

/// The colour the main window had when the app last ran, if it said one.
pub fn stored<R: Runtime>(app: &AppHandle<R>) -> Option<Color> {
  let text = std::fs::read_to_string(file(app)?).ok()?;
  parse(&text)
}

/// Call from `setup`, before the window is on screen: the main window opens
/// in the colour it closed in.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
  let Some(color) = stored(app) else { return };
  // At setup the main window holds one web view, so it is still a
  // WebviewWindow, and this one call paints the window and the view.
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_background_color(Some(color));
  }
}

fn paint<R: Runtime>(window: &tauri::Window<R>, color: Color) {
  let _ = window.set_background_color(Some(color));
  // Each web view has a colour under its page too, which is what shows
  // while a document loads and past the end of a scroll.
  for webview in window.webviews() {
    let _ = webview.set_background_color(Some(color));
  }
}

/// The page tells the shell what colour it paints at its edges.
#[tauri::command]
pub fn set_window_backdrop<R: Runtime>(
  webview: tauri::Webview<R>,
  color: String,
) -> Result<(), String> {
  let parsed = parse(&color).ok_or_else(|| format!("Not a #rrggbb color: {color}"))?;
  let window = webview.window();
  paint(&window, parsed);
  // Only the main window is there at launch. A reader window or a pop-out
  // is opened by a page that is already up.
  if window.label() == "main" {
    if let Some(path) = file(webview.app_handle()) {
      if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
      }
      let _ = std::fs::write(path, color.trim());
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::parse;

  #[test]
  fn reads_a_six_digit_color() {
    let color = parse("#1a2735").expect("a color");
    assert_eq!((color.0, color.1, color.2, color.3), (0x1a, 0x27, 0x35, 255));
  }

  #[test]
  fn refuses_anything_else() {
    for bad in ["", "1a2735", "#fff", "#1a2735cc", "#gggggg", "rgb(0,0,0)", "#1a27é"] {
      assert!(parse(bad).is_none(), "{bad}");
    }
  }
}
