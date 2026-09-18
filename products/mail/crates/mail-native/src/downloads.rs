//! Saving an attachment to disk.
//!
//! A webview has no downloads folder. In a browser an `<a download>` is handled
//! by the browser itself, and there is nothing for the app to do; here the page
//! reads the bytes and hands them over, and this writes the file.
//!
//! The name comes from the message, which means it comes from whoever sent it.
//! It is treated as untrusted text: only the last path segment survives, and
//! only characters that cannot walk out of the folder.

use std::path::{Path, PathBuf};

/// A file name that cannot escape the folder it is written to.
///
/// A sender controls this string. `../../.ssh/authorized_keys` must become a
/// plain name, not a path, and an empty result must still be a file.
pub fn safe_file_name(filename: &str) -> String {
  // Both separators: a name made on Windows arrives with backslashes.
  let base = filename
    .rsplit(['/', '\\'])
    .next()
    .unwrap_or("")
    .trim()
    .trim_start_matches('.');

  let cleaned: String = base
    .chars()
    .filter(|c| !c.is_control() && !is_bidi_override(*c))
    .map(|c| if c == ':' { '_' } else { c })
    .collect();

  let cleaned = cleaned.trim().to_string();
  if cleaned.is_empty() {
    return "attachment".to_string();
  }
  // Long names are refused by the file system, and the tail matters least.
  if cleaned.len() > 200 {
    return cleaned.chars().take(200).collect();
  }
  cleaned
}

/// Characters that reorder the text around them.
///
/// "in\u{202e}gnp.exe" reads as "inexe.png" in a file listing while still
/// being an executable. Nothing legitimate needs these in a file name.
fn is_bidi_override(c: char) -> bool {
  matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{200e}' | '\u{200f}')
}

/// A path in `dir` that nothing occupies, by adding " (2)", " (3)", and so on.
///
/// Overwriting a file the user already has is not recoverable, so it is never
/// done. This is what a browser does with a repeated download.
pub fn unique_path(dir: &Path, filename: &str, exists: &dyn Fn(&Path) -> bool) -> PathBuf {
  let first = dir.join(filename);
  if !exists(&first) {
    return first;
  }
  let (stem, extension) = match filename.rfind('.') {
    // A leading dot is the whole name, not an extension.
    Some(dot) if dot > 0 => (&filename[..dot], &filename[dot..]),
    _ => (filename, ""),
  };
  for n in 2..1000 {
    let candidate = dir.join(format!("{stem} ({n}){extension}"));
    if !exists(&candidate) {
      return candidate;
    }
  }
  dir.join(format!("{stem} ({}){extension}", 1000))
}

/// Decode base64, taking either alphabet.
///
/// A lookup table rather than a search: an attachment can be 25 MB, which is
/// 33 MB of base64, and scanning an alphabet per character is far too slow.
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
  let mut table = [255u8; 256];
  let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (index, byte) in alphabet.iter().enumerate() {
    table[*byte as usize] = index as u8;
  }
  // base64url, so the same decoder takes what either encoder wrote.
  table[b'-' as usize] = 62;
  table[b'_' as usize] = 63;

  let mut acc: u32 = 0;
  let mut bits = 0;
  let mut out = Vec::with_capacity(input.len() / 4 * 3);
  for byte in input.bytes() {
    if byte == b'=' {
      break;
    }
    if byte.is_ascii_whitespace() {
      continue;
    }
    let value = table[byte as usize];
    if value == 255 {
      return Err("the attachment data is not base64".to_string());
    }
    acc = (acc << 6) | value as u32;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      out.push((acc >> bits) as u8);
    }
  }
  Ok(out)
}

/// Write the attachment, and answer where it went.
///
/// `open` opens the file with whatever handles it. Otherwise the file manager
/// is pointed at it, which says where it went without launching anything.
///
/// Async, and the work on a blocking thread. A plain command runs on the
/// main thread, which is the thread the windows are drawn on: decoding
/// thirty megabytes of base64 and writing them there stopped the whole app
/// for as long as it took.
#[tauri::command]
pub async fn save_attachment(
  app: tauri::AppHandle,
  filename: String,
  content_base64: String,
  open: bool,
) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || save_attachment_now(&app, &filename, &content_base64, open))
    .await
    .map_err(|e| e.to_string())?
}

fn save_attachment_now(
  app: &tauri::AppHandle,
  filename: &str,
  content_base64: &str,
  open: bool,
) -> Result<String, String> {
  use tauri::Manager;

  let bytes = decode_base64(content_base64)?;
  // A phone has no downloads folder the app may write to as a desktop
  // does — iOS answers with an error, and Android's is not this app's — so
  // the file goes under the app's own data directory there, where the
  // system's file app can still reach it.
  let dir = app
    .path()
    .download_dir()
    .or_else(|_| app.path().app_data_dir().map(|d| d.join("Downloads")))
    .map_err(|e| format!("Couldn't find the downloads folder: {e}"))?;
  std::fs::create_dir_all(&dir)
    .map_err(|e| format!("Couldn't open the downloads folder: {e}"))?;

  let path = unique_path(&dir, &safe_file_name(filename), &|p| p.exists());
  std::fs::write(&path, &bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;

  // The file is written either way. Failing to show it is not a failure to
  // save it, so neither branch below stops the command.
  #[cfg(target_os = "macos")]
  {
    let mut command = std::process::Command::new("open");
    if !open {
      command.arg("-R");
    }
    // Started, not waited for. The file is written by now, and Finder can
    // take a second or more to come forward: the answer used to wait for it,
    // so "Saved" was said that much later than the file was saved.
    // On a thread of its own, which waits so that the child is reaped.
    command.arg(&path);
    std::thread::spawn(move || {
      let _ = command.status();
    });
  }

  // Everywhere else, through the opener plugin rather than a command line of
  // our own. `explorer /select,<path>` is the Windows equivalent of `open -R`,
  // but it wants its path punctuated in a way that does not survive being
  // passed as one argument, and the plugin has already solved that.
  #[cfg(not(target_os = "macos"))]
  {
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    let _ = if open {
      opener.open_path(path.to_string_lossy(), None::<&str>)
    } else {
      opener.reveal_item_in_dir(&path)
    };
  }

  Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashSet;

  #[test]
  fn it_strips_a_path_out_of_a_sender_supplied_name() {
    assert_eq!(safe_file_name("../../.ssh/authorized_keys"), "authorized_keys");
    assert_eq!(safe_file_name("C:\\Windows\\evil.exe"), "evil.exe");
    assert_eq!(safe_file_name("/etc/passwd"), "passwd");
    // A name that is only dots would otherwise reach the parent folder.
    assert_eq!(safe_file_name(".."), "attachment");
    assert_eq!(safe_file_name("."), "attachment");
    assert_eq!(safe_file_name(""), "attachment");
    assert_eq!(safe_file_name("   "), "attachment");
  }

  #[test]
  fn it_keeps_an_ordinary_name_as_it_is() {
    assert_eq!(safe_file_name("apple-icon.png"), "apple-icon.png");
    assert_eq!(safe_file_name("Møde på fredag.pdf"), "Møde på fredag.pdf");
    assert_eq!(safe_file_name("報告書.xlsx"), "報告書.xlsx");
  }

  #[test]
  fn it_removes_characters_that_break_a_path_or_a_file_listing() {
    assert_eq!(safe_file_name("bad\nname.txt"), "badname.txt");
    assert_eq!(safe_file_name("a:b.txt"), "a_b.txt");
    // Written out, this reads as "inexe.png" while still being an executable.
    assert_eq!(safe_file_name("in\u{202e}gnp.exe"), "ingnp.exe");
    assert_eq!(safe_file_name("a\u{200f}b.png"), "ab.png");
  }

  #[test]
  fn it_never_overwrites_a_file_the_user_already_has() {
    let taken: HashSet<PathBuf> = ["/d/a.png", "/d/a (2).png"]
      .iter()
      .map(PathBuf::from)
      .collect();
    let path = unique_path(Path::new("/d"), "a.png", &|p| taken.contains(p));
    assert_eq!(path, PathBuf::from("/d/a (3).png"));
  }

  #[test]
  fn a_free_name_is_used_as_it_is() {
    let path = unique_path(Path::new("/d"), "a.png", &|_| false);
    assert_eq!(path, PathBuf::from("/d/a.png"));
  }

  #[test]
  fn the_counter_goes_before_the_extension() {
    let path = unique_path(Path::new("/d"), "report.tar.gz", &|p| {
      p == Path::new("/d/report.tar.gz")
    });
    assert_eq!(path, PathBuf::from("/d/report.tar (2).gz"));
    // A name with no extension still gets a counter.
    let path = unique_path(Path::new("/d"), "LICENSE", &|p| {
      p == Path::new("/d/LICENSE")
    });
    assert_eq!(path, PathBuf::from("/d/LICENSE (2)"));
  }

  #[test]
  fn it_decodes_what_the_page_encoded() {
    assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
    assert_eq!(decode_base64("YQ==").unwrap(), b"a");
    assert_eq!(decode_base64("YWI=").unwrap(), b"ab");
    assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
    // Unpadded, which is how base64url is written.
    assert_eq!(decode_base64("YWJjZA").unwrap(), b"abcd");
  }

  #[test]
  fn it_takes_either_alphabet_and_ignores_wrapping() {
    // 0xFB 0xFF encodes as "+/8=" in base64 and "-_8" in base64url.
    assert_eq!(decode_base64("+/8=").unwrap(), vec![0xfb, 0xff]);
    assert_eq!(decode_base64("-_8").unwrap(), vec![0xfb, 0xff]);
    assert_eq!(decode_base64("YWJj\n YWJj").unwrap(), b"abcabc");
  }

  #[test]
  fn it_refuses_data_that_is_not_base64() {
    assert!(decode_base64("not base64!").is_err());
  }

  #[test]
  fn every_byte_survives_a_round_trip() {
    // PNG headers and anything else binary must come back exactly.
    let bytes: Vec<u8> = (0..=255u8).collect();
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::new();
    for chunk in bytes.chunks(3) {
      let b = [
        chunk[0],
        *chunk.get(1).unwrap_or(&0),
        *chunk.get(2).unwrap_or(&0),
      ];
      let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
      for i in 0..4 {
        if i <= chunk.len() {
          encoded.push(alphabet[((n >> (18 - i * 6)) & 63) as usize] as char);
        } else {
          encoded.push('=');
        }
      }
    }
    assert_eq!(decode_base64(&encoded).unwrap(), bytes);
  }
}
