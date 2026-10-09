//! Dragging an attachment out of the window and onto the desktop.
//!
//! A web page can start a drag, but what it carries is text and URLs. Finder
//! takes files, and a file on the drag pasteboard is something only the native
//! side can put there. So the page reads the bytes the same way it reads them
//! to save a file, this writes a copy where a drag can point at it, and the
//! window begins a real drag from that copy.
//!
//! Two commands, because a drag cannot be kept waiting. Reading a 20 MB
//! attachment out of Gmail takes long enough that a session begun afterwards
//! would start under a pointer that has already arrived somewhere — so the
//! bytes are staged while the button is going down, and `drag_files` starts
//! the drag with the path already in hand.
//!
//! The copies are scratch: a folder of ours in the system temp dir, swept of
//! anything left from a day ago whenever a new one is written. The file has to
//! outlive the drag, and Finder copies it rather than taking it, so nothing can
//! be deleted the moment the pointer is let go.

#![cfg(target_os = "macos")]

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use drag::{DragItem, DragMode, Image, Options};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::NSString;

use crate::downloads::{decode_base64, safe_file_name, unique_path};

/// Where the copies live. One folder, so a sweep has one place to look.
fn drag_dir() -> PathBuf {
  std::env::temp_dir().join("digital-habits-mail-drag")
}

/// How long a staged copy is kept. Long enough that nothing disappears from
/// under a drag; short enough that a mailbox read for a month is not a folder
/// of every file that was ever dragged out of it.
const KEEP: Duration = Duration::from_secs(24 * 60 * 60);

/// Drop copies older than [`KEEP`]. Best effort — a file that will not go is
/// not a reason to refuse the drag the reader asked for.
fn sweep(dir: &Path) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  let now = SystemTime::now();
  for entry in entries.flatten() {
    let old = entry
      .metadata()
      .and_then(|m| m.modified())
      .map(|at| now.duration_since(at).unwrap_or_default() > KEEP)
      .unwrap_or(false);
    if old {
      let _ = std::fs::remove_file(entry.path());
    }
  }
}

/// Write the attachment where a drag can point at it, and answer where.
///
/// The same bytes staged twice keep the same copy: a reader who takes hold of
/// a file, thinks better of it, and takes hold again would otherwise leave
/// "report (2).pdf" behind and then drag it, which is not the name they saw.
#[tauri::command]
pub fn stage_attachment_for_drag(
  filename: String,
  content_base64: String,
) -> Result<String, String> {
  let bytes = decode_base64(&content_base64)?;
  let dir = drag_dir();
  std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make room for the file: {e}"))?;
  sweep(&dir);
  Ok(stage_into(&dir, &filename, &bytes)?.to_string_lossy().to_string())
}

/// The copy itself. The sender named the file, so the name is cleaned the way
/// a saved file's name is: what is dragged out cannot be a path.
fn stage_into(dir: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
  let name = safe_file_name(filename);
  let held = dir.join(&name);
  if std::fs::read(&held).map(|had| had == bytes).unwrap_or(false) {
    return Ok(held);
  }

  let path = unique_path(dir, &name, &|p| p.exists());
  std::fs::write(&path, bytes).map_err(|e| format!("Couldn't write the file: {e}"))?;
  Ok(path)
}

/// Begin a drag of files already on disk.
///
/// Called on `dragstart`, in place of the drag the page cannot do. The command
/// is synchronous on purpose: Tauri runs those on the main thread, which is
/// where AppKit takes a dragging session.
#[tauri::command]
pub fn drag_files(window: tauri::Window, paths: Vec<String>) -> Result<(), String> {
  let files: Vec<PathBuf> = paths
    .iter()
    .map(PathBuf::from)
    .filter(|p| p.exists())
    .collect();
  let Some(first) = files.first().cloned() else {
    return Err("there is no file to drag".to_string());
  };

  drag::start_drag(
    &window,
    DragItem::Files(files),
    Image::Raw(file_icon(&first)?),
    // Where it landed is Finder's business, and the page has nothing to
    // change either way: the copy stays until the sweep takes it.
    |_result, _cursor| {},
    Options {
      skip_animatation_on_cancel_or_failure: false,
      mode: DragMode::Copy,
    },
  )
  .map_err(|e| format!("Couldn't start the drag: {e}"))
}

/// What the pointer carries: the icon Finder would show for this file.
///
/// As bytes, because the drag crate builds its own `NSImage` and panics on one
/// it cannot make — so a picture that will not draw has to fail here, with
/// something to read, rather than there.
fn file_icon(path: &Path) -> Result<Vec<u8>, String> {
  let workspace = NSWorkspace::sharedWorkspace();
  let icon = workspace.iconForFile(&NSString::from_str(&path.to_string_lossy()));
  icon
    .TIFFRepresentation()
    .map(|data| data.to_vec())
    .ok_or_else(|| "Couldn't draw the file's icon".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A folder of this test's own, so two runs cannot see each other's files.
  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dh-drag-test-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn the_same_file_picked_up_twice_is_the_same_copy() {
    let dir = scratch("same");
    let first = stage_into(&dir, "report.pdf", b"one").unwrap();
    let again = stage_into(&dir, "report.pdf", b"one").unwrap();
    assert_eq!(first, again);
    assert_eq!(first.file_name().unwrap(), "report.pdf");
  }

  #[test]
  fn two_different_files_of_one_name_both_survive() {
    let dir = scratch("clash");
    let first = stage_into(&dir, "report.pdf", b"one").unwrap();
    let other = stage_into(&dir, "report.pdf", b"two").unwrap();
    assert_ne!(first, other);
    assert_eq!(std::fs::read(&first).unwrap(), b"one");
    assert_eq!(std::fs::read(&other).unwrap(), b"two");
  }

  #[test]
  fn a_name_from_the_sender_cannot_reach_out_of_the_folder() {
    let dir = scratch("escape");
    let path = stage_into(&dir, "../../.ssh/authorized_keys", b"no").unwrap();
    assert_eq!(path.parent().unwrap(), dir);
    assert_eq!(path.file_name().unwrap(), "authorized_keys");
  }
}
