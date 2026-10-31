//! The schema change and the repairs that run once when the store opens.

use super::*;
use super::text::{snippet_of, squash};
use super::write::index_message;

pub fn migrate(conn: &Connection) -> DbResult<()> {
  conn.execute_batch(SCHEMA)?;
  conn.execute_batch(
    "DROP INDEX IF EXISTS messages_uid_idx;
     CREATE UNIQUE INDEX IF NOT EXISTS messages_folder_uid_idx ON messages (account_email, folder, uid);",
  )?;
  repair_snippets(conn)?;
  repair_attachment_flags(conn)?;
  repair_quoted_addresses(conn)?;
  refetch_misread_bodies(conn)?;
  refetch_invites_without_text(conn)?;
  Ok(())
}

/// Bodies that list a calendar invite without its text are fetched again,
/// once, so the invite card draws at once for mail kept before the text
/// was kept with the body (2026-10-19). A few messages: the ones with an
/// invite whose body the copy holds.
pub(super) fn refetch_invites_without_text(conn: &Connection) -> DbResult<()> {
  const MARK: &str = "repair.invite-text";
  const VERSION: &str = "1";
  let done: Option<String> = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [MARK], |r| r.get(0))
    .optional()?;
  if done.as_deref() == Some(VERSION) {
    return Ok(());
  }
  const NO_TEXT: &str = "attachments_json LIKE '%\"text/calendar\"%' AND attachments_json NOT LIKE '%\"text\":%'";
  let tx = conn.unchecked_transaction()?;
  tx.execute(
    &format!(
      "UPDATE messages SET body_state = 'none'
       WHERE (account_email, message_id) IN
         (SELECT account_email, message_id FROM message_bodies WHERE {NO_TEXT})"
    ),
    [],
  )?;
  tx.execute(&format!("DELETE FROM message_bodies WHERE {NO_TEXT}"), [])?;
  tx.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![MARK, VERSION, now_ms()],
  )?;
  tx.commit()?;
  Ok(())
}

/// Bodies read with the wrong charset are fetched again, once.
///
/// The decoder once knew only UTF-8 and the Latin-1 family, and read any
/// other charset as UTF-8, so every byte it could not place was kept as a
/// replacement mark. A kept body with such a mark in it is taken out and
/// its row marked as having no body, so the worker fetches it again with
/// the decoder of today; a row's snippet with a mark in it goes too, so
/// the fresh body gives it new words. Once per version, because a body
/// can hold a replacement mark that its sender really sent.
///
/// Version 2 runs it again for the decoder of 2026-10-17, which reads a
/// Latin letter inside UTF-8 mail ("f\xFCr"). Version 1 ran before that,
/// so such a body was fetched again, still misread, and kept: a tester's
/// journal mail showed "f\u{fffd}r" in the release with the fix.
pub(super) fn refetch_misread_bodies(conn: &Connection) -> DbResult<()> {
  const MARK: &str = "repair.charset-bodies";
  const VERSION: &str = "2";
  let done: Option<String> = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [MARK], |r| r.get(0))
    .optional()?;
  if done.as_deref() == Some(VERSION) {
    return Ok(());
  }
  const MISREAD: &str = "instr(COALESCE(text_body, '') || COALESCE(html_body, ''), char(65533)) > 0";
  let tx = conn.unchecked_transaction()?;
  tx.execute(
    &format!(
      "UPDATE messages SET body_state = 'none',
         snippet = CASE WHEN instr(snippet, char(65533)) > 0 THEN '' ELSE snippet END
       WHERE (account_email, message_id) IN
         (SELECT account_email, message_id FROM message_bodies WHERE {MISREAD})"
    ),
    [],
  )?;
  tx.execute(&format!("DELETE FROM message_bodies WHERE {MISREAD}"), [])?;
  tx.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![MARK, VERSION, now_ms()],
  )?;
  tx.commit()?;
  Ok(())
}

/// Addresses stored with the quotes some senders put round them, as in
/// `<'ann@x.test'>`, lose them, once. A reply to such a message was
/// refused by Gmail, and the address book had learned the quoted form.
pub(super) fn repair_quoted_addresses(conn: &Connection) -> DbResult<()> {
  const MARK: &str = "repair.quoted-addresses";
  const VERSION: &str = "1";
  let done: Option<String> = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [MARK], |r| r.get(0))
    .optional()?;
  if done.as_deref() == Some(VERSION) {
    return Ok(());
  }
  let clean_list = |json: &str| -> Option<String> {
    let mut list: Vec<Address> = serde_json::from_str(json).ok()?;
    let mut changed = false;
    for a in &mut list {
      let clean = crate::imap::clean_address(&a.email);
      if clean != a.email {
        a.email = clean;
        changed = true;
      }
    }
    if changed { serde_json::to_string(&list).ok() } else { None }
  };
  let mut stmt = conn.prepare(
    "SELECT account_email, message_id, from_email, to_json, cc_json, bcc_json FROM messages
      WHERE from_email GLOB '*[''\"]*' OR to_json GLOB '*\"''*' OR cc_json GLOB '*\"''*' OR bcc_json GLOB '*\"''*'",
  )?;
  let rows: Vec<(String, String, String, String, String, String)> = stmt
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
    .collect::<Result<_, _>>()?;
  drop(stmt);
  let now = now_ms();
  for (account, message_id, from, to, cc, bcc) in rows {
    let clean_from = crate::imap::clean_address(&from);
    let (new_to, new_cc, new_bcc) = (clean_list(&to), clean_list(&cc), clean_list(&bcc));
    if clean_from == from && new_to.is_none() && new_cc.is_none() && new_bcc.is_none() {
      continue;
    }
    conn.execute(
      "UPDATE messages SET from_email = ?3, to_json = ?4, cc_json = ?5, bcc_json = ?6, updated_at = ?7
        WHERE account_email = ?1 AND message_id = ?2",
      params![
        account,
        message_id,
        clean_from,
        new_to.unwrap_or(to),
        new_cc.unwrap_or(cc),
        new_bcc.unwrap_or(bcc),
        now
      ],
    )?;
  }
  // A contact learned in both forms keeps the clean one.
  let mut stmt = conn.prepare("SELECT source, account, email FROM source_contacts WHERE email GLOB '[''\"]*[''\"]'")?;
  let contacts: Vec<(String, String, String)> =
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
  drop(stmt);
  for (source, account, email) in contacts {
    let clean = crate::imap::clean_address(&email);
    if clean == email {
      continue;
    }
    conn.execute(
      "UPDATE OR IGNORE source_contacts SET email = ?4 WHERE source = ?1 AND account = ?2 AND email = ?3",
      params![source, account, email, clean],
    )?;
    conn.execute(
      "DELETE FROM source_contacts WHERE source = ?1 AND account = ?2 AND email = ?3",
      params![source, account, email],
    )?;
  }
  conn.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![MARK, VERSION, now_ms()],
  )?;
  Ok(())
}

/// Rows with a kept body take their attachment flag from the body's
/// list of files, once. The flag was a guess from the outer MIME type,
/// and has:attachment found every newsletter with a picture in it.
fn repair_attachment_flags(conn: &Connection) -> DbResult<()> {
  const MARK: &str = "repair.attachments";
  const VERSION: &str = "1";
  let done: Option<String> = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [MARK], |r| r.get(0))
    .optional()?;
  if done.as_deref() == Some(VERSION) {
    return Ok(());
  }
  conn.execute(
    "UPDATE messages SET has_attachments = (b.attachments_json <> '[]')
       FROM message_bodies b
      WHERE b.account_email = messages.account_email AND b.message_id = messages.message_id
        AND has_attachments <> (b.attachments_json <> '[]')",
    [],
  )?;
  conn.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![MARK, VERSION, now_ms()],
  )?;
  Ok(())
}

/// Kept bodies whose words were read by an older stripper are read
/// again, and the rows they belong to take a fresh snippet.
///
/// The stripper once kept what was inside a comment, so the search text
/// of every HTML mail with an Outlook block began with "96", and so did
/// the snippet made from it. Every kept body is stripped again with the
/// stripper of today, its search text and index rewritten; then any row
/// whose snippet is short, or begins with a bare number, takes the
/// body's first words. Done once per stripper version, which the
/// settings table remembers.
fn repair_snippets(conn: &Connection) -> DbResult<()> {
  const MARK: &str = "repair.snippets";
  // 3: entities decoded. A row's line that held one takes fresh words.
  // 4: the same for a row with no stored body, whose line came from the
  //    server at list time and has nothing to be made again from.
  // 5: tags a sender left in a plain part are out. A row's line that holds
  //    one takes fresh words, or has the tags taken out in place.
  // 6: a Latin part of a multipart mail was read twice, and "på" showed
  //    as "pï¿½". A row's line that holds that takes fresh words. A row
  //    with no stored body takes them when its body is kept.
  // 7: a whole HTML page sent as the plain part showed its <!DOCTYPE …>.
  //    A row's line that begins with a page takes fresh words.
  const VERSION: &str = "7";
  let done: Option<String> = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [MARK], |r| r.get(0))
    .optional()?;
  if done.as_deref() == Some(VERSION) {
    return Ok(());
  }
  let mut stmt = conn.prepare(
    "SELECT b.account_email, b.message_id, b.text_body, b.html_body FROM message_bodies b",
  )?;
  let rows: Vec<(String, String, Option<String>, Option<String>)> = stmt
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
    .collect::<Result<_, _>>()?;
  drop(stmt);
  let now = now_ms();
  for (account, message_id, text, html) in rows {
    let search_text = match (&text, &html) {
      (Some(text), _) if !text.trim().is_empty() && !starts_with_bare_number(text) && !is_html_page(text) => {
        squash(&plain_words(text))
      }
      (_, Some(html)) => squash(&strip_html(html)),
      (Some(text), None) => squash(&plain_words(text)),
      _ => String::new(),
    };
    conn.execute(
      "UPDATE message_bodies SET search_text = ?3 WHERE account_email = ?1 AND message_id = ?2",
      params![account, message_id, search_text],
    )?;
    let snippet = snippet_of(&search_text);
    if !snippet.is_empty() {
      conn.execute(
        "UPDATE messages SET snippet = ?3, updated_at = ?4 WHERE account_email = ?1 AND message_id = ?2
           AND (length(snippet) < 40 OR snippet GLOB '[0-9]*' OR snippet GLOB '*&*;*'
             OR snippet GLOB '*<[a-zA-Z/]*>*' OR snippet GLOB '*ï¿½*' OR snippet GLOB '<!*')",
        params![account, message_id, snippet, now],
      )?;
    }
    index_message(conn, &account, &message_id)?;
  }
  // A line that still holds an entity belongs to a row with no stored
  // body: the words came from the server at list time. Decoded in place.
  let mut stmt = conn.prepare(
    "SELECT account_email, message_id, snippet FROM messages
     WHERE snippet GLOB '*&*;*' OR snippet GLOB '*<[a-zA-Z/]*>*'",
  )?;
  let held: Vec<(String, String, String)> = stmt
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
    .collect::<Result<_, _>>()?;
  drop(stmt);
  for (account, message_id, snippet) in held {
    let decoded = squash(&decode_entities(&strip_stray_tags(&snippet)));
    if decoded != snippet {
      conn.execute(
        "UPDATE messages SET snippet = ?3, updated_at = ?4 WHERE account_email = ?1 AND message_id = ?2",
        params![account, message_id, decoded, now],
      )?;
    }
  }
  conn.execute(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![MARK, VERSION, now],
  )?;
  Ok(())
}

/// "96 Hej Ulrik…": the words of a text that begins with a number on
/// its own, which is what the old stripper left of the Outlook block.
fn starts_with_bare_number(text: &str) -> bool {
  text
    .split_whitespace()
    .next()
    .map(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_digit()))
    .unwrap_or(false)
}
