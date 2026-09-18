//! A message's body, read out of its raw MIME.
//!
//! The thread view needs four things from a message: its plain text, its
//! HTML, the pictures the HTML refers to by cid, and the list of files
//! attached. The IMAP worker fetches the raw message once; this reads
//! those four out of it, and names every file by the IMAP section it sits
//! in, so the file's bytes can be fetched on their own later. Nothing here
//! touches the network.
//!
//! The rules follow the Gmail API path they replace: the first text/plain
//! part is the text, the first text/html part without a filename is the
//! HTML, an image with a Content-ID the HTML refers to is an inline
//! picture, everything else with a name or an attachment disposition is a
//! file. An unnamed calendar part is a file called invite.ics.

use std::collections::HashMap;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::imap::{decode_charset, decode_encoded_words, header, parse_headers, qp_decode};

/// A file in the message, by the section it can be fetched from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartInfo {
  /// IMAP section, e.g. "2" or "1.2". Fetch with BODY.PEEK[section].
  pub section: String,
  pub filename: String,
  pub mime_type: String,
  /// Decoded size in bytes, estimated from the encoded length.
  pub size: usize,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub content_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedMessage {
  pub headers: Vec<(String, String)>,
  pub text: Option<String>,
  pub html: Option<String>,
  /// cid → data: URI.
  pub inline_images: HashMap<String, String>,
  pub attachments: Vec<PartInfo>,
}

/// The largest picture inlined as a data URI, and the most per message.
/// Beyond these a picture is listed as a file instead.
const MAX_INLINE_IMAGE_BYTES: usize = 1_500_000;
const MAX_INLINE_TOTAL_BYTES: usize = 5_000_000;
/// The Gmail path capped text at this; the view never shows more.
const MAX_TEXT_CHARS: usize = 20_000;
const MAX_HTML_CHARS: usize = 500_000;

struct Part<'a> {
  section: String,
  headers: Vec<(String, String)>,
  body: &'a [u8],
}

pub fn parse_message(raw: &[u8]) -> ParsedMessage {
  let (head, body) = split_head(raw);
  let headers = parse_headers(head);
  let mut out = ParsedMessage { headers: headers.clone(), ..Default::default() };
  let mut leaves: Vec<Part<'_>> = Vec::new();
  collect_leaves(&headers, body, "", &mut leaves, 0);

  // Text and HTML first, so the pictures can be checked against the HTML.
  //
  // An HTML part that carries a file name but is not marked as an
  // attachment is still the message: some senders name their one HTML
  // part "attachment.html" and mean it as the body, and every other
  // reader shows it as one. Only "Content-Disposition: attachment" makes
  // it a file. A named text/plain part stays a file: a .txt sent along.
  let mut html_section: Option<String> = None;
  for part in &leaves {
    let (kind, params) = content_type(&part.headers);
    let named = filename_of(&part.headers).is_some();
    let disposition = disposition_of(&part.headers);
    if disposition == "attachment" || (named && kind != "text/html") {
      continue;
    }
    if kind == "text/plain" && out.text.is_none() {
      out.text = Some(cap(decode_text(part, &params), MAX_TEXT_CHARS));
    } else if kind == "text/html" && out.html.is_none() {
      let html = decode_text(part, &params);
      out.html = Some(if html.len() > MAX_HTML_CHARS { String::new() } else { html });
      html_section = Some(part.section.clone());
    }
  }
  if out.text.is_none() {
    if let Some(html) = &out.html {
      let stripped = crate::messages::strip_html(html);
      out.text = Some(cap(stripped.split_whitespace().collect::<Vec<_>>().join(" "), MAX_TEXT_CHARS));
    }
  }

  let html_ref = out.html.clone().unwrap_or_default();
  let mut inline_total = 0usize;
  for part in &leaves {
    let (kind, _params) = content_type(&part.headers);
    let filename = filename_of(&part.headers);
    let disposition = disposition_of(&part.headers);
    let content_id = header(&part.headers, "content-id").map(|c| c.trim().trim_matches(|ch| ch == '<' || ch == '>').to_string());
    let is_text_body = ((kind == "text/plain" || kind == "text/html") && filename.is_none() && disposition != "attachment")
      || html_section.as_deref() == Some(part.section.as_str());
    if is_text_body {
      continue;
    }
    if kind.starts_with("multipart/") {
      continue;
    }
    // A picture the HTML asks for by cid, or one marked inline with a cid.
    if kind.starts_with("image/") {
      if let Some(cid) = &content_id {
        let referenced = html_ref.contains(&format!("cid:{cid}"));
        if (referenced || disposition == "inline") && disposition != "attachment" {
          let bytes = decode_bytes(part);
          if bytes.len() <= MAX_INLINE_IMAGE_BYTES && inline_total + bytes.len() <= MAX_INLINE_TOTAL_BYTES {
            inline_total += bytes.len();
            let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
            out.inline_images.insert(cid.clone(), format!("data:{kind};base64,{data}"));
            continue;
          }
        }
      }
    }
    let is_calendar = kind == "text/calendar" || kind == "application/ics";
    let name = match filename {
      Some(name) => name,
      None if is_calendar => "invite.ics".to_string(),
      None if disposition == "attachment" || !kind.starts_with("text/") => default_name(&kind),
      None => continue,
    };
    out.attachments.push(PartInfo {
      section: part.section.clone(),
      filename: name,
      mime_type: if kind.is_empty() { "application/octet-stream".into() } else { kind },
      size: decoded_size(part),
      content_id,
    });
  }
  out
}

/// The header block and the body of a message or part.
fn split_head(raw: &[u8]) -> (&[u8], &[u8]) {
  if let Some(i) = find(raw, b"\r\n\r\n") {
    return (&raw[..i], &raw[i + 4..]);
  }
  if let Some(i) = find(raw, b"\n\n") {
    return (&raw[..i], &raw[i + 2..]);
  }
  (raw, &[])
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  if needle.is_empty() || haystack.len() < needle.len() {
    return None;
  }
  haystack.windows(needle.len()).position(|w| w == needle)
}

/// Walk the multipart tree, numbering sections the IMAP way.
fn collect_leaves<'a>(
  headers: &[(String, String)],
  body: &'a [u8],
  section: &str,
  out: &mut Vec<Part<'a>>,
  depth: usize,
) {
  let (kind, params) = content_type(headers);
  if kind.starts_with("multipart/") && depth < 8 {
    let Some(boundary) = params.get("boundary") else {
      out.push(Part { section: leaf_section(section), headers: headers.to_vec(), body });
      return;
    };
    let children = split_multipart(body, boundary);
    if children.is_empty() {
      out.push(Part { section: leaf_section(section), headers: headers.to_vec(), body });
      return;
    }
    for (i, child) in children.iter().enumerate() {
      let child_section = if section.is_empty() { format!("{}", i + 1) } else { format!("{section}.{}", i + 1) };
      let (head, child_body) = split_head(child);
      let child_headers = parse_headers(head);
      let (child_kind, _) = content_type(&child_headers);
      if child_kind == "message/rfc822" && filename_of(&child_headers).is_none() {
        // An attached message: a file, named from its subject.
        let (inner_head, _) = split_head(child_body);
        let inner = parse_headers(inner_head);
        let subject = header(&inner, "subject").map(decode_encoded_words).unwrap_or_default();
        let mut named = child_headers.clone();
        named.push(("content-disposition".into(), format!("attachment; filename=\"{}.eml\"", if subject.is_empty() { "message".into() } else { subject })));
        out.push(Part { section: child_section, headers: named, body: child_body });
        continue;
      }
      collect_leaves(&child_headers, child_body, &child_section, out, depth + 1);
    }
    return;
  }
  out.push(Part { section: leaf_section(section), headers: headers.to_vec(), body });
}

/// A non-multipart message's one part is section 1.
fn leaf_section(section: &str) -> String {
  if section.is_empty() { "1".into() } else { section.into() }
}

fn split_multipart<'a>(body: &'a [u8], boundary: &str) -> Vec<&'a [u8]> {
  let marker = format!("--{boundary}");
  let mut parts = Vec::new();
  let mut pos = 0;
  let mut current_start: Option<usize> = None;
  while let Some(rel) = find(&body[pos..], marker.as_bytes()) {
    let at = pos + rel;
    // A marker starts a line.
    let at_line_start = at == 0 || body[at - 1] == b'\n';
    if !at_line_start {
      pos = at + marker.len();
      continue;
    }
    if let Some(start) = current_start {
      let mut end = at;
      if end > start && body[end - 1] == b'\n' {
        end -= 1;
      }
      if end > start && body[end - 1] == b'\r' {
        end -= 1;
      }
      parts.push(&body[start..end]);
    }
    let after = at + marker.len();
    if body[after..].starts_with(b"--") {
      current_start = None;
      break;
    }
    let mut next = after;
    while next < body.len() && (body[next] == b' ' || body[next] == b'\t') {
      next += 1;
    }
    if body[next..].starts_with(b"\r\n") {
      next += 2;
    } else if body[next..].starts_with(b"\n") {
      next += 1;
    }
    current_start = Some(next);
    pos = next;
  }
  if let Some(start) = current_start {
    parts.push(&body[start..]);
  }
  parts
}

/// The mime type, lower-cased, and its parameters, keys lower-cased.
fn content_type(headers: &[(String, String)]) -> (String, HashMap<String, String>) {
  let value = header(headers, "content-type").unwrap_or("text/plain");
  let mut pieces = value.split(';');
  let kind = pieces.next().unwrap_or("").trim().to_ascii_lowercase();
  let params = params_of(pieces);
  (kind, params)
}

fn params_of<'a>(pieces: impl Iterator<Item = &'a str>) -> HashMap<String, String> {
  let mut params: HashMap<String, String> = HashMap::new();
  // RFC 2231 continuations: name*0, name*1 … and name*=charset''value.
  let mut continued: Vec<(String, usize, String, bool)> = Vec::new();
  for piece in pieces {
    let Some((k, v)) = piece.split_once('=') else { continue };
    let key = k.trim().to_ascii_lowercase();
    let value = v.trim().trim_matches('"').to_string();
    if let Some(base) = key.strip_suffix('*') {
      if let Some((name, index)) = base.split_once('*') {
        if let Ok(i) = index.parse() {
          continued.push((name.to_string(), i, value, true));
          continue;
        }
      }
      params.insert(base.to_string(), rfc2231_decode(&value));
      continue;
    }
    if let Some((name, index)) = key.split_once('*') {
      if let Ok(i) = index.parse() {
        continued.push((name.to_string(), i, value, false));
        continue;
      }
    }
    params.entry(key).or_insert(value);
  }
  if !continued.is_empty() {
    continued.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut joined: HashMap<String, (String, bool)> = HashMap::new();
    for (name, _, value, encoded) in continued {
      let entry = joined.entry(name).or_insert((String::new(), false));
      entry.0.push_str(&value);
      entry.1 |= encoded;
    }
    for (name, (value, encoded)) in joined {
      params.insert(name, if encoded { rfc2231_decode(&value) } else { value });
    }
  }
  params
}

/// `utf-8''caf%C3%A9.pdf` → café.pdf
fn rfc2231_decode(value: &str) -> String {
  let (charset, rest) = match value.splitn(3, '\'').collect::<Vec<_>>().as_slice() {
    [cs, _lang, rest] => (cs.to_string(), rest.to_string()),
    _ => ("utf-8".to_string(), value.to_string()),
  };
  let bytes = rest.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() + 0 && i + 2 <= bytes.len() - 1 {
      if let (Some(h), Some(l)) = ((bytes[i + 1] as char).to_digit(16), (bytes[i + 2] as char).to_digit(16)) {
        out.push((h * 16 + l) as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  decode_charset(&out, &charset)
}

fn disposition_of(headers: &[(String, String)]) -> String {
  header(headers, "content-disposition")
    .map(|d| d.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
    .unwrap_or_default()
}

/// The part's file name, from Content-Disposition or Content-Type, decoded.
pub fn filename_of(headers: &[(String, String)]) -> Option<String> {
  let from_disposition = header(headers, "content-disposition")
    .and_then(|d| params_of(d.split(';').skip(1)).get("filename").cloned());
  let from_type = header(headers, "content-type")
    .and_then(|d| params_of(d.split(';').skip(1)).get("name").cloned());
  let raw = from_disposition.or(from_type)?;
  let name = decode_encoded_words(raw.trim()).trim().to_string();
  if name.is_empty() { None } else { Some(name) }
}

fn default_name(kind: &str) -> String {
  let ext = kind.rsplit('/').next().unwrap_or("bin");
  format!("attachment.{ext}")
}

fn transfer_encoding(headers: &[(String, String)]) -> String {
  header(headers, "content-transfer-encoding").unwrap_or("7bit").trim().to_ascii_lowercase()
}

/// The part's bytes as sent, decoded from its transfer encoding.
fn decode_bytes(part: &Part<'_>) -> Vec<u8> {
  decode_body(part.body, &transfer_encoding(&part.headers))
}

pub fn decode_body(body: &[u8], transfer_encoding: &str) -> Vec<u8> {
  match transfer_encoding {
    "quoted-printable" => qp_decode(body),
    "base64" => {
      let compact: Vec<u8> = body.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
      base64::engine::general_purpose::STANDARD
        .decode(&compact)
        .or_else(|_| {
          let usable = compact.len() - compact.len() % 4;
          base64::engine::general_purpose::STANDARD.decode(&compact[..usable])
        })
        .unwrap_or_default()
    }
    _ => body.to_vec(),
  }
}

fn decoded_size(part: &Part<'_>) -> usize {
  match transfer_encoding(&part.headers).as_str() {
    "base64" => part.body.iter().filter(|b| !b.is_ascii_whitespace()).count() * 3 / 4,
    _ => part.body.len(),
  }
}

fn decode_text(part: &Part<'_>, params: &HashMap<String, String>) -> String {
  let bytes = decode_bytes(part);
  let charset = params.get("charset").map(String::as_str).unwrap_or("utf-8");
  decode_charset(&bytes, charset)
}

fn cap(text: String, max: usize) -> String {
  if text.chars().count() <= max {
    return text;
  }
  let mut out: String = text.chars().take(max).collect();
  out.push_str("\n[truncated]");
  out
}

// ---------------------------------------------------------------------------
// The message as the server describes it, so the parts worth having are
// fetched on their own and the rest is only named
// ---------------------------------------------------------------------------

/// One leaf of a message, as BODYSTRUCTURE lists it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StructurePart {
  /// IMAP section, e.g. "1" or "2.1". Fetch with BODY.PEEK[section].
  pub section: String,
  /// "text/html", lower case.
  pub kind: String,
  pub params: HashMap<String, String>,
  pub content_id: Option<String>,
  /// Transfer encoding, lower case: "base64", "quoted-printable", "7bit".
  pub encoding: String,
  /// Encoded size in octets, as the server counts it.
  pub size: usize,
  /// "attachment", "inline", or empty.
  pub disposition: String,
  pub filename: Option<String>,
}

impl StructurePart {
  /// The same rule as parse_message: a named HTML part is still the body
  /// unless it is marked as an attachment.
  fn is_text_body(&self) -> bool {
    if self.disposition == "attachment" {
      return false;
    }
    self.kind == "text/html" || (self.kind == "text/plain" && self.filename.is_none())
  }
  /// The size once decoded, from the encoded octets.
  pub fn decoded_size(&self) -> usize {
    if self.encoding == "base64" {
      self.size * 3 / 4
    } else {
      self.size
    }
  }
}

/// The leaves of a BODYSTRUCTURE, with their sections.
///
/// A multipart is a list whose first element is itself a list; its
/// children are numbered from one under the multipart's own section. A
/// single part is (type subtype params id description encoding size …),
/// with the disposition somewhere in the extension data after the size.
/// A message that is one part is section "1".
pub fn structure_parts(item: &crate::imap::Item) -> Vec<StructurePart> {
  let mut out = Vec::new();
  walk_structure(item, "", &mut out);
  out
}

fn walk_structure(item: &crate::imap::Item, prefix: &str, out: &mut Vec<StructurePart>) {
  use crate::imap::Item;
  let list = item.as_list();
  if list.is_empty() {
    return;
  }
  if matches!(list[0], Item::List(_)) {
    let mut n = 1;
    for child in &list {
      let Item::List(_) = child else { break };
      let section = if prefix.is_empty() { n.to_string() } else { format!("{prefix}.{n}") };
      walk_structure(child, &section, out);
      n += 1;
    }
    return;
  }
  let text = |i: usize| list.get(i).and_then(Item::as_str);
  let kind = format!("{}/{}", text(0).unwrap_or_default(), text(1).unwrap_or_default()).to_ascii_lowercase();
  let params = list.get(2).map(structure_params).unwrap_or_default();
  let content_id = text(3)
    .map(|c| c.trim().trim_matches(|ch| ch == '<' || ch == '>').to_string())
    .filter(|c| !c.is_empty());
  let encoding = text(5).unwrap_or_else(|| "7bit".into()).to_ascii_lowercase();
  let size = list.get(6).and_then(Item::as_u64).unwrap_or(0) as usize;
  let mut disposition = String::new();
  let mut filename: Option<String> = None;
  for ext in list.iter().skip(7) {
    let Item::List(d) = ext else { continue };
    let Some(word) = d.first().and_then(Item::as_str) else { continue };
    let word = word.to_ascii_lowercase();
    if word == "attachment" || word == "inline" {
      disposition = word;
      if let Some(p) = d.get(1) {
        filename = structure_params(p).get("filename").cloned();
      }
      break;
    }
  }
  let filename = filename.or_else(|| params.get("name").cloned()).filter(|n| !n.is_empty());
  let section = if prefix.is_empty() { "1".to_string() } else { prefix.to_string() };
  out.push(StructurePart { section, kind, params, content_id, encoding, size, disposition, filename });
}

/// A parameter list — ("charset" "utf-8" "name" "a.pdf") — as a map with
/// lower-case keys, RFC 2231 pieces joined and decoded, encoded words
/// decoded.
fn structure_params(item: &crate::imap::Item) -> HashMap<String, String> {
  let list = item.as_list();
  let mut raw: Vec<(String, String)> = Vec::new();
  let mut i = 0;
  while i + 1 < list.len() {
    if let (Some(k), Some(v)) = (list[i].as_str(), list[i + 1].as_str()) {
      raw.push((k.to_ascii_lowercase(), v));
    }
    i += 2;
  }
  // "filename*0*", "filename*1*" … in order, then "filename*", then plain.
  raw.sort_by(|a, b| a.0.cmp(&b.0));
  let mut out: HashMap<String, String> = HashMap::new();
  let mut pieces: HashMap<String, String> = HashMap::new();
  for (k, v) in raw {
    if let Some(base) = k.strip_suffix('*') {
      let base = base.split('*').next().unwrap_or(base).to_string();
      pieces.entry(base).or_default().push_str(&v);
    } else if let Some((base, _)) = k.split_once('*') {
      pieces.entry(base.to_string()).or_default().push_str(&v);
    } else {
      out.insert(k, crate::imap::decode_encoded_words(&v));
    }
  }
  for (base, joined) in pieces {
    out.insert(base, rfc2231_decode(&joined));
  }
  out
}

/// The parts to fetch for a message, and the files to list without
/// fetching them.
#[derive(Debug, Default)]
pub struct PartPlan {
  pub text: Option<StructurePart>,
  pub html: Option<StructurePart>,
  /// Pictures the HTML may ask for by cid, small enough to keep inline.
  pub inline: Vec<StructurePart>,
  pub attachments: Vec<PartInfo>,
}

/// A text part larger than this is a document, not a message; it is not
/// fetched into the copy and the reader opens it as a file.
const MAX_TEXT_PART_BYTES: usize = 2_000_000;

/// Which parts to ask for. The first plain text and the first HTML that
/// are not files; pictures with a content id that fit the inline caps;
/// everything else by name only.
pub fn plan_parts(parts: &[StructurePart]) -> PartPlan {
  let mut plan = PartPlan::default();
  for part in parts {
    if part.is_text_body() && part.size <= MAX_TEXT_PART_BYTES {
      if part.kind == "text/plain" && plan.text.is_none() {
        plan.text = Some(part.clone());
        continue;
      }
      if part.kind == "text/html" && plan.html.is_none() {
        plan.html = Some(part.clone());
        continue;
      }
    }
  }
  let mut inline_total = 0usize;
  for part in parts {
    if part.is_text_body() || part.kind.starts_with("multipart/") {
      continue;
    }
    let is_inline_picture = part.kind.starts_with("image/")
      && part.content_id.is_some()
      && part.disposition != "attachment";
    if is_inline_picture {
      let size = part.decoded_size();
      if size <= MAX_INLINE_IMAGE_BYTES && inline_total + size <= MAX_INLINE_TOTAL_BYTES {
        inline_total += size;
        plan.inline.push(part.clone());
        continue;
      }
    }
    let is_calendar = part.kind == "text/calendar" || part.kind == "application/ics";
    let name = match &part.filename {
      Some(name) => name.clone(),
      None if is_calendar => "invite.ics".to_string(),
      None if part.disposition == "attachment" || !part.kind.starts_with("text/") => default_name(&part.kind),
      None => continue,
    };
    plan.attachments.push(PartInfo {
      section: part.section.clone(),
      filename: name,
      mime_type: if part.kind == "/" { "application/octet-stream".into() } else { part.kind.clone() },
      size: part.decoded_size(),
      content_id: part.content_id.clone(),
    });
  }
  plan
}

/// The message put together from the parts fetched for the plan.
/// `fetched` maps a section to its bytes as sent.
pub fn assemble(plan: &PartPlan, fetched: &HashMap<String, Vec<u8>>) -> ParsedMessage {
  let mut out = ParsedMessage::default();
  let decode = |part: &StructurePart| -> Option<String> {
    let bytes = fetched.get(&part.section)?;
    let decoded = decode_body(bytes, &part.encoding);
    let charset = part.params.get("charset").map(String::as_str).unwrap_or("utf-8");
    Some(decode_charset(&decoded, charset))
  };
  if let Some(part) = &plan.text {
    out.text = decode(part).map(|t| cap(t, MAX_TEXT_CHARS));
  }
  if let Some(part) = &plan.html {
    out.html = decode(part).map(|h| if h.len() > MAX_HTML_CHARS { String::new() } else { h });
  }
  if out.text.is_none() {
    if let Some(html) = &out.html {
      let stripped = crate::messages::strip_html(html);
      out.text = Some(cap(stripped.split_whitespace().collect::<Vec<_>>().join(" "), MAX_TEXT_CHARS));
    }
  }
  for part in &plan.inline {
    let (Some(cid), Some(bytes)) = (&part.content_id, fetched.get(&part.section)) else { continue };
    let data = base64::engine::general_purpose::STANDARD.encode(decode_body(bytes, &part.encoding));
    out.inline_images.insert(cid.clone(), format!("data:{};base64,{data}", part.kind));
  }
  out.attachments = plan.attachments.clone();
  out
}

/// The bytes of one part fetched on its own, decoded with the transfer
/// encoding its own headers name. `mime_head` is BODY[section.MIME].
pub fn decode_fetched_part(mime_head: &[u8], body: &[u8]) -> (Vec<u8>, String, Option<String>) {
  let headers = parse_headers(mime_head);
  let (kind, _) = content_type(&headers);
  let bytes = decode_body(body, &transfer_encoding(&headers));
  (bytes, if kind.is_empty() { "application/octet-stream".into() } else { kind }, filename_of(&headers))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::imap::Item;

  fn s(v: &str) -> Item {
    Item::Str(v.into())
  }
  fn list(v: Vec<Item>) -> Item {
    Item::List(v)
  }

  /// multipart/mixed( multipart/alternative( text/plain, text/html ), image/png inline cid, application/pdf attachment )
  fn structure() -> Item {
    let plain = list(vec![
      s("TEXT"), s("PLAIN"), list(vec![s("CHARSET"), s("ISO-8859-1")]), Item::Nil, Item::Nil,
      s("QUOTED-PRINTABLE"), Item::Num(28), Item::Num(2), Item::Nil, Item::Nil, Item::Nil, Item::Nil,
    ]);
    let html = list(vec![
      s("TEXT"), s("HTML"), list(vec![s("CHARSET"), s("UTF-8")]), Item::Nil, Item::Nil,
      s("7BIT"), Item::Num(40), Item::Num(1), Item::Nil, Item::Nil, Item::Nil, Item::Nil,
    ]);
    let alternative = list(vec![plain, html, s("ALTERNATIVE"), list(vec![s("BOUNDARY"), s("alt")]), Item::Nil, Item::Nil, Item::Nil]);
    let picture = list(vec![
      s("IMAGE"), s("PNG"), list(vec![s("NAME"), s("pic.png")]), s("<pic1>"), Item::Nil, s("BASE64"), Item::Num(16),
      Item::Nil, list(vec![s("INLINE"), list(vec![s("FILENAME"), s("pic.png")])]), Item::Nil, Item::Nil,
    ]);
    let pdf = list(vec![
      s("APPLICATION"), s("PDF"), list(vec![s("NAME"), s("plain.pdf")]), Item::Nil, Item::Nil, s("BASE64"), Item::Num(4_000_000),
      Item::Nil, list(vec![s("ATTACHMENT"), list(vec![s("FILENAME*"), s("utf-8''caf%C3%A9%20menu.pdf")])]), Item::Nil, Item::Nil,
    ]);
    list(vec![alternative, picture, pdf, s("MIXED"), list(vec![s("BOUNDARY"), s("outer")]), Item::Nil, Item::Nil, Item::Nil])
  }

  #[test]
  fn the_structure_names_every_leaf_with_its_section() {
    let parts = structure_parts(&structure());
    let sections: Vec<(&str, &str)> = parts.iter().map(|p| (p.section.as_str(), p.kind.as_str())).collect();
    assert_eq!(
      sections,
      vec![("1.1", "text/plain"), ("1.2", "text/html"), ("2", "image/png"), ("3", "application/pdf")]
    );
    assert_eq!(parts[0].params.get("charset").map(String::as_str), Some("ISO-8859-1"));
    assert_eq!(parts[2].content_id.as_deref(), Some("pic1"));
    assert_eq!(parts[2].disposition, "inline");
    assert_eq!(parts[3].disposition, "attachment");
    assert_eq!(parts[3].filename.as_deref(), Some("café menu.pdf"));
  }

  #[test]
  fn the_plan_fetches_text_and_small_pictures_and_only_names_the_files() {
    let plan = plan_parts(&structure_parts(&structure()));
    assert_eq!(plan.text.as_ref().map(|p| p.section.as_str()), Some("1.1"));
    assert_eq!(plan.html.as_ref().map(|p| p.section.as_str()), Some("1.2"));
    assert_eq!(plan.inline.iter().map(|p| p.section.as_str()).collect::<Vec<_>>(), vec!["2"]);
    assert_eq!(plan.attachments.len(), 1);
    assert_eq!(plan.attachments[0].section, "3");
    assert_eq!(plan.attachments[0].filename, "café menu.pdf");
    assert_eq!(plan.attachments[0].size, 3_000_000);
  }

  #[test]
  fn the_parts_fetched_are_put_together_like_a_whole_message() {
    let plan = plan_parts(&structure_parts(&structure()));
    let mut fetched = HashMap::new();
    fetched.insert("1.1".to_string(), b"K=E6re Ulrik,\r\nse billedet.".to_vec());
    fetched.insert("1.2".to_string(), b"<p>K\xc3\xa6re Ulrik, <img src=\"cid:pic1\"></p>".to_vec());
    fetched.insert("2".to_string(), b"iVBORw0KGgo=".to_vec());
    let m = assemble(&plan, &fetched);
    assert_eq!(m.text.as_deref(), Some("Kære Ulrik,\r\nse billedet."));
    assert!(m.html.as_deref().unwrap().contains("cid:pic1"));
    assert!(m.inline_images["pic1"].starts_with("data:image/png;base64,iVBOR"));
    assert_eq!(m.attachments.len(), 1);
  }

  #[test]
  fn a_single_part_message_is_section_one() {
    let one = list(vec![
      s("TEXT"), s("PLAIN"), list(vec![s("CHARSET"), s("UTF-8")]), Item::Nil, Item::Nil, s("7BIT"), Item::Num(5), Item::Num(1),
    ]);
    let parts = structure_parts(&one);
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].section, "1");
    let plan = plan_parts(&parts);
    assert_eq!(plan.text.as_ref().map(|p| p.section.as_str()), Some("1"));
  }

  const RAW: &str = "From: Ann <ann@x.test>\r\nSubject: =?utf-8?Q?Caf=C3=A9?=\r\nContent-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n\
--outer\r\nContent-Type: multipart/related; boundary=\"rel\"\r\n\r\n\
--rel\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n\
--alt\r\nContent-Type: text/plain; charset=\"iso-8859-1\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nK=E6re Ulrik,\r\nse billedet.\r\n\
--alt\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>K\u{e6}re Ulrik, <img src=\"cid:pic1\"></p>\r\n\
--alt--\r\n\
--rel\r\nContent-Type: image/png\r\nContent-ID: <pic1>\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: inline; filename=\"pic.png\"\r\n\r\niVBORw0KGgo=\r\n\
--rel--\r\n\
--outer\r\nContent-Type: application/pdf; name=\"plain.pdf\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename*=utf-8''caf%C3%A9%20menu.pdf\r\n\r\nJVBERi0xLjQK\r\n\
--outer\r\nContent-Type: text/calendar; method=REQUEST\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n\
--outer--\r\n";

  #[test]
  fn a_named_html_part_that_is_not_an_attachment_is_the_body() {
    let raw = "From: Kursus <noreply@example.test>\r\nContent-Type: multipart/mixed; boundary=\"m\"\r\n\r\n\
--m\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nK&aelig;re Ulrik\r\n\
--m\r\nContent-Type: text/html; charset=utf-8; name=\"attachment.html\"\r\n\r\n<p>K\u{e6}re Ulrik</p>\r\n\
--m\r\nContent-Type: text/html; charset=utf-8; name=\"notes.html\"\r\nContent-Disposition: attachment; filename=\"notes.html\"\r\n\r\n<p>a file</p>\r\n\
--m--\r\n";
    let m = parse_message(raw.as_bytes());
    assert_eq!(m.html.as_deref(), Some("<p>Kære Ulrik</p>"));
    let names: Vec<&str> = m.attachments.iter().map(|a| a.filename.as_str()).collect();
    assert_eq!(names, vec!["notes.html"]);
  }

  #[test]
  fn text_html_inline_pictures_and_files_are_read_with_their_sections() {
    let m = parse_message(RAW.as_bytes());
    assert_eq!(m.text.as_deref(), Some("Kære Ulrik,\r\nse billedet."));
    assert!(m.html.as_deref().unwrap().contains("cid:pic1"));
    assert_eq!(m.inline_images.len(), 1);
    assert!(m.inline_images["pic1"].starts_with("data:image/png;base64,iVBOR"));
    let names: Vec<(&str, &str)> = m.attachments.iter().map(|a| (a.filename.as_str(), a.section.as_str())).collect();
    assert_eq!(names, vec![("café menu.pdf", "2"), ("invite.ics", "3")]);
    assert_eq!(m.attachments[0].mime_type, "application/pdf");
    assert_eq!(m.attachments[0].size, 9);
  }

  #[test]
  fn a_single_part_message_is_section_one_and_html_becomes_text() {
    let raw = b"Content-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+SGkgPGI+dGhlcmU8L2I+PC9wPg==\r\n";
    let m = parse_message(raw);
    assert_eq!(m.html.as_deref(), Some("<p>Hi <b>there</b></p>"));
    assert_eq!(m.text.as_deref(), Some("Hi there"));
    assert!(m.attachments.is_empty());
  }

  #[test]
  fn an_unreferenced_picture_is_a_file_and_an_attached_message_is_named_by_its_subject() {
    let raw = "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nhello\r\n--b\r\nContent-Type: image/jpeg\r\nContent-ID: <x>\r\nContent-Disposition: attachment; filename=\"photo.jpg\"\r\n\r\nxx\r\n--b\r\nContent-Type: message/rfc822\r\n\r\nSubject: Fwd: plan\r\n\r\nbody\r\n--b--\r\n";
    let m = parse_message(raw.as_bytes());
    assert!(m.inline_images.is_empty());
    let names: Vec<&str> = m.attachments.iter().map(|a| a.filename.as_str()).collect();
    assert_eq!(names, vec!["photo.jpg", "Fwd: plan.eml"]);
    assert_eq!(m.attachments[1].section, "3");
  }

  #[test]
  fn a_fetched_part_decodes_by_its_own_headers() {
    let (bytes, kind, name) = decode_fetched_part(
      b"Content-Type: text/plain; name=\"a.txt\"\r\nContent-Transfer-Encoding: base64\r\n\r\n",
      b"aGVsbG8=",
    );
    assert_eq!(bytes, b"hello");
    assert_eq!(kind, "text/plain");
    assert_eq!(name.as_deref(), Some("a.txt"));
  }
}
