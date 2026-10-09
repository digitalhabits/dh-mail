//! A little XML for the requests written by hand: the ones the `ews` crate
//! 0.1.1 has no types for (auto-reply, the address book) or writes wrong
//! (the flag, in ews_write.rs).
//!
//! The requests put the messages namespace on the operation as the default,
//! and each type element takes the `t:` prefix. An element with no prefix
//! under the operation is in the messages namespace, and the server's
//! schema refuses a type element there.

pub const TYPES_NS: &str = "http://schemas.microsoft.com/exchange/services/2006/types";
pub const MESSAGES_NS: &str = "http://schemas.microsoft.com/exchange/services/2006/messages";

/// A whole request: the declaration, the version header, and `operation`.
pub fn envelope(operation: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="{t}">"#,
      r#"<soap:Header><t:RequestServerVersion Version="{version}"/></soap:Header>"#,
      r#"<soap:Body>{operation}</soap:Body></soap:Envelope>"#
    ),
    t = TYPES_NS,
    version = crate::ews::REQUEST_SERVER_VERSION,
    operation = operation
  )
}

/// A value for XML text or an attribute in double quotes.
pub fn escape(value: &str) -> String {
  value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Where the first element with this local name is, any prefix: the start
/// and the end of its content, and the end of the element. An element that
/// closes itself has no content.
fn locate(xml: &str, local: &str) -> Option<(usize, usize, usize)> {
  let mut from = 0;
  while let Some(open) = xml[from..].find('<').map(|i| i + from) {
    let tag_end = xml[open..].find('>').map(|i| i + open)?;
    let tag = &xml[open + 1..tag_end];
    from = tag_end + 1;
    let name = tag.split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
    if tag.starts_with(['/', '?', '!']) || name.rsplit(':').next() != Some(local) {
      continue;
    }
    if tag.ends_with('/') {
      return Some((from, from, from));
    }
    let close_tag = format!("</{name}>");
    let close = xml[from..].find(&close_tag)? + from;
    return Some((from, close, close + close_tag.len()));
  }
  None
}

/// The XML between the opening and the closing tag of the first element
/// with this local name, any prefix. None when there is none. An element
/// that closes itself gives "".
pub fn inner<'a>(xml: &'a str, local: &str) -> Option<&'a str> {
  locate(xml, local).map(|(start, end, _)| &xml[start..end])
}

/// The inner XML of each element with this local name, in order. An
/// element inside another of the same name is not looked for.
pub fn all_inner<'a>(xml: &'a str, local: &str) -> Vec<&'a str> {
  let mut out = Vec::new();
  let mut rest = xml;
  while let Some((start, end, after)) = locate(rest, local) {
    out.push(&rest[start..end]);
    rest = &rest[after..];
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn inner_finds_an_element_by_its_local_name() {
    let xml = r#"<a:Outer x="1"><b:In>one</b:In><b:In>two</b:In><c:Empty/></a:Outer>"#;
    assert_eq!(inner(xml, "In"), Some("one"));
    assert_eq!(inner(xml, "Outer"), Some(r#"<b:In>one</b:In><b:In>two</b:In><c:Empty/>"#));
    assert_eq!(inner(xml, "Empty"), Some(""));
    assert_eq!(inner(xml, "None"), None);
    // A name that only starts the same is another element.
    assert_eq!(inner("<t:Inner>x</t:Inner>", "In"), None);
  }

  #[test]
  fn all_inner_finds_each_element() {
    let xml = r#"<t:R><t:N>a</t:N></t:R><t:R><t:N>b</t:N></t:R><t:R/><t:R>c</t:R>"#;
    assert_eq!(all_inner(xml, "R"), vec!["<t:N>a</t:N>", "<t:N>b</t:N>", "", "c"]);
    assert!(all_inner(xml, "X").is_empty());
  }

  #[test]
  fn escape_makes_text_safe() {
    assert_eq!(escape(r#"<p>"A & B"</p>"#), "&lt;p&gt;&quot;A &amp; B&quot;&lt;/p&gt;");
  }
}
