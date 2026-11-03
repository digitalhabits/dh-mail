//! Diagnostics: the page's chosen events into the app's log, the log read
//! back for the report, and the report saved where the reader picks.
//!
//! What goes into a report is decided and cleaned on the page
//! (lib/mail/diagnostics.ts): mailboxes by number, no mail, no addresses.
//! Nothing here sends anything anywhere. The reader saves the file and
//! chooses whether to send it.

use std::path::PathBuf;

use tauri::Manager as _;
use tauri_plugin_dialog::DialogExt;

/// The most of one event line that is kept: an event is a few short fields.
const MAX_LINE: usize = 600;
/// The most of the log a report carries: the end of it, the latest days.
const MAX_LOG_BYTES: usize = 600_000;

/// One event from the page, as an Info line under the `diag` target.
#[tauri::command]
pub fn mail_diag_log(line: String) {
  let line: String = line.replace(['\n', '\r'], " ").chars().take(MAX_LINE).collect();
  log::info!(target: "diag", "{line}");
}

/// The app's log files, oldest first: the rotated ones, then the current one.
fn log_files(app: &tauri::AppHandle) -> Vec<PathBuf> {
  let Ok(dir) = app.path().app_log_dir() else {
    return Vec::new();
  };
  let Ok(entries) = std::fs::read_dir(&dir) else {
    return Vec::new();
  };
  let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.extension().is_some_and(|ext| ext == "log"))
    .filter_map(|path| {
      let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok()?;
      Some((modified, path))
    })
    .collect();
  files.sort_by_key(|(modified, _)| *modified);
  files.into_iter().map(|(_, path)| path).collect()
}

/// The end of the log, for the report: the latest lines across the files,
/// up to MAX_LOG_BYTES, cut at a line so no line is half there.
#[tauri::command]
pub fn mail_diagnostics_log(app: tauri::AppHandle) -> String {
  let mut text = String::new();
  for path in log_files(&app) {
    if let Ok(bytes) = std::fs::read(&path) {
      text.push_str(&String::from_utf8_lossy(&bytes));
      if !text.ends_with('\n') {
        text.push('\n');
      }
    }
  }
  if text.len() <= MAX_LOG_BYTES {
    return text;
  }
  let mut start = text.len() - MAX_LOG_BYTES;
  while !text.is_char_boundary(start) {
    start += 1;
  }
  match text[start..].find('\n') {
    Some(cut) => text[start + cut + 1..].to_string(),
    None => text[start..].to_string(),
  }
}

/// Save the report where the reader picks, in Downloads to start with.
/// The path saved to, or None when the reader cancelled.
#[tauri::command]
pub async fn mail_diagnostics_save(
  app: tauri::AppHandle,
  text: String,
  file_name: String,
) -> Result<Option<String>, String> {
  // A name the page gave, cut to its last part: never a path somewhere else.
  let name = std::path::Path::new(&file_name)
    .file_name()
    .and_then(|n| n.to_str())
    .filter(|n| !n.is_empty())
    .unwrap_or("Mail diagnostics.txt")
    .to_string();
  let mut dialog = app.dialog().file().set_file_name(&name).add_filter("Text", &["txt"]);
  if let Ok(downloads) = app.path().download_dir() {
    dialog = dialog.set_directory(downloads);
  }
  let Some(picked) = dialog.blocking_save_file() else {
    return Ok(None);
  };
  let path = picked.into_path().map_err(|err| err.to_string())?;
  std::fs::write(&path, text).map_err(|err| err.to_string())?;
  log::info!(target: "diag", "diag · diagnostics saved");
  Ok(Some(path.display().to_string()))
}

/// Left in the log folder by a panic: the next start offers the report.
const CRASH_MARKER: &str = "last-crash";
/// Left while the app runs and taken away on a normal quit: still there at
/// the next start, the last run did not end normally (a crash the hook did
/// not see, or a force quit). Release builds only: a development build is
/// stopped and started on every save.
const RUNNING_MARKER: &str = "running";
/// The most of a panic's backtrace kept: where it happened, not every frame.
const MAX_TRACE_LINES: usize = 40;

fn marker(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
  let dir = app.path().app_log_dir().ok()?;
  std::fs::create_dir_all(&dir).ok()?;
  Some(dir.join(name))
}

/// A panic anywhere goes into the log, with where and a short backtrace,
/// and leaves the crash marker. The usual report on stderr still follows.
/// What a panic says can hold anything: the report is scrubbed on the page.
pub fn install_crash_log(app: &tauri::AppHandle) {
  let crash = marker(app, CRASH_MARKER);
  let previous = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let place = info
      .location()
      .map(|at| format!("{}:{}", at.file(), at.line()))
      .unwrap_or_else(|| "unknown".into());
    let payload = info.payload();
    let message = payload
      .downcast_ref::<&str>()
      .map(|s| (*s).to_string())
      .or_else(|| payload.downcast_ref::<String>().cloned())
      .unwrap_or_else(|| "(no message)".into());
    let message: String = message.replace(['\n', '\r'], " ").chars().take(MAX_LINE).collect();
    let trace = std::backtrace::Backtrace::force_capture().to_string();
    let trace: Vec<&str> = trace.lines().take(MAX_TRACE_LINES).collect();
    let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
    log::error!(
      target: "crash",
      "diag · rust panic · thread={thread} · at={place} · message={message}\n{}",
      trace.join("\n")
    );
    if let Some(path) = &crash {
      let _ = std::fs::write(path, place.as_bytes());
    }
    previous(info);
  }));
  if !cfg!(debug_assertions) {
    if let Some(path) = marker(app, RUNNING_MARKER) {
      if path.exists() {
        log::warn!(target: "crash", "diag · last run did not end normally");
        if let Some(crash) = marker(app, CRASH_MARKER) {
          if !crash.exists() {
            let _ = std::fs::write(crash, b"unclean exit");
          }
        }
      }
      let _ = std::fs::write(path, b"");
    }
  }
}

/// A normal quit: the run ended as it should.
pub fn mark_clean_exit(app: &tauri::AppHandle) {
  if let Some(path) = marker(app, RUNNING_MARKER) {
    let _ = std::fs::remove_file(path);
  }
}

/// Whether the last run ended in a crash, once: true, and the marker goes.
#[tauri::command]
pub fn mail_diagnostics_last_crash(app: tauri::AppHandle) -> bool {
  let Some(path) = marker(&app, CRASH_MARKER) else {
    return false;
  };
  if !path.exists() {
    return false;
  }
  let _ = std::fs::remove_file(&path);
  true
}

