//! Safety steps for an attachment that is written to disk.
//!
//! An attachment comes from the sender. The operating system has its own
//! check for a file from the internet: Gatekeeper on macOS and SmartScreen
//! on Windows. That check runs only when the file carries a mark that says
//! where it came from. This module writes that mark.
//!
//! This module also keeps the one list of file types that the app does not
//! open for the reader. The app still saves such a file, but it only shows
//! the file in Finder or Explorer. The reader then decides.

use std::path::Path;

/// The name that the macOS quarantine mark gives as the source of the file.
pub const AGENT_NAME: &str = "Digital Habits Mail";

/// File types that can run code when the system opens them.
///
/// Lowercase, with no dot. Keep this the only list. The test below checks
/// some names against it.
pub const RISKY_EXTENSIONS: &[&str] = &[
  // macOS: apps, installers, scripts and Terminal files.
  "app", "command", "terminal", "tool", "pkg", "mpkg", "dmg", "action", "workflow",
  "scpt", "scptd", "applescript", "osax", "prefpane", "kext", "dylib", "bundle",
  "plugin", "fileloc", "inetloc", "webloc", "xip",
  // Shell and other script languages.
  "sh", "bash", "zsh", "csh", "ksh", "fish", "py", "pyw", "pl", "rb", "php", "lua",
  "jar", "class",
  // Windows: programs, installers, scripts and shortcuts.
  "exe", "com", "bat", "cmd", "scr", "pif", "msi", "msp", "mst", "msc", "msix",
  "msixbundle", "appx", "appxbundle", "appref-ms", "application", "gadget", "cpl",
  "dll", "sys", "drv", "ocx", "vb", "vbs", "vbe", "js", "jse", "mjs", "wsf", "wsh",
  "ws", "wsc", "ps1", "psm1", "psd1", "ps1xml", "psc1", "hta", "lnk", "url", "scf",
  "reg", "inf", "chm", "settingcontent-ms", "library-ms", "search-ms", "iso", "img",
  "vhd", "vhdx", "diagcab",
  // Linux: launchers and packages.
  "desktop", "appimage", "run", "deb", "rpm", "elf", "bin",
];

/// Archive types. An archive can hold an app ("Report.app.zip"), so the
/// type before the archive type is checked too.
const ARCHIVE_EXTENSIONS: &[&str] = &["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "cpio"];

/// True if the system can run code when it opens a file with this name.
///
/// Windows ignores dots and spaces at the end of a name, so "a.exe. " is
/// an executable there. These characters are removed before the check.
pub fn is_risky_to_open(file_name: &str) -> bool {
  let name = file_name.trim_end_matches(['.', ' ']).to_lowercase();
  let mut parts = name.rsplit('.');
  let last = parts.next().unwrap_or("");
  // A name with no dot has no extension.
  if !name.contains('.') {
    return false;
  }
  if RISKY_EXTENSIONS.contains(&last) {
    return true;
  }
  if ARCHIVE_EXTENSIONS.contains(&last) {
    if let Some(inner) = parts.next() {
      // Only when the archive name has a third part, as in "x.app.zip".
      if name.matches('.').count() >= 2 && RISKY_EXTENSIONS.contains(&inner) {
        return true;
      }
    }
  }
  false
}

/// The value of the macOS `com.apple.quarantine` attribute.
///
/// The format is "flags;time in hex;agent;event id". The flag 0081 is the
/// value that browsers write for a download. The event id stays empty,
/// because there is no entry in the system quarantine database for it.
pub fn quarantine_value(unix_seconds: u64) -> String {
  format!("0081;{unix_seconds:08x};{AGENT_NAME};")
}

/// The text of the Windows `Zone.Identifier` stream. Zone 3 is the internet.
pub const ZONE_IDENTIFIER: &str = "[ZoneTransfer]\r\nZoneId=3\r\n";

/// Mark a written file as a download from the internet.
///
/// On macOS this sets `com.apple.quarantine`. On Windows this writes the
/// `Zone.Identifier` stream. Other systems have no such mark, so this does
/// nothing there.
pub fn mark_as_downloaded(path: &Path) -> std::io::Result<()> {
  mark_platform(path)
}

#[cfg(target_os = "macos")]
fn mark_platform(path: &Path) -> std::io::Result<()> {
  use std::ffi::CString;
  use std::os::raw::{c_char, c_int, c_void};
  use std::os::unix::ffi::OsStrExt;

  extern "C" {
    // From <sys/xattr.h> in the macOS C library.
    fn setxattr(
      path: *const c_char,
      name: *const c_char,
      value: *const c_void,
      size: usize,
      position: u32,
      options: c_int,
    ) -> c_int;
  }

  let c_path = CString::new(path.as_os_str().as_bytes())
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has a NUL byte"))?;
  let name = CString::new("com.apple.quarantine").expect("no NUL in a constant");
  let seconds = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  let value = quarantine_value(seconds);
  // SAFETY: Each pointer comes from a live CString or String for the whole call.
  let result = unsafe {
    setxattr(c_path.as_ptr(), name.as_ptr(), value.as_ptr() as *const c_void, value.len(), 0, 0)
  };
  if result == 0 {
    Ok(())
  } else {
    Err(std::io::Error::last_os_error())
  }
}

#[cfg(target_os = "windows")]
fn mark_platform(path: &Path) -> std::io::Result<()> {
  let mut stream = path.as_os_str().to_owned();
  stream.push(":Zone.Identifier");
  std::fs::write(std::path::PathBuf::from(stream), ZONE_IDENTIFIER)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn mark_platform(_path: &Path) -> std::io::Result<()> {
  Ok(())
}

/// What to do with the file after it is written: open it, or only show it.
///
/// The app opens the file only if the reader asked, the mark is on the
/// file, and the file type cannot run code.
pub fn may_open(asked_to_open: bool, marked: bool, file_name: &str) -> bool {
  asked_to_open && marked && !is_risky_to_open(file_name)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn programs_and_scripts_are_not_opened() {
    for name in [
      "Invoice.command",
      "setup.terminal",
      "Report.app.zip",
      "Report.APP.ZIP",
      "update.exe",
      "run.bat",
      "tool.cmd",
      "script.ps1",
      "note.vbs",
      "page.hta",
      "link.lnk",
      "Installer.pkg",
      "disk.dmg",
      "start.sh",
      "launcher.desktop",
      "photo.jpg.exe",
      // Windows drops the dots and spaces at the end of a name.
      "update.exe.",
      "update.exe . ",
    ] {
      assert!(is_risky_to_open(name), "{name} must not be opened");
    }
  }

  #[test]
  fn documents_and_pictures_are_opened() {
    for name in [
      "Plan.pdf",
      "photo.jpg",
      "notes.txt",
      "Budget.xlsx",
      "slides.pptx",
      "archive.zip",
      "backup.tar.gz",
      "exe",
      "README",
      "zip",
      "app.zip",
    ] {
      assert!(!is_risky_to_open(name), "{name} must open");
    }
  }

  #[test]
  fn the_list_has_only_lowercase_entries_with_no_dot() {
    for ext in RISKY_EXTENSIONS {
      assert_eq!(*ext, ext.to_lowercase(), "{ext}");
      assert!(!ext.starts_with('.'), "{ext}");
      assert!(!ext.is_empty());
    }
  }

  #[test]
  fn the_app_opens_a_file_only_when_every_condition_is_true() {
    assert!(may_open(true, true, "Plan.pdf"));
    assert!(!may_open(false, true, "Plan.pdf"));
    assert!(!may_open(true, false, "Plan.pdf"));
    assert!(!may_open(true, true, "Invoice.command"));
  }

  #[test]
  fn the_quarantine_value_names_the_app() {
    assert_eq!(quarantine_value(0x6500_0000), "0081;65000000;Digital Habits Mail;");
    assert_eq!(quarantine_value(1), "0081;00000001;Digital Habits Mail;");
  }

  #[test]
  fn the_zone_identifier_names_the_internet_zone() {
    assert!(ZONE_IDENTIFIER.starts_with("[ZoneTransfer]\r\n"));
    assert!(ZONE_IDENTIFIER.contains("ZoneId=3"));
  }

  #[test]
  fn marking_a_written_file_works_on_this_system() {
    let dir = std::env::temp_dir().join(format!("dh-mail-mark-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("Plan.pdf");
    std::fs::write(&path, b"%PDF-1.4").unwrap();
    mark_as_downloaded(&path).unwrap();
    // The file itself stays as it was written.
    assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.4");
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
