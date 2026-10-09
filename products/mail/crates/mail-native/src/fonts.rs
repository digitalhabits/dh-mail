//! The fonts installed on this computer, for the composer's font list.
//!
//! A web view cannot list them (WebKit has no `queryLocalFonts`), and the
//! reader wants to pick from what is there rather than type a name. The list
//! is family names, sorted, without the hidden system families whose names
//! start with a dot.
//!
//! On the Mac, AppKit's font manager knows them. On Windows, the .NET font
//! collection does, through PowerShell; asked once, as it takes a moment, and
//! kept for the rest of the run. Elsewhere the list is empty, and the page
//! offers its own short list.

use std::sync::OnceLock;

static FONTS: OnceLock<Vec<String>> = OnceLock::new();

/// The installed font families, sorted, each once.
#[tauri::command]
pub async fn list_system_fonts(app: tauri::AppHandle) -> Vec<String> {
  if let Some(fonts) = FONTS.get() {
    return fonts.clone();
  }
  let fonts = read_fonts(app).await;
  FONTS.get_or_init(|| fonts).clone()
}

fn tidy(names: impl IntoIterator<Item = String>) -> Vec<String> {
  let mut out: Vec<String> = names
    .into_iter()
    .map(|n| n.trim().to_string())
    .filter(|n| !n.is_empty() && !n.starts_with('.'))
    .collect();
  out.sort_by_key(|n| n.to_lowercase());
  out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
  out
}

/// AppKit, so on the main thread; the answer comes back over a channel.
#[cfg(target_os = "macos")]
async fn read_fonts(app: tauri::AppHandle) -> Vec<String> {
  use objc2::MainThreadMarker;
  use objc2_app_kit::NSFontManager;
  let (tx, rx) = std::sync::mpsc::channel();
  let asked = app.run_on_main_thread(move || {
    let names = MainThreadMarker::new()
      .map(|mtm| {
        let names = NSFontManager::sharedFontManager(mtm).availableFontFamilies();
        names.iter().map(|name| name.to_string()).collect::<Vec<_>>()
      })
      .unwrap_or_default();
    let _ = tx.send(names);
  });
  if asked.is_err() {
    return Vec::new();
  }
  let names = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_default())
    .await
    .unwrap_or_default();
  tidy(names)
}

/// PowerShell takes a moment, so off the main thread.
#[cfg(target_os = "windows")]
async fn read_fonts(_app: tauri::AppHandle) -> Vec<String> {
  tauri::async_runtime::spawn_blocking(read_windows_fonts)
    .await
    .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn read_windows_fonts() -> Vec<String> {
  use std::os::windows::process::CommandExt;
  // No console window flashing up while it runs.
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let out = std::process::Command::new("powershell")
    .args([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
    ])
    .creation_flags(CREATE_NO_WINDOW)
    .output();
  match out {
    Ok(out) if out.status.success() => tidy(String::from_utf8_lossy(&out.stdout).lines().map(str::to_string)),
    _ => Vec::new(),
  }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn read_fonts(_app: tauri::AppHandle) -> Vec<String> {
  Vec::new()
}

#[cfg(test)]
mod tests {
  use super::tidy;

  #[test]
  fn names_are_sorted_once_and_without_hidden_ones() {
    let names = ["Verdana", " Arial ", "arial", ".SF NS", "", "Georgia"].map(String::from);
    assert_eq!(tidy(names), vec!["Arial", "Georgia", "Verdana"]);
  }
}
