//! Writing to the local copy: the sync worker's side.

use super::*;
use super::read::load_threads;
use super::text::{snippet_of, squash};

// ---------------------------------------------------------------------------
// Writing: the sync worker's side
// ---------------------------------------------------------------------------

impl MailDb {
  /// Write or refresh these messages. Bodies and their state are untouched.
  pub fn messages_upsert(&self, account: &str, rows: &[MessageRow]) -> DbResult<usize> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    for row in rows {
      upsert_one(&tx, account, row)?;
    }
    tx.commit()?;
    Ok(rows.len())
  }

  /// Flags and labels changed on the server, found by UID.
  pub fn messages_set_flags(
    &self,
    account: &str,
    folder: &str,
    uid: i64,
    unread: Option<bool>,
    starred: Option<bool>,
    labels: Option<&[String]>,
    modseq: Option<i64>,
  ) -> DbResult<bool> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let found: Option<String> = tx
      .query_row(
        "SELECT message_id FROM messages WHERE account_email = ?1 AND folder = ?3 AND uid = ?2",
        params![account, uid, folder],
        |r| r.get(0),
      )
      .optional()?;
    let Some(message_id) = found else {
      return Ok(false);
    };
    if let Some(unread) = unread {
      tx.execute(
        "UPDATE messages SET unread = ?3, updated_at = ?4 WHERE account_email = ?1 AND message_id = ?2",
        params![account, message_id, unread as i64, now_ms()],
      )?;
    }
    if let Some(starred) = starred {
      tx.execute(
        "UPDATE messages SET starred = ?3, updated_at = ?4 WHERE account_email = ?1 AND message_id = ?2",
        params![account, message_id, starred as i64, now_ms()],
      )?;
    }
    if let Some(modseq) = modseq {
      tx.execute(
        "UPDATE messages SET modseq = ?3 WHERE account_email = ?1 AND message_id = ?2",
        params![account, message_id, modseq],
      )?;
    }
    if let Some(labels) = labels {
      replace_labels(&tx, account, &message_id, labels)?;
    }
    tx.commit()?;
    Ok(true)
  }

  /// Messages the server no longer has, by UID. Bodies go with them.
  pub fn messages_delete_uids(&self, account: &str, folder: &str, uids: &[i64]) -> DbResult<usize> {
    if uids.is_empty() {
      return Ok(0);
    }
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let mut removed = 0;
    for uid in uids {
      let found: Option<(i64, String)> = tx
        .query_row(
          "SELECT rowid, message_id FROM messages WHERE account_email = ?1 AND folder = ?3 AND uid = ?2",
          params![account, uid, folder],
          |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
      if let Some((rowid, message_id)) = found {
        delete_one(&tx, account, rowid, &message_id)?;
        removed += 1;
      }
    }
    tx.commit()?;
    Ok(removed)
  }

  /// Every row of one folder of a mailbox, gone, bodies kept: the server
  /// rebuilt the folder and its UIDs mean nothing now.
  pub fn messages_clear_folder(&self, account: &str, folder: &str) -> DbResult<()> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let rows: Vec<(i64, String)> = {
      let mut stmt = tx.prepare("SELECT rowid, message_id FROM messages WHERE account_email = ?1 AND folder = ?2")?;
      let rows = stmt.query_map(params![account, folder], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
      rows
    };
    for (rowid, id) in rows {
      tx.execute("DELETE FROM messages_fts WHERE rowid = ?1", params![rowid])?;
      tx.execute("DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2", params![account, id])?;
      tx.execute("DELETE FROM messages WHERE account_email = ?1 AND message_id = ?2", params![account, id])?;
    }
    tx.commit()?;
    Ok(())
  }

  /// One folder of a mailbox, to be read again from nothing: its rows go and
  /// its sync state forgets how far it had read. For a folder the copy no
  /// longer agrees with, such as Trash after a refused "delete forever".
  pub fn messages_restart_folder(&self, account: &str, folder: &str) -> DbResult<()> {
    self.messages_clear_folder(account, folder)?;
    if let Some(mut state) = self.sync_state_get(account, folder)? {
      state.phase = "expired".into();
      state.highest_uid = None;
      state.highest_modseq = None;
      state.full_sync_cursor = None;
      state.full_sync_done = None;
      state.full_sync_total = None;
      self.sync_state_set(&state)?;
    }
    Ok(())
  }

  /// Every message of a mailbox, gone. Bodies stay only when asked, matched
  /// back by RFC id after a resync.
  pub fn messages_clear_account(&self, account: &str, keep_bodies: bool) -> DbResult<()> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let rowids: Vec<i64> = {
      let mut stmt = tx.prepare("SELECT rowid FROM messages WHERE account_email = ?1")?;
      let rows = stmt.query_map(params![account], |r| r.get::<_, i64>(0))?;
      rows.collect::<Result<Vec<_>, _>>()?
    };
    for rowid in rowids {
      tx.execute("DELETE FROM messages_fts WHERE rowid = ?1", params![rowid])?;
    }
    tx.execute("DELETE FROM message_labels WHERE account_email = ?1", params![account])?;
    tx.execute("DELETE FROM messages WHERE account_email = ?1", params![account])?;
    if !keep_bodies {
      tx.execute("DELETE FROM message_bodies WHERE account_email = ?1", params![account])?;
      // A removed mailbox has no sync to speak of either.
      tx.execute("DELETE FROM sync_state WHERE account_email = ?1", params![account])?;
    }
    tx.commit()?;
    Ok(())
  }

  /// The UID and folder of each of these messages, for fetching by section.
  pub fn messages_uids_for(&self, account: &str, message_ids: &[String]) -> DbResult<Vec<(String, i64, String)>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT uid, folder FROM messages WHERE account_email = ?1 AND message_id = ?2 AND uid IS NOT NULL",
    )?;
    let mut out = Vec::new();
    for id in message_ids {
      if let Some((uid, folder)) = stmt
        .query_row(params![account, id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .optional()?
      {
        out.push((id.clone(), uid, folder));
      }
    }
    Ok(out)
  }

  /// The threads of the stored messages with these UIDs in `folder`, newest
  /// first, each marked with its newest matched message. A UID the copy
  /// does not hold is left out: the server's answer is mapped onto rows
  /// the copy already has, so it shows with no message read again.
  pub fn messages_threads_for_uids(
    &self,
    account: &str,
    folder: &str,
    uids: &[u32],
    limit: usize,
  ) -> DbResult<Vec<ThreadRow>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT thread_id, message_id, sent_at FROM messages
        WHERE account_email = ?1 AND folder = ?2 AND uid = ?3",
    )?;
    // Per thread, its newest hit.
    let mut best: HashMap<String, (i64, String)> = HashMap::new();
    for uid in uids {
      let hit = stmt
        .query_row(params![account, folder, *uid as i64], |r| {
          Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .optional()?;
      let Some((thread_id, message_id, sent_at)) = hit else { continue };
      let entry = best.entry(thread_id).or_insert((i64::MIN, String::new()));
      if sent_at > entry.0 {
        *entry = (sent_at, message_id);
      }
    }
    let ids: Vec<String> = best.keys().cloned().collect();
    let mut out: Vec<ThreadRow> = Vec::new();
    for chunk in ids.chunks(400) {
      out.extend(load_threads(&conn, account, chunk, &View::All, None)?);
    }
    for row in out.iter_mut() {
      row.focus_message_id = best.get(&row.thread_id).map(|(_, id)| id.clone());
    }
    out.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    out.truncate(limit);
    Ok(out)
  }

  /// Messages in All Mail sent since `since` (ms) that have no body yet,
  /// newest first, skipping anything larger than `max_size` bytes. For the
  /// worker's background fetch, so search reads whole messages and a
  /// thread opens without a round trip.
  pub fn messages_bodies_missing(
    &self,
    account: &str,
    since: i64,
    max_size: i64,
    limit: usize,
  ) -> DbResult<Vec<(String, i64)>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT message_id, uid FROM messages
       WHERE account_email = ?1 AND folder = '' AND uid IS NOT NULL
         AND body_state = 'none' AND sent_at >= ?2
         AND COALESCE(size_estimate, 0) <= ?3
         AND NOT EXISTS (SELECT 1 FROM message_bodies b
                         WHERE b.account_email = messages.account_email
                           AND b.message_id = messages.message_id)
       ORDER BY sent_at DESC LIMIT ?4",
    )?;
    let rows = stmt.query_map(params![account, since, max_size, limit as i64], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  /// Give up on a body: the server did not hand it over, and asking again
  /// every pass would be asking forever.
  pub fn messages_body_skipped(&self, account: &str, message_id: &str) -> DbResult<()> {
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE messages SET body_state = 'skipped' WHERE account_email = ?1 AND message_id = ?2 AND body_state = 'none'",
      params![account, message_id],
    )?;
    Ok(())
  }

  /// The UIDs the copy holds in a folder, for finding what the server dropped.
  pub fn messages_known_uids(&self, account: &str, folder: &str) -> DbResult<Vec<i64>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT uid FROM messages WHERE account_email = ?1 AND folder = ?2 AND uid IS NOT NULL ORDER BY uid",
    )?;
    let rows = stmt.query_map(params![account, folder], |r| r.get::<_, i64>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
  }

  /// How many messages with a UID the copy holds in a folder.
  pub fn messages_count_known(&self, account: &str, folder: &str) -> DbResult<i64> {
    let conn = self.conn_mut();
    Ok(conn.query_row(
      "SELECT COUNT(*) FROM messages WHERE account_email = ?1 AND folder = ?2 AND uid IS NOT NULL",
      params![account, folder],
      |r| r.get(0),
    )?)
  }

  /// The highest UID and modseq the copy holds in a folder, for the next live pass.
  pub fn messages_high_water(&self, account: &str, folder: &str) -> DbResult<(Option<i64>, Option<i64>)> {
    let conn = self.conn_mut();
    let row: (Option<i64>, Option<i64>) = conn.query_row(
      "SELECT MAX(uid), MAX(modseq) FROM messages WHERE account_email = ?1 AND folder = ?2",
      params![account, folder],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(row)
  }

  /// Keep a fetched body. The message's search text takes it in.
  pub fn bodies_put(&self, account: &str, message_id: &str, body: &BodyRow) -> DbResult<()> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    put_body(&tx, account, message_id, body)?;
    tx.commit()?;
    Ok(())
  }

  pub fn sync_state_get(&self, account: &str, folder: &str) -> DbResult<Option<SyncState>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!("{SYNC_SELECT} WHERE account_email = ?1 AND folder = ?2"))?;
    let row = stmt
      .query_row(params![account, folder], read_sync_state)
      .optional()?;
    Ok(row)
  }

  pub fn sync_state_set(&self, state: &SyncState) -> DbResult<()> {
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO sync_state (account_email, folder, phase, uid_validity, highest_uid,
         highest_modseq, delta_link, full_sync_cursor, full_sync_total, full_sync_done,
         last_ok_at, last_error, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(account_email, folder) DO UPDATE SET
         phase = excluded.phase, uid_validity = excluded.uid_validity,
         highest_uid = excluded.highest_uid, highest_modseq = excluded.highest_modseq,
         delta_link = excluded.delta_link, full_sync_cursor = excluded.full_sync_cursor,
         full_sync_total = excluded.full_sync_total, full_sync_done = excluded.full_sync_done,
         last_ok_at = excluded.last_ok_at, last_error = excluded.last_error,
         updated_at = excluded.updated_at",
      params![
        state.account,
        state.folder,
        state.phase,
        state.uid_validity,
        state.highest_uid,
        state.highest_modseq,
        state.delta_link,
        state.full_sync_cursor,
        state.full_sync_total,
        state.full_sync_done,
        state.last_ok_at,
        state.last_error,
        now_ms(),
      ],
    )?;
    Ok(())
  }

  pub fn sync_state_list(&self) -> DbResult<Vec<SyncState>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!("{SYNC_SELECT} ORDER BY account_email, folder"))?;
    let rows = stmt.query_map([], read_sync_state)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
  }
}

const SYNC_SELECT: &str = "SELECT account_email, folder, phase, uid_validity, highest_uid, highest_modseq,
  delta_link, full_sync_cursor, full_sync_total, full_sync_done, last_ok_at, last_error FROM sync_state";

fn read_sync_state(r: &rusqlite::Row<'_>) -> rusqlite::Result<SyncState> {
  Ok(SyncState {
    account: r.get(0)?,
    folder: r.get(1)?,
    phase: r.get(2)?,
    uid_validity: r.get(3)?,
    highest_uid: r.get(4)?,
    highest_modseq: r.get(5)?,
    delta_link: r.get(6)?,
    full_sync_cursor: r.get(7)?,
    full_sync_total: r.get(8)?,
    full_sync_done: r.get(9)?,
    last_ok_at: r.get(10)?,
    last_error: r.get(11)?,
  })
}

pub(crate) fn upsert_one(tx: &Connection, account: &str, row: &MessageRow) -> DbResult<()> {
  tx.execute(
    "INSERT INTO messages (account_email, message_id, thread_id, uid, modseq, rfc_message_id,
       in_reply_to, ref_headers, from_name, from_email, to_json, cc_json, bcc_json, subject,
       snippet, sent_at, size_estimate, has_attachments, unread, starred, is_draft, updated_at, folder)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
     ON CONFLICT(account_email, message_id) DO UPDATE SET
       thread_id = excluded.thread_id,
       folder = excluded.folder,
       uid = COALESCE(excluded.uid, messages.uid),
       modseq = COALESCE(excluded.modseq, messages.modseq),
       rfc_message_id = COALESCE(excluded.rfc_message_id, messages.rfc_message_id),
       in_reply_to = COALESCE(excluded.in_reply_to, messages.in_reply_to),
       ref_headers = COALESCE(excluded.ref_headers, messages.ref_headers),
       from_name = excluded.from_name, from_email = excluded.from_email,
       to_json = excluded.to_json, cc_json = excluded.cc_json, bcc_json = excluded.bcc_json,
       subject = excluded.subject, snippet = excluded.snippet, sent_at = excluded.sent_at,
       size_estimate = COALESCE(excluded.size_estimate, messages.size_estimate),
       has_attachments = excluded.has_attachments, unread = excluded.unread,
       starred = excluded.starred, is_draft = excluded.is_draft, updated_at = excluded.updated_at",
    params![
      account,
      row.message_id,
      row.thread_id,
      row.uid,
      row.modseq,
      row.rfc_message_id,
      row.in_reply_to,
      row.references,
      row.from_name,
      row.from_email,
      serde_json::to_string(&row.to)?,
      serde_json::to_string(&row.cc)?,
      serde_json::to_string(&row.bcc)?,
      row.subject,
      // Every source of a row's line comes through here: IMAP, Gmail, Graph.
      if is_html_page(&row.snippet) { squash(&strip_html(&row.snippet)) } else { strip_stray_tags(&row.snippet) },
      row.sent_at,
      row.size_estimate,
      row.has_attachments as i64,
      row.unread as i64,
      row.starred as i64,
      row.is_draft as i64,
      now_ms(),
      row.folder,
    ],
  )?;
  replace_labels(tx, account, &row.message_id, &row.labels)?;
  index_message(tx, account, &row.message_id)?;
  Ok(())
}

fn replace_labels(tx: &Connection, account: &str, message_id: &str, labels: &[String]) -> DbResult<()> {
  tx.execute(
    "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2",
    params![account, message_id],
  )?;
  let mut seen = HashSet::new();
  for label in labels {
    let label = label.trim();
    if label.is_empty() || !seen.insert(label.to_string()) {
      continue;
    }
    tx.execute(
      "INSERT OR IGNORE INTO message_labels (account_email, message_id, label) VALUES (?1, ?2, ?3)",
      params![account, message_id, label],
    )?;
  }
  Ok(())
}

/// Write the message's search row from what the tables hold now.
pub(super) fn index_message(tx: &Connection, account: &str, message_id: &str) -> DbResult<()> {
  let found: Option<(i64, String, String, String, String, String, String)> = tx
    .query_row(
      "SELECT m.rowid, m.subject, m.from_name, m.from_email, m.to_json, m.cc_json, m.snippet
         FROM messages m WHERE m.account_email = ?1 AND m.message_id = ?2",
      params![account, message_id],
      |r| {
        Ok((
          r.get(0)?,
          r.get(1)?,
          r.get(2)?,
          r.get(3)?,
          r.get(4)?,
          r.get(5)?,
          r.get(6)?,
        ))
      },
    )
    .optional()?;
  let Some((rowid, subject, from_name, from_email, to_json, cc_json, snippet)) = found else {
    return Ok(());
  };
  let body: String = tx
    .query_row(
      "SELECT search_text FROM message_bodies WHERE account_email = ?1 AND message_id = ?2",
      params![account, message_id],
      |r| r.get(0),
    )
    .optional()?
    .unwrap_or_default();
  let to_text = address_text(&to_json) + " " + &address_text(&cc_json);
  tx.execute("DELETE FROM messages_fts WHERE rowid = ?1", params![rowid])?;
  tx.execute(
    "INSERT INTO messages_fts (rowid, subject, from_text, to_text, snippet, body)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![rowid, subject, format!("{from_name} {from_email}"), to_text, snippet, body],
  )?;
  Ok(())
}

fn address_text(json_list: &str) -> String {
  let list: Vec<Address> = serde_json::from_str(json_list).unwrap_or_default();
  list
    .iter()
    .map(|a| format!("{} {}", a.name, a.email))
    .collect::<Vec<_>>()
    .join(" ")
}

pub(crate) fn delete_one(tx: &Connection, account: &str, rowid: i64, message_id: &str) -> DbResult<()> {
  tx.execute("DELETE FROM messages_fts WHERE rowid = ?1", params![rowid])?;
  tx.execute(
    "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2",
    params![account, message_id],
  )?;
  tx.execute(
    "DELETE FROM message_bodies WHERE account_email = ?1 AND message_id = ?2",
    params![account, message_id],
  )?;
  tx.execute(
    "DELETE FROM messages WHERE account_email = ?1 AND message_id = ?2",
    params![account, message_id],
  )?;
  Ok(())
}

fn put_body(tx: &Connection, account: &str, message_id: &str, body: &BodyRow) -> DbResult<()> {
  let search_text = match (&body.text, &body.html) {
    (Some(text), _) if !text.trim().is_empty() && !is_html_page(text) => squash(&plain_words(text)),
    (_, Some(html)) => squash(&strip_html(html)),
    (Some(text), None) => squash(&plain_words(text)),
    _ => String::new(),
  };
  tx.execute(
    "INSERT INTO message_bodies (account_email, message_id, text_body, html_body,
       inline_images_json, attachments_json, search_text, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(account_email, message_id) DO UPDATE SET
       text_body = excluded.text_body, html_body = excluded.html_body,
       inline_images_json = excluded.inline_images_json,
       attachments_json = excluded.attachments_json,
       search_text = excluded.search_text, fetched_at = excluded.fetched_at",
    params![
      account,
      message_id,
      body.text,
      body.html,
      if body.inline_images.is_null() { "{}".to_string() } else { body.inline_images.to_string() },
      if body.attachments.is_null() { "[]".to_string() } else { body.attachments.to_string() },
      search_text,
      now_ms(),
    ],
  )?;
  tx.execute(
    "UPDATE messages SET body_state = 'fetched' WHERE account_email = ?1 AND message_id = ?2",
    params![account, message_id],
  )?;
  // The structure is known now, so the flag can say what is there. At
  // list time it was a guess from the outer type, and "multipart/mixed"
  // is also what a newsletter with a picture in it says.
  if let Some(files) = body.attachments.as_array() {
    tx.execute(
      "UPDATE messages SET has_attachments = ?3 WHERE account_email = ?1 AND message_id = ?2",
      params![account, message_id, !files.is_empty() as i64],
    )?;
  }
  /*
    The snippet, made better while the words are here.

    The one on the row came from the first two kilobytes of the message
    as it arrived, which for an HTML mail is mostly its head; it was
    often empty, and sometimes wrong. The body's own text is what the
    row should show. Only a short snippet is replaced, or one read in the
    wrong charset ("pï¿½" for "på"), so a row does not change under the
    reader for nothing.
  */
  let snippet = snippet_of(&search_text);
  if !snippet.is_empty() {
    tx.execute(
      "UPDATE messages SET snippet = ?3 WHERE account_email = ?1 AND message_id = ?2
         AND (length(snippet) < 40 OR snippet GLOB '*ï¿½*' OR snippet GLOB '<!*' OR snippet GLOB '<[hH][tT][mM][lL]*')",
      params![account, message_id, snippet],
    )?;
  }
  index_message(tx, account, message_id)?;
  Ok(())
}
