//! The text side of the protocol: names, headers, dates, and the snippet.

use super::*;

// ---------------------------------------------------------------------------
// Names, headers, dates: the text side of the protocol
// ---------------------------------------------------------------------------

/// IMAP mailbox names use a UTF-7 of their own: `&` opens a run of base64
/// UTF-16, `-` closes it, `,` stands in for `/`, and `&-` is a plain `&`.
pub fn decode_modified_utf7(raw: &str) -> String {
  let mut out = String::new();
  let mut chars = raw.chars().peekable();
  while let Some(c) = chars.next() {
    if c != '&' {
      out.push(c);
      continue;
    }
    let mut run = String::new();
    let mut closed = false;
    for d in chars.by_ref() {
      if d == '-' {
        closed = true;
        break;
      }
      run.push(d);
    }
    if run.is_empty() {
      out.push('&');
      continue;
    }
    let b64 = run.replace(',', "/");
    let padded = match b64.len() % 4 {
      2 => format!("{b64}=="),
      3 => format!("{b64}="),
      _ => b64,
    };
    match base64::engine::general_purpose::STANDARD.decode(padded) {
      Ok(bytes) => {
        let units: Vec<u16> = bytes.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        out.push_str(&String::from_utf16_lossy(&units));
      }
      Err(_) => {
        out.push('&');
        out.push_str(&run);
        if closed {
          out.push('-');
        }
      }
    }
  }
  out
}

/// The other way: a name as IMAP wants it written.
pub fn encode_modified_utf7(name: &str) -> String {
  let mut out = String::new();
  let mut run: Vec<u16> = Vec::new();
  let flush = |run: &mut Vec<u16>, out: &mut String| {
    if run.is_empty() {
      return;
    }
    let bytes: Vec<u8> = run.iter().flat_map(|u| u.to_be_bytes()).collect();
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(bytes).replace('/', ",");
    out.push('&');
    out.push_str(&b64);
    out.push('-');
    run.clear();
  };
  for c in name.chars() {
    if c == '&' {
      flush(&mut run, &mut out);
      out.push_str("&-");
    } else if (' '..='~').contains(&c) {
      flush(&mut run, &mut out);
      out.push(c);
    } else {
      let mut units = [0u16; 2];
      run.extend_from_slice(c.encode_utf16(&mut units));
    }
  }
  flush(&mut run, &mut out);
  out
}

/// RFC 2047 encoded words in a header, decoded. Whitespace between two
/// encoded words is not part of the text.
pub fn decode_encoded_words(value: &str) -> String {
  let mut out = String::new();
  let mut rest = value;
  let mut last_was_encoded = false;
  while let Some(start) = rest.find("=?") {
    let before = &rest[..start];
    if !(last_was_encoded && before.trim().is_empty()) {
      out.push_str(before);
    }
    let tail = &rest[start + 2..];
    let Some((charset, tail)) = tail.split_once('?') else {
      out.push_str(&rest[start..]);
      return out;
    };
    let Some((encoding, tail)) = tail.split_once('?') else {
      out.push_str(&rest[start..]);
      return out;
    };
    let Some((text, tail)) = tail.split_once("?=") else {
      out.push_str(&rest[start..]);
      return out;
    };
    let bytes = match encoding.to_ascii_uppercase().as_str() {
      "B" => base64::engine::general_purpose::STANDARD.decode(text).unwrap_or_else(|_| text.as_bytes().to_vec()),
      "Q" => q_decode(text),
      _ => text.as_bytes().to_vec(),
    };
    out.push_str(&decode_charset(&bytes, charset.split('*').next().unwrap_or(charset)));
    last_was_encoded = true;
    rest = tail;
  }
  out.push_str(rest);
  out
}

fn q_decode(text: &str) -> Vec<u8> {
  let b = text.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    match b[i] {
      b'_' => out.push(b' '),
      b'=' if i + 2 < b.len() => {
        if let Some(v) = hex_pair(b[i + 1], b[i + 2]) {
          out.push(v);
          i += 2;
        } else {
          out.push(b'=');
        }
      }
      other => out.push(other),
    }
    i += 1;
  }
  out
}

fn hex_pair(a: u8, b: u8) -> Option<u8> {
  let hi = (a as char).to_digit(16)?;
  let lo = (b as char).to_digit(16)?;
  Some((hi * 16 + lo) as u8)
}

/// Bytes in a named charset as text.
///
/// The name is looked up the way a browser looks up a page's charset, so
/// every one mail uses is known: Windows-1250 and ISO-8859-2 for Central
/// Europe, the Cyrillic ones, and the double-byte ones Outlook can pick,
/// such as GB2312 and ks_c_5601-1987. This used to know only UTF-8 and
/// the Latin-1 family, and read every other name as UTF-8: each byte
/// outside ASCII became a replacement mark, one per byte, in the stored
/// copy.
///
/// Two labels are not taken at their word. "us-ascii" cannot hold 8-bit
/// bytes, so bytes that are good UTF-8 are UTF-8. And UTF-8 that holds no
/// UTF-8 at all, only stray high bytes, is a Latin mail that did not say
/// so — often a part with no charset, which is read as UTF-8 by default.
///
/// Some senders mix the two in one part: a Latin template with UTF-8 put
/// into it (ScholarOne journal mail, 2026-10-17). There a stray byte beside
/// an ASCII letter — the "ü" in "f\xFCr" — is a Latin letter, not a broken
/// one. And the control characters U+0080 to U+009F, which no text uses,
/// are read as the Windows-1252 marks they stand for: "„" and "“" showed as
/// empty boxes.
pub fn decode_charset(bytes: &[u8], charset: &str) -> String {
  let label = charset.trim().trim_matches('"').trim();
  let encoding = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8);
  if encoding == encoding_rs::UTF_8 {
    if std::str::from_utf8(bytes).is_err() && !has_utf8_sequence(bytes) {
      return encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned();
    }
    return c1_as_windows_1252(utf8_with_latin_strays(bytes));
  }
  if label.eq_ignore_ascii_case("us-ascii") {
    if let Ok(text) = std::str::from_utf8(bytes) {
      return text.to_string();
    }
  }
  encoding.decode_without_bom_handling(bytes).0.into_owned()
}

/// UTF-8, where a stray byte beside an ASCII letter is read as
/// Windows-1252. Any other broken byte is the replacement mark.
fn utf8_with_latin_strays(bytes: &[u8]) -> String {
  let mut out = String::with_capacity(bytes.len());
  let mut at = 0;
  while at < bytes.len() {
    match std::str::from_utf8(&bytes[at..]) {
      Ok(text) => {
        out.push_str(text);
        break;
      }
      Err(err) => {
        let good = at + err.valid_up_to();
        // Safe: the bytes up to `good` were just checked.
        out.push_str(std::str::from_utf8(&bytes[at..good]).unwrap_or_default());
        let bad = err.error_len().unwrap_or(bytes.len() - good);
        let letter = |i: Option<usize>| i.and_then(|i| bytes.get(i)).is_some_and(u8::is_ascii_alphabetic);
        if bad == 1 && (letter(good.checked_sub(1)) || letter(Some(good + 1))) {
          let (latin, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(&bytes[good..good + 1]);
          out.push_str(&latin);
        } else {
          out.push('\u{fffd}');
        }
        at = good + bad;
      }
    }
  }
  out
}

/// The C1 control characters as the Windows-1252 marks they stand for.
fn c1_as_windows_1252(text: String) -> String {
  if !text.chars().any(|c| ('\u{80}'..='\u{9f}').contains(&c)) {
    return text;
  }
  text
    .chars()
    .map(|c| {
      if !('\u{80}'..='\u{9f}').contains(&c) {
        return c;
      }
      let byte = [c as u32 as u8];
      let (mark, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(&byte);
      mark.chars().next().unwrap_or(c)
    })
    .collect()
}

/// Whether the bytes hold at least one well-formed UTF-8 character
/// outside ASCII.
fn has_utf8_sequence(bytes: &[u8]) -> bool {
  let mut rest = bytes;
  loop {
    match std::str::from_utf8(rest) {
      Ok(text) => return !text.is_ascii(),
      Err(err) => {
        let good = err.valid_up_to();
        if !rest[..good].is_ascii() {
          return true;
        }
        let bad = err.error_len().unwrap_or(rest.len() - good);
        rest = &rest[good + bad..];
        if rest.is_empty() {
          return false;
        }
      }
    }
  }
}

/// Quoted-printable, as a body or part carries it.
pub fn qp_decode(text: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(text.len());
  let mut i = 0;
  while i < text.len() {
    if text[i] == b'=' {
      if i + 1 < text.len() && (text[i + 1] == b'\r' || text[i + 1] == b'\n') {
        // Soft line break.
        i += 1;
        if i < text.len() && text[i] == b'\r' {
          i += 1;
        }
        if i < text.len() && text[i] == b'\n' {
          i += 1;
        }
        continue;
      }
      if i + 2 < text.len() {
        if let Some(v) = hex_pair(text[i + 1], text[i + 2]) {
          out.push(v);
          i += 3;
          continue;
        }
      }
    }
    out.push(text[i]);
    i += 1;
  }
  out
}

/// A header block, unfolded, as (lower-cased name, value) in order.
pub fn parse_headers(block: &[u8]) -> Vec<(String, String)> {
  let text = String::from_utf8_lossy(block).replace("\r\n", "\n");
  let mut out: Vec<(String, String)> = Vec::new();
  for line in text.split('\n') {
    if line.is_empty() {
      continue;
    }
    if line.starts_with(' ') || line.starts_with('\t') {
      if let Some(last) = out.last_mut() {
        last.1.push(' ');
        last.1.push_str(line.trim());
      }
      continue;
    }
    if let Some((name, value)) = line.split_once(':') {
      out.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
  }
  out
}

pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
  headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

/// One address as a header names it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Mailbox {
  pub name: String,
  pub email: String,
}

/// The addresses in a From/To/Cc header, in order.
pub fn parse_address_list(value: &str) -> Vec<Mailbox> {
  let mut out = Vec::new();
  for entry in split_addresses(value) {
    let entry = entry.trim().trim_end_matches(';').trim();
    if entry.is_empty() {
      continue;
    }
    // A group: "Team: a@x, b@x;" — the name before the colon is not an address.
    let entry = match entry.find(':') {
      Some(colon) if !entry[..colon].contains('@') && !entry[..colon].contains('<') => entry[colon + 1..].trim(),
      _ => entry,
    };
    if entry.is_empty() {
      continue;
    }
    if let (Some(open), Some(close)) = (entry.rfind('<'), entry.rfind('>')) {
      if close > open {
        let email = clean_address(&entry[open + 1..close]);
        let name = strip_comments(&entry[..open]).trim().trim_matches('"').trim().to_string();
        out.push(Mailbox { name: decode_encoded_words(&name), email });
        continue;
      }
    }
    let bare = clean_address(&strip_comments(entry));
    if !bare.is_empty() {
      out.push(Mailbox { name: String::new(), email: bare });
    }
  }
  out
}

/// An address without the quotes some senders put round it. Outlook and
/// Exchange write `<'ann@x.test'>`; the quotes are not part of the
/// address, and Gmail refuses a recipient that keeps them. A quote inside
/// the address, as in `o'neill@x.test`, stays.
pub fn clean_address(raw: &str) -> String {
  let mut s = raw.trim();
  loop {
    let unquoted = s
      .strip_prefix('"')
      .and_then(|t| t.strip_suffix('"'))
      .or_else(|| s.strip_prefix('\'').and_then(|t| t.strip_suffix('\'')))
      .map(str::trim);
    match unquoted {
      Some(t) => s = t,
      None => break,
    }
  }
  s.to_string()
}

/// Split on the commas that separate addresses, not the ones inside a
/// quoted name or a comment.
fn split_addresses(value: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut current = String::new();
  let mut in_quote = false;
  let mut depth = 0;
  let mut in_angle = false;
  for c in value.chars() {
    match c {
      '"' => {
        in_quote = !in_quote;
        current.push(c);
      }
      '(' if !in_quote => {
        depth += 1;
        current.push(c);
      }
      ')' if !in_quote && depth > 0 => {
        depth -= 1;
        current.push(c);
      }
      '<' if !in_quote => {
        in_angle = true;
        current.push(c);
      }
      '>' if !in_quote => {
        in_angle = false;
        current.push(c);
      }
      ',' if !in_quote && depth == 0 && !in_angle => {
        out.push(std::mem::take(&mut current));
      }
      _ => current.push(c),
    }
  }
  if !current.trim().is_empty() {
    out.push(current);
  }
  out
}

fn strip_comments(text: &str) -> String {
  let mut out = String::new();
  let mut depth = 0;
  let mut in_quote = false;
  for c in text.chars() {
    match c {
      '"' => {
        in_quote = !in_quote;
        out.push(c);
      }
      '(' if !in_quote => depth += 1,
      ')' if !in_quote && depth > 0 => depth -= 1,
      _ if depth == 0 => out.push(c),
      _ => {}
    }
  }
  out
}

/// INTERNALDATE, "03-Sep-2026 14:20:34 +0000", as ms since the epoch.
pub fn parse_internal_date(text: &str) -> Option<i64> {
  let text = text.trim().trim_matches('"');
  let mut parts = text.split_whitespace();
  let date = parts.next()?;
  let time = parts.next()?;
  let zone = parts.next().unwrap_or("+0000");
  let mut d = date.split('-');
  let day: i64 = d.next()?.trim().parse().ok()?;
  let month = month_number(d.next()?)?;
  let year: i64 = d.next()?.parse().ok()?;
  let mut t = time.split(':');
  let hour: i64 = t.next()?.parse().ok()?;
  let minute: i64 = t.next()?.parse().ok()?;
  let second: i64 = t.next()?.parse().ok()?;
  let days = days_from_civil(year, month, day);
  let local = days * 86_400 + hour * 3_600 + minute * 60 + second;
  let offset = zone_offset_seconds(zone)?;
  Some((local - offset) * 1000)
}

fn month_number(name: &str) -> Option<i64> {
  const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let lower = name.to_ascii_lowercase();
  MONTHS.iter().position(|m| lower.starts_with(m)).map(|i| i as i64 + 1)
}

fn zone_offset_seconds(zone: &str) -> Option<i64> {
  let (sign, digits) = match zone.chars().next()? {
    '+' => (1, &zone[1..]),
    '-' => (-1, &zone[1..]),
    _ => return Some(0),
  };
  if digits.len() != 4 {
    return None;
  }
  let hours: i64 = digits[..2].parse().ok()?;
  let minutes: i64 = digits[2..].parse().ok()?;
  Some(sign * (hours * 3_600 + minutes * 60))
}

/// Days since 1970-01-01 for a civil date. Howard Hinnant's algorithm.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let mp = (m + 9) % 12;
  let doy = (153 * mp + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

// ---------------------------------------------------------------------------
// A snippet from the first bytes of the body
// ---------------------------------------------------------------------------

/// Parameters of a Content-Type or Content-Transfer-Encoding value.
fn param<'a>(value: &'a str, name: &str) -> Option<String> {
  let lower = value.to_ascii_lowercase();
  let key = format!("{name}=");
  let at = lower.find(&key)?;
  let rest = &value[at + key.len()..];
  let rest = rest.trim_start();
  if let Some(q) = rest.strip_prefix('"') {
    Some(q.split('"').next().unwrap_or("").to_string())
  } else {
    Some(rest.split(|c: char| c == ';' || c.is_whitespace()).next().unwrap_or("").to_string())
  }
}

/// Where `needle` first starts in `haystack`.
fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  if needle.is_empty() || needle.len() > haystack.len() {
    return None;
  }
  haystack.windows(needle.len()).position(|w| w == needle)
}

fn mime_type(content_type: &str) -> String {
  content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

/// The first readable words of a message, from the opening bytes of its
/// body and the headers that say how to read them. Multipart bodies are
/// walked to their first text part. The result is short, one line, plain.
pub fn snippet_from_body(body: &[u8], content_type: &str, transfer_encoding: &str, max_chars: usize) -> String {
  let text = first_text(body, content_type, transfer_encoding, 0);
  let mut out = String::new();
  for word in text.split_whitespace() {
    if out.len() + word.len() + 1 > max_chars {
      break;
    }
    if !out.is_empty() {
      out.push(' ');
    }
    out.push_str(word);
  }
  out
}

fn first_text(body: &[u8], content_type: &str, transfer_encoding: &str, depth: usize) -> String {
  let kind = mime_type(content_type);
  if kind.starts_with("multipart/") && depth < 4 {
    let Some(boundary) = param(content_type, "boundary") else {
      return String::new();
    };
    /*
      Cut on the bytes, and decode only the part, once, in its own charset.

      The whole body was made a string first, as UTF-8. A part in Latin-1
      sent as 8bit has bytes that are not UTF-8, so its "å" became the
      replacement character there; then the part, now those characters'
      UTF-8 bytes, was read in its own charset, and "på" came out as
      "pï¿½" in the list.
    */
    let marker = format!("--{boundary}");
    let Some(start) = find_bytes(body, marker.as_bytes()) else {
      return String::new();
    };
    let mut after = &body[start + marker.len()..];
    while let [b'\r' | b'\n', rest @ ..] = after {
      after = rest;
    }
    let (head, rest) = match find_bytes(after, b"\r\n\r\n").map(|i| (i, 4)).or_else(|| find_bytes(after, b"\n\n").map(|i| (i, 2))) {
      Some((i, n)) => (&after[..i], &after[i + n..]),
      None => return String::new(),
    };
    let headers = parse_headers(head);
    let part_type = header(&headers, "content-type").unwrap_or("text/plain");
    let part_cte = header(&headers, "content-transfer-encoding").unwrap_or("7bit");
    let end = find_bytes(rest, marker.as_bytes()).unwrap_or(rest.len());
    return first_text(&rest[..end], part_type, part_cte, depth + 1);
  }
  let decoded: Vec<u8> = match transfer_encoding.trim().to_ascii_lowercase().as_str() {
    "quoted-printable" => qp_decode(body),
    "base64" => {
      let compact: Vec<u8> = body.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
      // A partial fetch may cut mid-quantum; drop the ragged end.
      let usable = compact.len() - compact.len() % 4;
      base64::engine::general_purpose::STANDARD.decode(&compact[..usable]).unwrap_or_default()
    }
    _ => body.to_vec(),
  };
  let charset = param(content_type, "charset").unwrap_or_else(|| "utf-8".into());
  let text = decode_charset(&decoded, &charset);
  if kind == "text/html" {
    crate::messages::strip_html(&text)
  } else if kind.starts_with("text/") || kind.is_empty() {
    // Some senders write entities into the plain part too.
    crate::messages::plain_words(&text)
  } else {
    String::new()
  }
}
