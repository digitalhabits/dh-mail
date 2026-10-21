/*!
  The drafts folder: drafts another program on this computer writes for
  Mail, one file each, which Mail makes into drafts in its Drafts list.

  For an assistant (Claude, say) that drafts email for the person at the
  keyboard: it writes `<anything>.json` into `drafts-inbox` in Mail's own
  data folder, and the next time Mail looks (when it starts, when its window
  comes forward, and every few seconds while it is open) the draft is there,
  under the account it names. Nothing is sent: a person opens the draft,
  reads it, and presses Send.

  The page checks each one (lib/mail/drafts-inbox.ts). One it cannot make —
  an account not connected here, a reply to a thread that already has a
  draft — is put in `drafts-inbox/not-made` with the reason, so the program
  that wrote it can read why.

  Write under another name first and rename to `.json` when done, or Mail
  may read half a file. Files are taken out of the folder as they are read,
  so each draft is made once.

  `"attachments"`: a list of absolute paths to files on this computer. They
  are read here and handed to the page with the draft (`attachmentFiles`),
  so the draft goes out with them. A path that is missing, not a file, or
  over 25 MB keeps the whole draft back, in `not-made` with the reason: a
  draft without the file it was written to carry is worse than none.

  What Mail writes back, beside the drafts:
  - `made/<file name>`: a receipt for each draft made, with the draft's key,
    the account and the subject, so the program can find its draft again.
  - `answers/<file name>`: the answer to a request (a file with a
    `"request"` field), for a build of Mail that takes requests.

  Looking: a thread here checks the folder every second and a half and
  wakes the page when something waits. The page's own timer slows to a
  crawl while its window is in the background, so a draft left then waited
  until the window came forward.
*/

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::Manager;

/// Inside the app's data folder.
const SUBDIR: &str = "drafts-inbox";
/// Inside the drafts folder: what could not be made, and why.
const NOT_MADE: &str = "not-made";
/// Inside the drafts folder: receipts for the drafts made.
const MADE: &str = "made";
/// Inside the drafts folder: answers to requests.
const ANSWERS: &str = "answers";
/// How often the watch thread looks.
const WATCH_EVERY: std::time::Duration = std::time::Duration::from_millis(1500);
/// What the watch thread tells the page.
pub const WAITING_EVENT: &str = "drafts-inbox-waiting";
/// A draft larger than this is not a draft somebody wrote.
const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// One attachment: what Gmail and Outlook take in a message, and a little less.
const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

fn folder_in(app_data: &Path) -> PathBuf {
  app_data.join(SUBDIR)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Waiting {
  /// The file's name, so a draft that cannot be made is reported under it.
  pub name: String,
  pub draft: serde_json::Value,
  /// The files the draft names in `"attachments"`, read.
  pub attachment_files: Vec<AttachmentFile>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFile {
  pub filename: String,
  pub mime_type: String,
  pub content_base64: String,
}

/// The type a file's extension names, for the message's part header.
fn mime_for(path: &Path) -> &'static str {
  let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
  match ext.as_str() {
    "pdf" => "application/pdf",
    "doc" => "application/msword",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls" => "application/vnd.ms-excel",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt" => "application/vnd.ms-powerpoint",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "txt" => "text/plain",
    "csv" => "text/csv",
    "md" => "text/markdown",
    "ics" => "text/calendar",
    "zip" => "application/zip",
    _ => "application/octet-stream",
  }
}

/// Read the files a draft names, or say which one could not be.
fn read_attachments(draft: &serde_json::Value) -> Result<Vec<AttachmentFile>, String> {
  let Some(list) = draft.get("attachments") else {
    return Ok(Vec::new());
  };
  let Some(paths) = list.as_array() else {
    return Err("\"attachments\" must be a list of file paths".into());
  };
  let mut out = Vec::new();
  for item in paths {
    let Some(raw) = item.as_str() else {
      return Err("\"attachments\" must be a list of file paths".into());
    };
    let path = Path::new(raw);
    if !path.is_absolute() {
      return Err(format!("attachment {raw} is not an absolute path"));
    }
    let meta = fs::metadata(path).map_err(|e| format!("attachment {raw}: {e}"))?;
    if !meta.is_file() {
      return Err(format!("attachment {raw} is not a file"));
    }
    if meta.len() > MAX_ATTACHMENT_BYTES {
      return Err(format!("attachment {raw} is larger than 25 MB"));
    }
    let bytes = fs::read(path).map_err(|e| format!("attachment {raw}: {e}"))?;
    out.push(AttachmentFile {
      filename: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "attachment".into()),
      mime_type: mime_for(path).into(),
      content_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    });
  }
  Ok(out)
}

/// Every draft waiting, oldest name first, taken out of the folder. A file
/// that is not JSON, or too big, goes to `not-made` with the reason.
pub fn take_waiting(app_data: &Path) -> Vec<Waiting> {
  let dir = folder_in(app_data);
  let _ = fs::create_dir_all(&dir);
  let Ok(entries) = fs::read_dir(&dir) else {
    return Vec::new();
  };
  let mut paths: Vec<PathBuf> = entries
    .filter_map(|e| e.ok().map(|e| e.path()))
    .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "json"))
    .collect();
  paths.sort();
  let mut out = Vec::new();
  for path in paths {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // Taken by renaming it first: a program that takes its file back does
    // so by renaming too, so the file is the program's or Mail's, never
    // both. A request to send must not run after the program said it did not.
    let path = {
      let taking = dir.join(format!("{name}.taking"));
      if fs::rename(&path, &taking).is_err() {
        continue;
      }
      taking
    };
    let too_big = fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    let read = if too_big { Err("the file is larger than 2 MB".to_string()) } else {
      fs::read(&path)
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| format!("not JSON: {e}")))
    };
    let read = read.and_then(|draft| read_attachments(&draft).map(|files| (draft, files)));
    match read {
      Ok((draft, attachment_files)) => {
        let _ = fs::remove_file(&path);
        out.push(Waiting { name, draft, attachment_files });
      }
      Err(reason) => {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let _ = write_not_made(app_data, &name, &serde_json::Value::String(raw), &reason);
        let _ = fs::remove_file(&path);
      }
    }
  }
  out
}

/// The name as written, made safe: nothing that leaves its folder.
fn safe_name(name: &str) -> String {
  let safe: String = name
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
    .collect();
  let safe = safe.trim_start_matches('.');
  if safe.is_empty() { "draft.json".to_string() } else { safe.to_string() }
}

/// Keep a draft that could not be made, with the reason, for whoever wrote it.
pub fn write_not_made(app_data: &Path, name: &str, draft: &serde_json::Value, reason: &str) -> std::io::Result<PathBuf> {
  let dir = folder_in(app_data).join(NOT_MADE);
  fs::create_dir_all(&dir)?;
  let path = dir.join(safe_name(name));
  let body = serde_json::json!({ "reason": reason, "draft": draft });
  fs::write(&path, serde_json::to_vec_pretty(&body).map_err(std::io::Error::other)?)?;
  Ok(path)
}

/// A receipt (`made`) or an answer (`answers`), under the name of the file
/// it answers. Written under another name and renamed, so a reader never
/// sees half of it.
pub fn write_note(app_data: &Path, kind: &str, name: &str, body: &serde_json::Value) -> Result<PathBuf, String> {
  let sub = match kind {
    "made" => MADE,
    "answers" => ANSWERS,
    _ => return Err(format!("no such note: {kind}")),
  };
  let dir = folder_in(app_data).join(sub);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join(safe_name(name));
  let part = dir.join(format!("{}.part", safe_name(name)));
  let bytes = serde_json::to_vec_pretty(body).map_err(|e| e.to_string())?;
  fs::write(&part, bytes).map_err(|e| e.to_string())?;
  fs::rename(&part, &path).map_err(|e| e.to_string())?;
  Ok(path)
}

/// Whether a draft or a request waits in the folder.
pub fn has_waiting(app_data: &Path) -> bool {
  fs::read_dir(folder_in(app_data))
    .map(|entries| {
      entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .any(|p| p.is_file() && p.extension().is_some_and(|e| e == "json"))
    })
    .unwrap_or(false)
}

/// Look at the folder from here, not only from the page, and wake the page
/// when something waits (see the note at the top).
pub fn start_watch(app: tauri::AppHandle) {
  use tauri::Emitter;
  let Ok(data) = app.path().app_data_dir() else { return };
  std::thread::spawn(move || loop {
    std::thread::sleep(WATCH_EVERY);
    if has_waiting(&data) {
      let _ = app.emit(WAITING_EVENT, ());
    }
  });
}

/// Drafts waiting in the folder, for the page to make. Empty when none.
#[tauri::command]
pub fn take_drafts_inbox(app: tauri::AppHandle) -> Vec<Waiting> {
  match app.path().app_data_dir() {
    Ok(data) => take_waiting(&data),
    Err(_) => Vec::new(),
  }
}

/// A draft the page could not make, kept in `not-made` with the reason.
#[tauri::command]
pub fn reject_drafts_inbox(app: tauri::AppHandle, name: String, draft: serde_json::Value, reason: String) -> Result<(), String> {
  let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
  write_not_made(&data, &name, &draft, &reason).map(|_| ()).map_err(|e| e.to_string())
}

/// A receipt or an answer for whoever wrote a file (see `write_note`). An
/// answer that says a message was sent is logged with who sent it and the
/// outbox id, and nothing more: never a subject or an address.
#[tauri::command]
pub fn note_drafts_inbox(app: tauri::AppHandle, kind: String, name: String, body: serde_json::Value) -> Result<(), String> {
  let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
  if let Some(sent) = body.get("sent") {
    log::info!(
      "drafts-inbox: sent by {} (outbox {})",
      sent.get("actor").and_then(|v| v.as_str()).unwrap_or("an agent"),
      sent.get("outboxId").and_then(|v| v.as_str()).unwrap_or("-")
    );
  }
  write_note(&data, &kind, &name, &body).map(|_| ())
}

/// Where the folder is, for Settings to show and copy.
#[tauri::command]
pub fn drafts_inbox_path(app: tauri::AppHandle) -> Result<String, String> {
  let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let dir = folder_in(&data);
  let _ = fs::create_dir_all(&dir);
  Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// One folder per test: the tests run at once, and the clock alone can
  /// give two of them the same name.
  fn temp() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
      "mail-drafts-inbox-{}-{}-{n}",
      std::process::id(),
      std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn takes_each_draft_once_oldest_name_first() {
    let data = temp();
    let dir = folder_in(&data);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("2-second.json"), br#"{"subject":"Two"}"#).unwrap();
    fs::write(dir.join("1-first.json"), br#"{"subject":"One"}"#).unwrap();
    fs::write(dir.join("3-writing.json.part"), b"{").unwrap();
    let got = take_waiting(&data);
    assert_eq!(got.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), ["1-first.json", "2-second.json"]);
    assert_eq!(got[0].draft["subject"], "One");
    assert!(take_waiting(&data).is_empty(), "taken once");
    assert!(dir.join("3-writing.json.part").exists(), "a file still being written is left alone");
  }

  #[test]
  fn notes_are_written_whole_under_a_safe_name() {
    let data = temp();
    let path = write_note(&data, "made", "../a draft.json", &serde_json::json!({ "key": "compose:1" })).unwrap();
    assert_eq!(path, folder_in(&data).join(MADE).join("_a_draft.json"));
    assert!(fs::read_to_string(&path).unwrap().contains("compose:1"));
    assert!(!folder_in(&data).join(MADE).join("_a_draft.json.part").exists());
    assert!(write_note(&data, "elsewhere", "x.json", &serde_json::json!({})).is_err());
  }

  #[test]
  fn sees_a_waiting_file_and_not_a_half_written_one() {
    let data = temp();
    let dir = folder_in(&data);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("writing.json.part"), b"{").unwrap();
    assert!(!has_waiting(&data));
    fs::write(dir.join("ready.json"), b"{}").unwrap();
    assert!(has_waiting(&data));
  }

  #[test]
  fn a_file_that_is_not_json_goes_to_not_made_with_the_reason() {
    let data = temp();
    let dir = folder_in(&data);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("broken.json"), b"{ not json").unwrap();
    assert!(take_waiting(&data).is_empty());
    let kept = fs::read_to_string(dir.join(NOT_MADE).join("broken.json")).unwrap();
    assert!(kept.contains("not JSON"), "{kept}");
    assert!(!dir.join("broken.json").exists());
  }

  #[test]
  fn the_files_a_draft_names_come_with_it() {
    let data = temp();
    let dir = folder_in(&data);
    fs::create_dir_all(&dir).unwrap();
    let pdf = data.join("Allotment plan.pdf");
    fs::write(&pdf, b"%PDF-1.4 beans").unwrap();
    let draft = serde_json::json!({ "subject": "Plan", "attachments": [pdf.to_string_lossy()] });
    fs::write(dir.join("with-file.json"), serde_json::to_vec(&draft).unwrap()).unwrap();
    let got = take_waiting(&data);
    assert_eq!(got.len(), 1);
    let file = &got[0].attachment_files[0];
    assert_eq!(file.filename, "Allotment plan.pdf");
    assert_eq!(file.mime_type, "application/pdf");
    assert_eq!(file.content_base64, base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 beans"));
  }

  #[test]
  fn a_missing_attachment_keeps_the_draft_back_with_the_reason() {
    let data = temp();
    let dir = folder_in(&data);
    fs::create_dir_all(&dir).unwrap();
    let draft = serde_json::json!({ "subject": "Plan", "attachments": ["/no/such/file.pdf"] });
    fs::write(dir.join("missing.json"), serde_json::to_vec(&draft).unwrap()).unwrap();
    assert!(take_waiting(&data).is_empty());
    let kept = fs::read_to_string(dir.join(NOT_MADE).join("missing.json")).unwrap();
    assert!(kept.contains("/no/such/file.pdf"), "{kept}");
    let relative = serde_json::json!({ "attachments": ["plan.pdf"] });
    assert!(read_attachments(&relative).unwrap_err().contains("absolute"));
  }

  #[test]
  fn a_rejected_name_cannot_leave_the_folder() {
    let data = temp();
    let path = write_not_made(&data, "../../evil.json", &serde_json::json!({}), "no").unwrap();
    assert!(path.starts_with(folder_in(&data).join(NOT_MADE)), "{path:?}");
  }
}
