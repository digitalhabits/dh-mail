/*!
  A message another app of ours writes for Mail to open in its composer:
  addressed, and perhaps with a file attached.

  The two are separate processes, and a message with a PDF in it is far too
  big for a link. So the other app writes it as a file into the receiving
  Mail app's own data folder and asks macOS to bring that app forward. Mail picks the
  file up when it starts, and whenever its window comes forward, and opens
  it as it opened a message from the pane (`popout::notify_mail_compose_seed`).
  Picking a file up deletes it, so a message opens once.

  Only the internal app's folder is written to. The public app has its own
  folder, which nothing writes to, so it never opens a message from here.
*/

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

/// The app that messages are handed to. A bundle identifier, so it stays as
/// it is.
pub const MAIL_INTERNAL_ID: &str = "org.digitalhabits.mail.internal";

/// Inside an app's data folder.
const SUBDIR: &str = "handoff/compose";

/// A message not picked up in this time was not wanted any more: it is
/// thrown away rather than opened by surprise days later.
const MAX_AGE: Duration = Duration::from_secs(15 * 60);

fn folder_in(app_data: &Path) -> PathBuf {
  app_data.join(SUBDIR)
}

/// Write the message where Mail (Internal) will look. Written under another
/// name first and then renamed, so Mail never reads half a file.
pub fn write_seed(mail_data: &Path, seed: &serde_json::Value) -> std::io::Result<PathBuf> {
  let dir = folder_in(mail_data);
  fs::create_dir_all(&dir)?;
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
  let name = format!("{stamp:013}-{}", std::process::id());
  let part = dir.join(format!("{name}.part"));
  let done = dir.join(format!("{name}.json"));
  fs::write(&part, serde_json::to_vec(seed).map_err(std::io::Error::other)?)?;
  fs::rename(&part, &done)?;
  Ok(done)
}

/// The oldest message waiting that is still fresh, taken out of the folder.
/// Stale ones and half-written leftovers are deleted on the way.
pub fn take_seed(app_data: &Path, now: SystemTime) -> Option<serde_json::Value> {
  let dir = folder_in(app_data);
  let mut waiting: Vec<PathBuf> = fs::read_dir(&dir)
    .ok()?
    .filter_map(|e| e.ok().map(|e| e.path()))
    .collect();
  // The names start with the time, so by name is oldest first.
  waiting.sort();
  for path in waiting {
    let fresh = fs::metadata(&path)
      .and_then(|m| m.modified())
      .ok()
      .and_then(|at| now.duration_since(at).ok())
      .is_some_and(|age| age <= MAX_AGE);
    let is_json = path.extension().is_some_and(|e| e == "json");
    if !is_json {
      // A ".part" is a write in progress if it is new; else it is a leftover.
      if !fresh {
        let _ = fs::remove_file(&path);
      }
      continue;
    }
    let read = fs::read(&path);
    let _ = fs::remove_file(&path);
    if !fresh {
      continue;
    }
    if let Ok(seed) = read.and_then(|bytes| serde_json::from_slice(&bytes).map_err(std::io::Error::other)) {
      return Some(seed);
    }
  }
  None
}

/// Mail's side: open a message another app left, if there is one. Called
/// when the app starts and when its main window comes forward.
pub fn deliver_waiting(app: &tauri::AppHandle) {
  let Ok(data) = app.path().app_data_dir() else {
    return;
  };
  if let Some(seed) = take_seed(&data, SystemTime::now()) {
    if let Err(err) = crate::popout::notify_mail_compose_seed(app.clone(), seed) {
      log::warn!("handoff: could not open the message left for Mail: {err}");
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandOff {
  /// Mail (Internal) was asked to come forward. False when it could not be:
  /// not installed, or a system with no way to ask. The message still waits
  /// and opens when Mail (Internal) is next opened.
  opened: bool,
}

/// The writing app's side: write the message for the receiving Mail app
/// and bring it forward.
#[tauri::command]
pub fn hand_compose_to_mail(app: tauri::AppHandle, seed: serde_json::Value) -> Result<HandOff, String> {
  let base = app.path().data_dir().map_err(|e| e.to_string())?;
  write_seed(&base.join(MAIL_INTERNAL_ID), &seed).map_err(|e| format!("could not hand the message to Mail: {e}"))?;
  Ok(HandOff { opened: bring_mail_forward() })
}

#[cfg(target_os = "macos")]
fn bring_mail_forward() -> bool {
  std::process::Command::new("open")
    .args(["-b", MAIL_INTERNAL_ID])
    .status()
    .is_ok_and(|s| s.success())
}

/// Mail (Internal) has no Windows build to bring forward yet; the message
/// waits for it to be opened.
#[cfg(not(target_os = "macos"))]
fn bring_mail_forward() -> bool {
  false
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "mail-handoff-{}-{}",
      std::process::id(),
      SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn a_message_written_is_taken_once() {
    let dir = temp();
    let seed = serde_json::json!({ "subject": "Joining details", "bodyHtml": "<p>Hej</p>" });
    write_seed(&dir, &seed).unwrap();
    assert_eq!(take_seed(&dir, SystemTime::now()), Some(seed));
    assert_eq!(take_seed(&dir, SystemTime::now()), None);
  }

  #[test]
  fn the_oldest_waiting_message_comes_first() {
    let dir = temp();
    write_seed(&dir, &serde_json::json!({ "subject": "first" })).unwrap();
    std::thread::sleep(Duration::from_millis(5));
    write_seed(&dir, &serde_json::json!({ "subject": "second" })).unwrap();
    assert_eq!(take_seed(&dir, SystemTime::now()).unwrap()["subject"], "first");
    assert_eq!(take_seed(&dir, SystemTime::now()).unwrap()["subject"], "second");
  }

  #[test]
  fn a_stale_message_is_thrown_away_not_opened() {
    let dir = temp();
    write_seed(&dir, &serde_json::json!({ "subject": "old" })).unwrap();
    let later = SystemTime::now() + MAX_AGE + Duration::from_secs(60);
    assert_eq!(take_seed(&dir, later), None);
    assert_eq!(fs::read_dir(folder_in(&dir)).unwrap().count(), 0);
  }

  #[test]
  fn half_a_file_is_never_read() {
    let dir = temp();
    fs::create_dir_all(folder_in(&dir)).unwrap();
    fs::write(folder_in(&dir).join("0000000000001-1.part"), b"{\"subj").unwrap();
    assert_eq!(take_seed(&dir, SystemTime::now()), None);
    // A fresh one is a write in progress, and is left for its writer.
    assert_eq!(fs::read_dir(folder_in(&dir)).unwrap().count(), 1);
  }

  #[test]
  fn no_folder_is_no_message() {
    assert_eq!(take_seed(&temp(), SystemTime::now()), None);
  }
}
