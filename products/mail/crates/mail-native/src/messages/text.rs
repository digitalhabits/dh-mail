//! Plain text from HTML and from text parts, for snippets and search.

/// HTML tags that a sender left in text that is meant to be plain.
///
/// One airline writes `Dear <span class="personaldata">Dr Holm</span>,`
/// into the text/plain part of its e-ticket, and the row showed the tags.
/// Only a known tag name goes, and only when a space, a slash or the end of
/// the tag follows it. So `<ulrik@example.org>`, `<https://example.org>`,
/// `a < b` and a placeholder such as `<name>` all stay as written.
pub fn strip_stray_tags(text: &str) -> String {
  const TAGS: &[&str] = &[
    "a", "b", "blockquote", "br", "center", "div", "em", "font", "h1", "h2", "h3", "h4", "h5",
    "h6", "hr", "i", "img", "li", "ol", "p", "pre", "small", "span", "strong", "sub", "sup",
    "table", "tbody", "td", "th", "tr", "u", "ul",
  ];
  const INLINE: &[&str] =
    &["a", "b", "em", "font", "i", "small", "span", "strong", "sub", "sup", "u"];
  if !text.contains('<') {
    return text.to_string();
  }
  let mut out = String::with_capacity(text.len());
  let mut rest = text;
  while let Some(i) = rest.find('<') {
    out.push_str(&rest[..i]);
    let after = &rest[i + 1..];
    let inner = after.strip_prefix('/').unwrap_or(after);
    let name_len = inner.chars().take_while(|c| c.is_ascii_alphanumeric()).count();
    let name = inner[..name_len].to_ascii_lowercase();
    let follows = inner[name_len..].chars().next();
    let shaped = TAGS.contains(&name.as_str())
      && matches!(follows, Some(c) if c == '>' || c == '/' || c.is_whitespace());
    // A tag ends on its own line or the next; a `<` with no `>` near it is text.
    let close = after.find('>').filter(|at| *at < 400 && !after[..*at].contains('<'));
    match (shaped, close) {
      (true, Some(at)) => {
        // A break or a block ends a word; a span or a bold does not.
        if !INLINE.contains(&name.as_str()) {
          out.push(' ');
        }
        rest = &after[at + 1..];
      }
      _ => {
        out.push('<');
        rest = after;
      }
    }
  }
  out.push_str(rest);
  out
}

/// A whole HTML page sent as plain text.
///
/// One airline sends its itinerary with the same page in both parts, so
/// the plain part begins `<!DOCTYPE html PUBLIC …` and the row showed
/// that. Only a page that starts as one counts: a text that names a tag
/// further in is still text.
pub fn is_html_page(text: &str) -> bool {
  let start: String = text.trim_start().chars().take(14).collect::<String>().to_ascii_lowercase();
  start.starts_with("<!doctype html") || start.starts_with("<html")
}

/// Plain text as words: tags a sender left in it out, entities read. A
/// whole page sent as plain text is read as the page it is.
pub fn plain_words(text: &str) -> String {
  if is_html_page(text) {
    strip_html(text)
  } else {
    decode_entities(&strip_stray_tags(text))
  }
}

/// The first words of a body's text, as a row shows them.
pub(super) fn snippet_of(search_text: &str) -> String {
  let words: String = search_text.split_whitespace().take(40).collect::<Vec<_>>().join(" ");
  words.chars().take(200).collect()
}

/// Tags out, a few entities back, whitespace squashed: enough for search.
pub fn strip_html(html: &str) -> String {
  let mut out = String::with_capacity(html.len());
  let mut in_tag = false;
  let mut in_style_or_script = false;
  let bytes = html.as_bytes();
  let mut i = 0;
  // Compared as ASCII on the bytes at hand. A lower-cased copy of the
  // whole string was indexed with these offsets, and lower-casing moves
  // them: "İ" is two bytes and its lower case is three, so the copy was
  // cut mid-character and the thread panicked with the store's lock held.
  let starts = |at: usize, tag: &str| {
    bytes
      .get(at..at + tag.len())
      .map(|s| s.eq_ignore_ascii_case(tag.as_bytes()))
      .unwrap_or(false)
  };
  while i < bytes.len() {
    if !in_tag && bytes[i] == b'<' {
      /*
        A comment is skipped whole. What is inside one is not words: the
        Outlook-only settings block many senders carry —
        <!--[if gte mso 9]><xml>…<o:PixelsPerInch>96</o:PixelsPerInch>…
        — was read as the text "96", and that was the snippet of every
        one of Ryanair's mails. A comment the buffer cuts short — the
        snippet reads the first two kilobytes — ends the text there,
        which is no words rather than the wrong ones.
      */
      if starts(i, "<!--") {
        match find_from(bytes, i + 4, b"-->") {
          Some(end) => {
            out.push(' ');
            i = end + 3;
            continue;
          }
          None => break,
        }
      }
      in_tag = true;
      // The head holds no words either: its title, styles, and the
      // settings blocks above.
      if starts(i, "<style") || starts(i, "<script") || starts(i, "<xml") || starts(i, "<head") || starts(i, "<title") {
        in_style_or_script = true;
      } else if starts(i, "</style") || starts(i, "</script") || starts(i, "</xml") || starts(i, "</head") || starts(i, "</title") {
        in_style_or_script = false;
      }
      out.push(' ');
      i += 1;
      continue;
    }
    if in_tag {
      if bytes[i] == b'>' {
        in_tag = false;
      }
      i += 1;
      continue;
    }
    if in_style_or_script {
      i += 1;
      continue;
    }
    // Copy one UTF-8 character.
    let ch_len = utf8_len(bytes[i]);
    out.push_str(&html[i..(i + ch_len).min(bytes.len())]);
    i += ch_len;
  }
  decode_entities(&out)
}

/// HTML entities back to their characters: every numeric one, and the
/// named ones a message is likely to hold. A name not known stays as it
/// was written, ampersand and all.
///
/// Used on HTML once the tags are out, and on plain text too: some
/// senders write their plain part with entities in it ("K&aelig;re"),
/// and the row's line is the first words of that part.
pub fn decode_entities(text: &str) -> String {
  if !text.contains('&') {
    return text.to_string();
  }
  let mut out = String::with_capacity(text.len());
  let mut rest = text;
  while let Some(i) = rest.find('&') {
    out.push_str(&rest[..i]);
    let after = &rest[i + 1..];
    // An entity is a short run of name characters closed by ';'.
    let run = after.find(|c: char| !(c.is_ascii_alphanumeric() || c == '#')).unwrap_or(after.len());
    let closed = run > 0 && run <= 10 && after[run..].starts_with(';');
    match if closed { entity_text(&after[..run]) } else { None } {
      Some(decoded) => {
        out.push_str(&decoded);
        rest = &after[run + 1..];
      }
      None => {
        out.push('&');
        rest = after;
      }
    }
  }
  out.push_str(rest);
  out
}

fn entity_text(name: &str) -> Option<String> {
  if let Some(num) = name.strip_prefix('#') {
    let code = match num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
      Some(hex) => u32::from_str_radix(hex, 16).ok()?,
      None => num.parse::<u32>().ok()?,
    };
    let ch = char::from_u32(code)?;
    if ch.is_control() && ch != '\n' && ch != '\t' {
      return None;
    }
    return Some(ch.to_string());
  }
  let ch = match name {
    "amp" => '&',
    "lt" => '<',
    "gt" => '>',
    "quot" => '"',
    "apos" => '\'',
    "nbsp" => ' ',
    "aelig" => 'æ',
    "AElig" => 'Æ',
    "oslash" => 'ø',
    "Oslash" => 'Ø',
    "aring" => 'å',
    "Aring" => 'Å',
    "eacute" => 'é',
    "Eacute" => 'É',
    "egrave" => 'è',
    "Egrave" => 'È',
    "ecirc" => 'ê',
    "euml" => 'ë',
    "agrave" => 'à',
    "aacute" => 'á',
    "acirc" => 'â',
    "auml" => 'ä',
    "Auml" => 'Ä',
    "ouml" => 'ö',
    "Ouml" => 'Ö',
    "ocirc" => 'ô',
    "oacute" => 'ó',
    "ograve" => 'ò',
    "uuml" => 'ü',
    "Uuml" => 'Ü',
    "uacute" => 'ú',
    "ugrave" => 'ù',
    "iacute" => 'í',
    "igrave" => 'ì',
    "ntilde" => 'ñ',
    "ccedil" => 'ç',
    "szlig" => 'ß',
    "ndash" => '–',
    "mdash" => '—',
    "hellip" => '…',
    "lsquo" => '‘',
    "rsquo" => '’',
    "ldquo" => '“',
    "rdquo" => '”',
    "laquo" => '«',
    "raquo" => '»',
    "bull" => '•',
    "middot" => '·',
    "copy" => '©',
    "reg" => '®',
    "trade" => '™',
    "euro" => '€',
    "pound" => '£',
    "deg" => '°',
    "times" => '×',
    _ => return None,
  };
  Some(ch.to_string())
}

fn find_from(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
  if from >= haystack.len() || needle.is_empty() {
    return None;
  }
  haystack[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

fn utf8_len(first: u8) -> usize {
  if first < 0x80 {
    1
  } else if first >> 5 == 0b110 {
    2
  } else if first >> 4 == 0b1110 {
    3
  } else {
    4
  }
}

pub(super) fn squash(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}
