//! Handing a draft to another mail program.
//!
//! Only bringing it to the front. The draft itself is made in the mailbox,
//! over the provider's own API, because the alternative — writing a message
//! file and opening it — gives Outlook a message to look at rather than one
//! to write. Outlook for Mac previews such a file read-only, whatever the
//! `X-Unsent` header asks for.
//!
//! So the app's part is small: the draft is already in Drafts by the time
//! this runs, and this is the step that puts the reader in front of it.

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
    Ok(out) if !out.status.success() => log::warn!(
      "[mail] couldn't bring the Outlook message forward: {}",
      String::from_utf8_lossy(&out.stderr).trim()
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
}
