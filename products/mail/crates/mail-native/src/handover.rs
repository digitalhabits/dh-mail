//! Handing a draft to Outlook.
//!
//! In a mailbox this app holds, the draft is made over the provider's own
//! API, and this file only brings Outlook to the front. In a mailbox only
//! Outlook holds, Outlook is asked to make the draft itself, by AppleScript
//! (`outlook_draft`). Not by a message file: Outlook for Mac previews such a
//! file read-only, whatever the `X-Unsent` header asks for.

/// Open a new Outlook message on this mailto: URL.
///
/// For the mailbox this app cannot reach. A university that will not let a
/// third-party client sign in also cannot be given a draft over Graph —
/// there is no token and there will not be one — so the message goes to
/// Outlook the way any program hands mail to any mail client, and the body
/// travels on the pasteboard because a mailto: URL carries only plain text.
///
/// Named to Outlook rather than left to the default client: `open -a` picks
/// the program, so this works on a Mac where the default is Apple Mail, and
/// cannot open the wrong one on a Mac where it is not.
#[tauri::command]
pub fn open_outlook_compose(mailto: String) -> Result<(), String> {
  if !mailto.starts_with("mailto:") {
    return Err("That is not a mailto: address.".to_string());
  }

  #[cfg(target_os = "macos")]
  {
    let was_running = outlook_is_running();
    let out = std::process::Command::new("/usr/bin/open")
      .arg("-a")
      .arg("Microsoft Outlook")
      .arg(&mailto)
      .output()
      .map_err(|e| format!("Couldn't ask macOS to open Outlook: {e}"))?;
    if !out.status.success() {
      let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
      return Err(if said.is_empty() {
        "Outlook doesn't seem to be installed on this Mac.".to_string()
      } else {
        said
      });
    }
    if let Some(subject) = mailto_subject(&mailto) {
      std::thread::spawn(move || keep_message_in_front(&subject, !was_running));
    }
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = mailto;
    Err("Opening Outlook is only wired up on macOS.".to_string())
  }
}

/// The subject a mailto: URL carries, decoded. None when it has none.
fn mailto_subject(mailto: &str) -> Option<String> {
  let (_, query) = mailto.split_once('?')?;
  query
    .split('&')
    .find_map(|field| field.strip_prefix("subject="))
    .and_then(|raw| urlencoding::decode(raw).ok())
    .map(|subject| subject.trim().to_string())
    .filter(|subject| !subject.is_empty())
}

#[cfg(target_os = "macos")]
fn outlook_is_running() -> bool {
  std::process::Command::new("/usr/bin/pgrep")
    .arg("-x")
    .arg("Microsoft Outlook")
    .output()
    .map(|out| out.status.success())
    .unwrap_or(false)
}

/// Put the new message in front of Outlook's main window.
///
/// Outlook opens the message first and its main window after, and the main
/// window lands on top. The reader then has to find the message behind it.
/// So: wait for the message window, by its title, which Outlook sets to the
/// subject, and raise it. When Outlook was not running, the main window
/// can come some seconds later, so keep watching until it is there, then
/// raise the message once more and stop.
///
/// Outlook's own scripting, as in arrange_outlook_handover: no
/// accessibility grant. Best effort: the message is open either way.
#[cfg(target_os = "macos")]
fn keep_message_in_front(subject: &str, cold_start: bool) {
  const SCRIPT: &str = r#"
on messageWindow(theSubject)
  tell application "Microsoft Outlook"
    repeat with win in windows
      if name of win starts with theSubject then return contents of win
    end repeat
  end tell
  return missing value
end messageWindow

on mainWindowIsThere(theSubject)
  tell application "Microsoft Outlook"
    repeat with win in windows
      set n to name of win
      if n is not "" and n does not start with theSubject then return true
    end repeat
  end tell
  return false
end mainWindowIsThere

on raiseMessage(theSubject)
  set w to my messageWindow(theSubject)
  if w is missing value then return false
  tell application "Microsoft Outlook"
    set index of w to 1
    activate
  end tell
  return true
end raiseMessage

on run argv
  set theSubject to item 1 of argv
  set coldStart to (item 2 of argv) is "1"
  set found to false
  repeat 50 times
    if my messageWindow(theSubject) is not missing value then
      set found to true
      exit repeat
    end if
    delay 0.2
  end repeat
  if not found then return
  if coldStart then
    repeat 75 times
      if my mainWindowIsThere(theSubject) then exit repeat
      delay 0.2
    end repeat
    -- The main window draws itself a moment after it exists.
    delay 0.5
  end if
  my raiseMessage(theSubject)
end run
"#;
  let out = std::process::Command::new("/usr/bin/osascript")
    .arg("-e")
    .arg(SCRIPT)
    .arg(subject)
    .arg(if cold_start { "1" } else { "0" })
    .output();
  match out {
    // The status only. AppleScript quotes the value it choked on, and that
    // value is the subject.
    Ok(out) if !out.status.success() => log::warn!(
      "[mail] couldn't bring the Outlook message forward: osascript {}",
      out.status
    ),
    Err(e) => log::warn!("[mail] couldn't bring the Outlook message forward: {e}"),
    _ => {}
  }
}

/// Bring Outlook forward, and say whether it was there to bring.
///
/// macOS only. `open -a` launches it if it is not running, which is the
/// right answer either way: the draft is waiting in the mailbox, and the
/// program that shows it should be the one in front.
#[tauri::command]
pub fn activate_outlook() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    // The full path, not the name: a bundled app inherits whatever PATH
    // launchd hands it, which is not the shell's.
    //
    // And the output rather than the status alone, because "it would not
    // come forward" is not something a reader can act on. `open` says what
    // was wrong with the ask — no such application, most often — and that
    // sentence is worth carrying all the way to the screen.
    let out = std::process::Command::new("/usr/bin/open")
      .arg("-a")
      .arg("Microsoft Outlook")
      .output()
      .map_err(|e| format!("Couldn't ask macOS to open Outlook: {e}"))?;
    if !out.status.success() {
      let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
      return Err(if said.is_empty() {
        "Outlook doesn't seem to be installed on this Mac.".to_string()
      } else {
        said
      });
    }
    Ok(())
  }

  // Nowhere else yet. The draft is in the mailbox either way, so a caller
  // that cannot raise the window still has somewhere to send the reader.
  #[cfg(not(target_os = "macos"))]
  {
    Err("Opening Outlook is only wired up on macOS.".to_string())
  }
}

/// Put the Outlook message and the file it needs side by side.
///
/// A message handed to Outlook with a file to attach leaves the reader
/// with two windows and one drag to make: the file into the message. Left
/// alone, macOS puts them wherever it likes — the message behind Outlook's
/// inbox, the Finder window on top of both — and the reader spends the
/// first seconds finding them. So: the message on the left half of the
/// screen and in front, the Finder window with the file on the right.
///
/// Outlook's own scripting, not System Events, so no accessibility grant
/// is asked for. The message window is found by its title, which Outlook
/// sets to the subject; it can take a moment to appear after the mailto:
/// is opened, so this waits for it, briefly. Best effort throughout: a
/// window that will not move is no reason to fail the hand-over, and
/// nothing here touches the message or the file.
#[tauri::command]
pub async fn arrange_outlook_handover(subject: String, path: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    const SCRIPT: &str = r#"
on run argv
  set theSubject to item 1 of argv
  set theFile to POSIX file (item 2 of argv) as alias
  tell application "Finder"
    set {sx, sy, sw, sh} to bounds of window of desktop
  end tell
  set halfX to sw div 2
  tell application "Finder"
    reveal theFile
    set bounds of front Finder window to {halfX, 0, sw, sh}
  end tell
  set w to missing value
  repeat 30 times
    if theSubject is not "" then
      tell application "Microsoft Outlook"
        repeat with win in windows
          if name of win starts with theSubject then
            set w to win
            exit repeat
          end if
        end repeat
      end tell
    end if
    if w is not missing value then exit repeat
    delay 0.2
  end repeat
  tell application "Microsoft Outlook"
    if w is missing value then set w to window 1
    set bounds of w to {0, 0, halfX, sh}
    set index of w to 1
    activate
  end tell
end run
"#;
    let out = tauri::async_runtime::spawn_blocking(move || {
      std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(SCRIPT)
        .arg(&subject)
        .arg(&path)
        .output()
    })
    .await
    .map_err(|e| format!("Couldn't run the window arrangement: {e}"))?
    .map_err(|e| format!("Couldn't ask macOS to arrange the windows: {e}"))?;
    if !out.status.success() {
      let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
      return Err(if said.is_empty() {
        "The windows could not be arranged.".to_string()
      } else {
        said
      });
    }
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (subject, path);
    Err("Arranging Outlook's windows is only wired up on macOS.".to_string())
  }
}

/// The message a reply answers, so Outlook can find its own copy of it.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookReplyTo {
  /// The Message-ID, angle brackets included. Empty when it has none.
  pub message_id: String,
  /// Its subject, as it came.
  pub subject: String,
  /// Its sender's address.
  pub from: String,
  /// When it was sent, in epoch milliseconds.
  pub sent_at_ms: i64,
}

/// A file to attach to the draft.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookFile {
  pub filename: String,
  pub content_base64: String,
}

/// A message to put in Outlook's Drafts: see `outlook_draft`.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookDraft {
  /// The message it answers. None for a new message or a forward.
  pub reply: Option<OutlookReplyTo>,
  pub subject: String,
  /// What the reader wrote, as HTML, without our signature: Outlook adds
  /// the signature of the mailbox the draft is in.
  pub html: String,
  /// The history under the words, as HTML. Only used when the draft is a
  /// new message: a reply gets Outlook's own quote.
  pub history_html: String,
  /// The address it is written from. A new message is made in the Outlook
  /// account with this address, if Outlook has one; else in its default.
  pub from: String,
  pub to: Vec<String>,
  pub cc: Vec<String>,
  pub bcc: Vec<String>,
  pub files: Vec<OutlookFile>,
}

/// Make the message as a draft in Outlook, and do not open it.
///
/// A reply is made with Outlook's own Reply on its copy of the message, so
/// it has Outlook's quote and sits in the conversation, in the mailbox
/// that holds the conversation. Outlook keeps a reply it did not open in a
/// hidden Temporary Items folder, so it is moved to that account's Drafts.
/// A new message is made in Drafts already. Outlook's copy is found by its Message-ID,
/// or else by the same sender and subject, sent within two minutes. The
/// second is needed for mail that reaches this app through a forwarding
/// rule: the rule sends a new message, with a new Message-ID.
///
/// When there is nothing to reply to, or Outlook does not have the message,
/// it is a new message with the history under the words.
///
/// The files are written to a folder of their own in the temporary folder
/// and attached from there. Not to Downloads: saving there shows each file
/// in Finder, and here nobody needs to find them.
///
/// `Ok(Some("reply"))` or `Ok(Some("new"))`: what was made. `Ok(None)` when
/// Outlook cannot be scripted this way (the new Outlook, or not a Mac): the
/// caller then opens a new message, as before.
#[tauri::command]
pub async fn outlook_draft(draft: OutlookDraft) -> Result<Option<String>, String> {
  #[cfg(target_os = "macos")]
  {
    const SCRIPT: &str = r#"
on findIn(h, n)
  return offset of n in h
end findIn

on bodyStart(c)
  set i to offset of "<body" in c
  if i is 0 then return 1
  set tail to text i thru -1 of c
  set j to offset of ">" in tail
  return i + j
end bodyStart

on addPeople(r, toList, ccList, bccList)
  tell application "Microsoft Outlook"
    repeat with x in toList
      if (contents of x) is not "" then make new to recipient at r with properties {email address:{address:(contents of x)}}
    end repeat
    repeat with x in ccList
      if (contents of x) is not "" then make new cc recipient at r with properties {email address:{address:(contents of x)}}
    end repeat
    repeat with x in bccList
      if (contents of x) is not "" then make new bcc recipient at r with properties {email address:{address:(contents of x)}}
    end repeat
  end tell
end addPeople

on addFiles(r, fileList)
  repeat with p in fileList
    if (contents of p) is not "" then
      set f to POSIX file (contents of p)
      tell application "Microsoft Outlook" to make new attachment at r with properties {file:f}
    end if
  end repeat
end addFiles

on run argv
  set theId to item 1 of argv
  set theSubject to item 2 of argv
  set theSender to item 3 of argv
  set secondsAgo to item 4 of argv
  set theHtml to item 5 of argv
  set historyHtml to item 6 of argv
  set newSubject to item 7 of argv
  set fromAddress to item 8 of argv
  set toList to paragraphs of (item 9 of argv)
  set ccList to paragraphs of (item 10 of argv)
  set bccList to paragraphs of (item 11 of argv)
  set fileList to paragraphs of (item 12 of argv)

  set target to missing value
  if secondsAgo is not "" then
    set sentAt to (current date) - (secondsAgo as integer)
    tell application "Microsoft Outlook"
      set found to (every message whose subject is theSubject and time sent > (sentAt - 2 * days))
    end tell
    set byLook to missing value
    repeat with m in found
      set m to contents of m
      tell application "Microsoft Outlook"
        set h to (headers of m) as string
        set ts to time sent of m
        set a to ""
        try
          set s to sender of m
          set a to address of s
        end try
      end tell
      if theId is not "" and my findIn(h, theId) > 0 then
        set target to m
        exit repeat
      end if
      set gap to ts - sentAt
      if gap < 0 then set gap to -gap
      if byLook is missing value and gap ≤ 120 and a is theSender then set byLook to m
    end repeat
    if target is missing value then set target to byLook
  end if

  if target is not missing value then
    tell application "Microsoft Outlook"
      set r to reply to target without opening window
      delete every recipient of r
    end tell
    my addPeople(r, toList, ccList, bccList)
    tell application "Microsoft Outlook" to set c to content of r
    set k to my bodyStart(c)
    if k > 1 then
      set newContent to (text 1 thru (k - 1) of c) & theHtml & (text k thru -1 of c)
    else
      set newContent to theHtml & c
    end if
    tell application "Microsoft Outlook" to set content of r to newContent
    my addFiles(r, fileList)
    -- A reply that is never opened stays in a hidden Temporary Items
    -- folder. It goes to the Drafts of the account that holds the message.
    tell application "Microsoft Outlook"
      try
        set d to drafts of (account of target)
      on error
        set d to drafts
      end try
      move r to d
    end tell
    return "reply"
  end if

  tell application "Microsoft Outlook"
    set acc to missing value
    if fromAddress is not "" then
      try
        set acc to first exchange account whose email address is fromAddress
      end try
      if acc is missing value then
        try
          set acc to first imap account whose email address is fromAddress
        end try
      end if
    end if
    if acc is missing value then
      set r to make new outgoing message with properties {subject:newSubject, content:(theHtml & historyHtml)}
    else
      set r to make new outgoing message with properties {subject:newSubject, content:(theHtml & historyHtml), account:acc}
    end if
  end tell
  my addPeople(r, toList, ccList, bccList)
  my addFiles(r, fileList)
  return "new"
end run
"#;
    let paths = write_draft_files(&draft.files)?;
    let args = outlook_draft_args(&draft, &paths, now_ms());
    let out = tauri::async_runtime::spawn_blocking(move || {
      std::process::Command::new("/usr/bin/osascript").arg("-e").arg(SCRIPT).args(&args).output()
    })
    .await
    .map_err(|e| format!("Couldn't run the Outlook draft: {e}"))?
    .map_err(|e| format!("Couldn't ask Outlook for the draft: {e}"))?;
    if !out.status.success() {
      // The new Outlook, or a message it would not make: the caller opens
      // a new message instead.
      // The status only: the script carries the subject and the body, and
      // AppleScript puts what it refused into its error.
      log::warn!("[mail] Outlook could not make the draft: osascript {}", out.status);
      return Ok(None);
    }
    let made = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(matches!(made.as_str(), "reply" | "new").then_some(made))
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = draft;
    Ok(None)
  }
}

/// Write the files to a new folder in the temporary folder, and answer
/// their paths. A name keeps only its last part, so it cannot point
/// outside the folder.
#[cfg(target_os = "macos")]
fn write_draft_files(files: &[OutlookFile]) -> Result<Vec<String>, String> {
  use base64::Engine as _;
  if files.is_empty() {
    return Ok(Vec::new());
  }
  let dir = std::env::temp_dir().join(format!("dh-mail-outlook-{}", now_ms()));
  std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a folder for the files: {e}"))?;
  let mut paths = Vec::new();
  for (i, file) in files.iter().enumerate() {
    let name = draft_file_name(&file.filename, i);
    let bytes = base64::engine::general_purpose::STANDARD
      .decode(file.content_base64.trim())
      .map_err(|e| format!("A file to attach could not be read: {e}"))?;
    // A folder of its own per file, so two files of one name both go.
    let sub = dir.join(i.to_string());
    std::fs::create_dir_all(&sub).map_err(|e| format!("Couldn't make a folder for the files: {e}"))?;
    let path = sub.join(name);
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't write a file to attach: {e}"))?;
    paths.push(path.to_string_lossy().to_string());
  }
  Ok(paths)
}

/// The last part of a name, with no line breaks (the script reads one path
/// per line); "attachment-<n>" when nothing is left.
fn draft_file_name(name: &str, index: usize) -> String {
  let last = name.rsplit(['/', '\\']).next().unwrap_or("");
  let clean: String = last.chars().filter(|c| !c.is_control()).collect();
  let clean = clean.trim();
  if clean.is_empty() || clean == "." || clean == ".." {
    format!("attachment-{}", index + 1)
  } else {
    clean.to_string()
  }
}

/// The script's arguments: the reply's id, subject, sender and seconds
/// since it was sent ("" for each with no reply), the words, the history,
/// the subject, the From address, then To, Cc, Bcc and the files one per
/// line.
fn outlook_draft_args(draft: &OutlookDraft, paths: &[String], now_ms: i64) -> Vec<String> {
  let lines = |list: &[String]| {
    list.iter().map(|a| a.trim()).filter(|a| !a.is_empty() && !a.contains(['\n', '\r'])).collect::<Vec<_>>().join("\n")
  };
  let (id, subject, from, seconds_ago) = match &draft.reply {
    Some(reply) => (
      reply.message_id.trim().to_string(),
      reply.subject.clone(),
      reply.from.trim().to_string(),
      ((now_ms - reply.sent_at_ms) / 1000).max(0).to_string(),
    ),
    None => (String::new(), String::new(), String::new(), String::new()),
  };
  vec![
    id,
    subject,
    from,
    seconds_ago,
    draft.html.clone(),
    draft.history_html.clone(),
    draft.subject.clone(),
    draft.from.trim().to_string(),
    lines(&draft.to),
    lines(&draft.cc),
    lines(&draft.bcc),
    lines(paths),
  ]
}

#[cfg(target_os = "macos")]
fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
  use super::mailto_subject;

  #[test]
  fn reads_the_subject_from_a_mailto() {
    assert_eq!(
      mailto_subject("mailto:a%40b.org?cc=c%40d.org&subject=RE%3A%20Deep%20Work&body=hi").as_deref(),
      Some("RE: Deep Work")
    );
    assert_eq!(mailto_subject("mailto:a%40b.org?body=hi"), None);
    assert_eq!(mailto_subject("mailto:a%40b.org"), None);
    assert_eq!(mailto_subject("mailto:a%40b.org?subject=%20"), None);
  }

  fn draft(reply: Option<super::OutlookReplyTo>) -> super::OutlookDraft {
    super::OutlookDraft {
      reply,
      subject: "Re: Plans".into(),
      html: "<p>Hi</p>".into(),
      history_html: "<blockquote>Old</blockquote>".into(),
      from: " me@c.test ".into(),
      to: vec!["ann@b.test".into(), " ".into()],
      cc: vec!["me@c.test".into(), "bo@d.test".into()],
      bcc: vec!["x@y.test\nz@w.test".into(), "cy@d.test".into()],
      files: vec![],
    }
  }

  #[test]
  fn a_reply_draft_gets_its_arguments_in_order() {
    let reply = super::OutlookReplyTo {
      message_id: " <a@b.test> ".into(),
      subject: "FW: Plans".into(),
      from: "ann@b.test".into(),
      sent_at_ms: 1_000_000,
    };
    let args = super::outlook_draft_args(&draft(Some(reply)), &["/tmp/a/0/f.pdf".into()], 1_090_500);
    assert_eq!(
      args,
      vec![
        "<a@b.test>",
        "FW: Plans",
        "ann@b.test",
        "90",
        "<p>Hi</p>",
        "<blockquote>Old</blockquote>",
        "Re: Plans",
        "me@c.test",
        "ann@b.test",
        "me@c.test\nbo@d.test",
        // An address with a line break in it would be two lines to the script.
        "cy@d.test",
        "/tmp/a/0/f.pdf",
      ]
    );
  }

  #[test]
  fn a_new_draft_has_no_reply_to_look_for() {
    let args = super::outlook_draft_args(&draft(None), &[], 1_090_500);
    assert_eq!(&args[..4], &["", "", "", ""]);
    assert_eq!(args[11], "");
  }

  #[test]
  fn a_file_name_cannot_leave_its_folder() {
    assert_eq!(super::draft_file_name("../../etc/passwd", 0), "passwd");
    assert_eq!(super::draft_file_name("a\\b\\report.pdf", 0), "report.pdf");
    assert_eq!(super::draft_file_name("bad\nname.txt", 0), "badname.txt");
    assert_eq!(super::draft_file_name("..", 2), "attachment-3");
    assert_eq!(super::draft_file_name("", 0), "attachment-1");
  }
}
