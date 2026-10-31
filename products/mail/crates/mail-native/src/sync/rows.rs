//! A fetched message as a row, with its labels.

use super::*;

pub(super) fn fetch_items() -> String {
  format!(
    "UID FLAGS X-GM-MSGID X-GM-THRID X-GM-LABELS MODSEQ RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})] BODY.PEEK[TEXT]<0.{SNIPPET_BYTES}>"
  )
}

/// A fetched message as a row. None when Gmail's ids are missing, which
/// means the reply was not a message.
pub(crate) fn row_from(f: &Fetched, folder: &SyncFolder) -> Option<MessageRow> {
  let uid = f.uid()?;
  let msgid = f.get("X-GM-MSGID").and_then(Item::as_u64)?;
  let thrid = f.get("X-GM-THRID").and_then(Item::as_u64).unwrap_or(msgid);
  let flags = f.flags();
  let mut labels = labels_from(f, &flags);
  if let Some(l) = folder.inject {
    if !labels.iter().any(|x| x == l) {
      labels.push(l.into());
    }
  }
  let header_block = f.body_section("BODY[HEADER").and_then(Item::as_bytes).unwrap_or_default();
  let headers = imap::parse_headers(&header_block);
  let from = imap::header(&headers, "from").map(imap::parse_address_list).unwrap_or_default();
  let addresses = |name: &str| -> Vec<Address> {
    imap::header(&headers, name)
      .map(imap::parse_address_list)
      .unwrap_or_default()
      .into_iter()
      .map(|m| Address { name: m.name, email: m.email })
      .collect()
  };
  let content_type = imap::header(&headers, "content-type").unwrap_or("text/plain").to_string();
  let cte = imap::header(&headers, "content-transfer-encoding").unwrap_or("7bit").to_string();
  let text = f.body_section("BODY[TEXT]").and_then(Item::as_bytes).unwrap_or_default();
  let snippet = imap::snippet_from_body(&text, &content_type, &cte, SNIPPET_CHARS);
  let sent_at = f
    .get("INTERNALDATE")
    .and_then(Item::as_str)
    .and_then(|s| imap::parse_internal_date(&s))
    .unwrap_or_else(crate::db::now_ms);
  let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
  Some(MessageRow {
    message_id: format!("{msgid:x}"),
    thread_id: format!("{thrid:x}"),
    folder: folder.logical.clone(),
    uid: Some(uid as i64),
    modseq: f.get("MODSEQ").and_then(Item::as_u64).map(|m| m as i64),
    rfc_message_id: imap::header(&headers, "message-id").map(str::to_string),
    in_reply_to: imap::header(&headers, "in-reply-to").map(str::to_string),
    references: imap::header(&headers, "references").map(str::to_string),
    from_name: from.first().map(|m| m.name.clone()).unwrap_or_default(),
    from_email: from.first().map(|m| m.email.clone()).unwrap_or_default(),
    to: addresses("to"),
    cc: addresses("cc"),
    bcc: addresses("bcc"),
    subject: imap::header(&headers, "subject").map(imap::decode_encoded_words).unwrap_or_default(),
    snippet,
    sent_at,
    size_estimate: f.get("RFC822.SIZE").and_then(Item::as_u64).map(|n| n as i64),
    has_attachments: mime == "multipart/mixed",
    unread: !flags.iter().any(|x| x.eq_ignore_ascii_case("\\Seen")),
    starred: flags.iter().any(|x| x.eq_ignore_ascii_case("\\Flagged")),
    is_draft: flags.iter().any(|x| x.eq_ignore_ascii_case("\\Draft")),
    labels,
  })
}

/// Gmail's labels as the store names them. System labels map to the
/// constants; the rest keep their name, decoded from modified UTF-7.
pub fn labels_from(f: &Fetched, flags: &[String]) -> Vec<String> {
  let mut out: Vec<String> = f
    .get("X-GM-LABELS")
    .map(|l| l.as_list().iter().filter_map(Item::as_str).collect::<Vec<_>>())
    .unwrap_or_default()
    .iter()
    .filter_map(|raw| map_label(raw))
    .collect();
  if flags.iter().any(|x| x.eq_ignore_ascii_case("\\Flagged")) && !out.iter().any(|l| l == STARRED) {
    out.push(STARRED.into());
  }
  if flags.iter().any(|x| x.eq_ignore_ascii_case("\\Draft")) && !out.iter().any(|l| l == DRAFT) {
    out.push(DRAFT.into());
  }
  out
}

pub fn map_label(raw: &str) -> Option<String> {
  let lower = raw.to_ascii_lowercase();
  Some(match lower.as_str() {
    "\\inbox" => INBOX.into(),
    "\\sent" => SENT.into(),
    "\\starred" => STARRED.into(),
    "\\important" => IMPORTANT.into(),
    "\\draft" | "\\drafts" => DRAFT.into(),
    "\\trash" => TRASH.into(),
    "\\spam" | "\\junk" => SPAM.into(),
    "\\all" | "\\muted" => return None,
    _ => imap::decode_modified_utf7(raw),
  })
}
