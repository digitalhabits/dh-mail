//! The local copy of the mail: every message's headers, and bodies once read.
//!
//! Until this table existed the app kept no message it had seen. Every list,
//! search, and open bought the same data from Gmail again, and Gmail charges
//! each call against a budget that ran out. This is the copy every desktop
//! client keeps, so that a list, a search, or an open costs nothing at the
//! moment the reader asks. The sync worker fills it; the interface reads it.
//! See docs/mail-local-store.md.
//!
//! Rows are keyed by mailbox and the provider's own message id. Labels are
//! rows of their own, one per label on a message, so a folder view is a
//! query. Bodies live apart from headers because they are large, immutable,
//! and fetched on demand. A contentless FTS5 index over subject, addresses,
//! snippet, and body text answers search.

use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::db::{now_ms, opt_str_arg, str_arg, str_list_arg, DbError, DbResult, MailDb};

/// System labels, as the sync worker writes them. Gmail's `\Inbox` and
/// Outlook's Inbox folder both land as `INBOX`, so a view is one query.
pub const INBOX: &str = "INBOX";
pub const SENT: &str = "SENT";
pub const DRAFT: &str = "DRAFT";
pub const TRASH: &str = "TRASH";
pub const SPAM: &str = "SPAM";
pub const STARRED: &str = "STARRED";
pub const IMPORTANT: &str = "IMPORTANT";

pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS messages (
    account_email   TEXT NOT NULL,
    message_id      TEXT NOT NULL,
    thread_id       TEXT NOT NULL,
    uid             INTEGER,
    modseq          INTEGER,
    rfc_message_id  TEXT,
    in_reply_to     TEXT,
    ref_headers     TEXT,
    from_name       TEXT NOT NULL DEFAULT '',
    from_email      TEXT NOT NULL DEFAULT '',
    to_json         TEXT NOT NULL DEFAULT '[]',
    cc_json         TEXT NOT NULL DEFAULT '[]',
    bcc_json        TEXT NOT NULL DEFAULT '[]',
    subject         TEXT NOT NULL DEFAULT '',
    snippet         TEXT NOT NULL DEFAULT '',
    sent_at         INTEGER NOT NULL,
    size_estimate   INTEGER,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    unread          INTEGER NOT NULL DEFAULT 0,
    starred         INTEGER NOT NULL DEFAULT 0,
    is_draft        INTEGER NOT NULL DEFAULT 0,
    body_state      TEXT NOT NULL DEFAULT 'none',
    folder          TEXT NOT NULL DEFAULT '',
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (account_email, message_id)
  );
  CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (account_email, thread_id, sent_at);
  CREATE INDEX IF NOT EXISTS messages_sent_idx ON messages (account_email, sent_at DESC);
  CREATE INDEX IF NOT EXISTS messages_rfc_idx ON messages (rfc_message_id);

  CREATE TABLE IF NOT EXISTS message_labels (
    account_email TEXT NOT NULL,
    message_id    TEXT NOT NULL,
    label         TEXT NOT NULL,
    PRIMARY KEY (account_email, message_id, label)
  );
  CREATE INDEX IF NOT EXISTS message_labels_label_idx ON message_labels (account_email, label, message_id);

  CREATE TABLE IF NOT EXISTS labels (
    account_email TEXT NOT NULL,
    label_id      TEXT NOT NULL,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'user',
    total         INTEGER,
    unread        INTEGER,
    PRIMARY KEY (account_email, label_id)
  );

  CREATE TABLE IF NOT EXISTS message_bodies (
    account_email      TEXT NOT NULL,
    message_id         TEXT NOT NULL,
    text_body          TEXT,
    html_body          TEXT,
    inline_images_json TEXT NOT NULL DEFAULT '{}',
    attachments_json   TEXT NOT NULL DEFAULT '[]',
    search_text        TEXT NOT NULL DEFAULT '',
    fetched_at         INTEGER NOT NULL,
    PRIMARY KEY (account_email, message_id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    account_email    TEXT NOT NULL,
    folder           TEXT NOT NULL DEFAULT '',
    phase            TEXT NOT NULL,
    uid_validity     INTEGER,
    highest_uid      INTEGER,
    highest_modseq   INTEGER,
    delta_link       TEXT,
    full_sync_cursor INTEGER,
    full_sync_total  INTEGER,
    full_sync_done   INTEGER,
    last_ok_at       INTEGER,
    last_error       TEXT,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (account_email, folder)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    subject, from_text, to_text, snippet, body,
    content='', contentless_delete=1,
    tokenize='unicode61 remove_diacritics 2'
  );
"#;

pub fn migrate(conn: &Connection) -> DbResult<()> {
  conn.execute_batch(SCHEMA)?;
  // UIDs are per folder. The copy began with All Mail alone and one UID
  // index; Trash and Junk have UIDs of their own, so the index carries
  // the folder now. SQLite has no "add if missing": the duplicate-column
  // error is the one to swallow.
  let _ = conn.execute("ALTER TABLE messages ADD COLUMN folder TEXT NOT NULL DEFAULT ''", []);
  conn.execute_batch(
    "DROP INDEX IF EXISTS messages_uid_idx;
     CREATE UNIQUE INDEX IF NOT EXISTS messages_folder_uid_idx ON messages (account_email, folder, uid);",
  )?;
  repair_snippets(conn)?;
  repair_attachment_flags(conn)?;
  repair_quoted_addresses(conn)?;
  Ok(())
}

/// Addresses stored with the quotes some senders put round them, as in
/// `<'ann@x.test'>`, lose them, once. A reply to such a message was
/// refused by Gmail, and the address book had learned the quoted form.
fn repair_quoted_addresses(conn: &Connection) -> DbResult<()> {
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Address {
  #[serde(default)]
  pub name: String,
  pub email: String,
}

/// One message as the sync worker writes it. Headers only.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
  pub message_id: String,
  pub thread_id: String,
  /// The folder the UID belongs to: "" for All Mail, else "trash" or "spam".
  #[serde(default)]
  pub folder: String,
  #[serde(default)]
  pub uid: Option<i64>,
  #[serde(default)]
  pub modseq: Option<i64>,
  #[serde(default)]
  pub rfc_message_id: Option<String>,
  #[serde(default)]
  pub in_reply_to: Option<String>,
  #[serde(default)]
  pub references: Option<String>,
  #[serde(default)]
  pub from_name: String,
  #[serde(default)]
  pub from_email: String,
  #[serde(default)]
  pub to: Vec<Address>,
  #[serde(default)]
  pub cc: Vec<Address>,
  #[serde(default)]
  pub bcc: Vec<Address>,
  #[serde(default)]
  pub subject: String,
  #[serde(default)]
  pub snippet: String,
  /// Milliseconds since the epoch.
  pub sent_at: i64,
  #[serde(default)]
  pub size_estimate: Option<i64>,
  #[serde(default)]
  pub has_attachments: bool,
  #[serde(default)]
  pub unread: bool,
  #[serde(default)]
  pub starred: bool,
  #[serde(default)]
  pub is_draft: bool,
  #[serde(default)]
  pub labels: Vec<String>,
}

/// A fetched body. Immutable once written.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyRow {
  #[serde(default)]
  pub text: Option<String>,
  #[serde(default)]
  pub html: Option<String>,
  #[serde(default)]
  pub inline_images: Value,
  #[serde(default)]
  pub attachments: Value,
}

/// Where a mailbox's sync has got to. One row per mailbox and folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
  pub account: String,
  #[serde(default)]
  pub folder: String,
  pub phase: String,
  #[serde(default)]
  pub uid_validity: Option<i64>,
  #[serde(default)]
  pub highest_uid: Option<i64>,
  #[serde(default)]
  pub highest_modseq: Option<i64>,
  #[serde(default)]
  pub delta_link: Option<String>,
  #[serde(default)]
  pub full_sync_cursor: Option<i64>,
  #[serde(default)]
  pub full_sync_total: Option<i64>,
  #[serde(default)]
  pub full_sync_done: Option<i64>,
  #[serde(default)]
  pub last_ok_at: Option<i64>,
  #[serde(default)]
  pub last_error: Option<String>,
}

/// A message as the interface reads it: the row with its labels.
#[derive(Debug, Clone)]
struct StoredMessage {
  row: MessageRow,
}

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

fn upsert_one(tx: &Connection, account: &str, row: &MessageRow) -> DbResult<()> {
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
      strip_stray_tags(&row.snippet),
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
fn index_message(tx: &Connection, account: &str, message_id: &str) -> DbResult<()> {
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

fn delete_one(tx: &Connection, account: &str, rowid: i64, message_id: &str) -> DbResult<()> {
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
    (Some(text), _) if !text.trim().is_empty() => squash(&decode_entities(&strip_stray_tags(text))),
    (_, Some(html)) => squash(&strip_html(html)),
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
    row should show. Only a short snippet is replaced, so a row does not
    change under the reader for nothing.
  */
  let snippet = snippet_of(&search_text);
  if !snippet.is_empty() {
    tx.execute(
      "UPDATE messages SET snippet = ?3 WHERE account_email = ?1 AND message_id = ?2 AND length(snippet) < 40",
      params![account, message_id, snippet],
    )?;
  }
  index_message(tx, account, message_id)?;
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
  const VERSION: &str = "5";
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
      (Some(text), _) if !text.trim().is_empty() && !starts_with_bare_number(text) => {
        squash(&decode_entities(&strip_stray_tags(text)))
      }
      (_, Some(html)) => squash(&strip_html(html)),
      (Some(text), None) => squash(&decode_entities(&strip_stray_tags(text))),
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
             OR snippet GLOB '*<[a-zA-Z/]*>*')",
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

/// The first words of a body's text, as a row shows them.
fn snippet_of(search_text: &str) -> String {
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

fn squash(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// Reading: the interface's side
// ---------------------------------------------------------------------------

/// A view of a mailbox, as the list asks for one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum View {
  Inbox,
  Sent,
  Drafts,
  Starred,
  Trash,
  Junk,
  Archived,
  All,
  Label(String),
}

impl View {
  pub fn parse(view: &str, label: Option<String>) -> DbResult<View> {
    Ok(match view {
      "inbox" => View::Inbox,
      "sent" => View::Sent,
      "drafts" => View::Drafts,
      "starred" => View::Starred,
      "trash" => View::Trash,
      "junk" | "spam" => View::Junk,
      "archived" => View::Archived,
      "all" => View::All,
      "label" => View::Label(
        label
          .filter(|l| !l.trim().is_empty())
          .ok_or_else(|| DbError::BadArgument("label view needs a label".into()))?,
      ),
      other => return Err(DbError::BadArgument(format!("unknown view {other}"))),
    })
  }

  /// The label a message must carry to belong to the view, if one does.
  fn member_label(&self) -> Option<String> {
    match self {
      View::Inbox => Some(INBOX.into()),
      View::Sent => Some(SENT.into()),
      View::Drafts => Some(DRAFT.into()),
      View::Starred => Some(STARRED.into()),
      View::Trash => Some(TRASH.into()),
      View::Junk => Some(SPAM.into()),
      View::Label(l) => Some(l.clone()),
      View::Archived | View::All => None,
    }
  }

  /// Trash and Junk are shown only when asked for by name.
  fn shows_hidden(&self) -> bool {
    matches!(self, View::Trash | View::Junk)
  }
}

/// A thread as the list draws it: its newest message and what the others add.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
  pub account: String,
  pub thread_id: String,
  pub subject: String,
  pub last_at: i64,
  pub message_count: i64,
  pub unread: bool,
  pub has_attachments: bool,
  pub starred: bool,
  pub is_draft: bool,
  pub labels: Vec<String>,
  pub latest: LatestMessage,
  pub participants: Vec<Address>,
  /** Who wrote each visible message, in order. */
  pub senders: Vec<Address>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub focus_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestMessage {
  pub message_id: String,
  pub from_name: String,
  pub from_email: String,
  pub to: Vec<Address>,
  pub snippet: String,
  pub sent_at: i64,
  pub unread: bool,
  pub rfc_message_id: Option<String>,
  pub in_reply_to: Option<String>,
  pub references: Option<String>,
}

const HIDDEN_LABELS: &str = "('TRASH','SPAM')";

impl MailDb {
  /// The threads of a view, newest first, from `before` (exclusive) down.
  pub fn messages_list(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let view = View::parse(
      &opt_str_arg(args, "view").unwrap_or_else(|| "inbox".into()),
      opt_str_arg(args, "label"),
    )?;
    let before = args.get("before").and_then(Value::as_i64).unwrap_or(i64::MAX);
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(50).clamp(1, 500);
    let conn = self.conn_mut();
    let mut rows: Vec<ThreadRow> = Vec::new();
    for account in &accounts {
      let candidates = candidate_threads(&conn, account, &view, before, limit)?;
      let ids: Vec<String> = candidates.iter().map(|(id, _)| id.clone()).collect();
      rows.extend(load_threads(&conn, account, &ids, &view)?);
    }
    rows.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    rows.truncate(limit as usize);
    let next_before = if rows.len() as i64 == limit {
      rows.last().map(|r| r.last_at)
    } else {
      None
    };
    Ok(json!({ "threads": rows, "nextBefore": next_before }))
  }

  /// How many threads a view holds, and how many of them are unread.
  pub fn messages_counts(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let view = View::parse(
      &opt_str_arg(args, "view").unwrap_or_else(|| "inbox".into()),
      opt_str_arg(args, "label"),
    )?;
    let conn = self.conn_mut();
    let mut threads = 0i64;
    let mut unread = 0i64;
    // Counted in the database, not by loading every thread: a count on a
    // mailbox of sixty thousand messages read them all, under the lock,
    // for two numbers.
    let (hidden_filter, membership) = view_filters(&view);
    let sql = format!(
      "SELECT COUNT(*), COALESCE(SUM(u), 0) FROM (
         SELECT m.thread_id, MAX(m.unread) AS u FROM messages m
         WHERE m.account_email = ?1 {hidden_filter} {membership}
         GROUP BY m.thread_id)"
    );
    let label = view.member_label().unwrap_or_default();
    for account in &accounts {
      let (t, u): (i64, i64) =
        conn.query_row(&sql, params![account, label], |r| Ok((r.get(0)?, r.get(1)?)))?;
      threads += t;
      unread += u;
    }
    Ok(json!({ "threads": threads, "unread": unread }))
  }

  /// One thread, every message, bodies where fetched.
  pub fn messages_thread(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn_mut();
    let messages = messages_of_threads(&conn, &account, std::slice::from_ref(&thread_id))?;
    let mut out = Vec::new();
    for m in messages {
      let body: Option<Value> = conn
        .query_row(
          "SELECT text_body, html_body, inline_images_json, attachments_json
             FROM message_bodies WHERE account_email = ?1 AND message_id = ?2",
          params![account, m.row.message_id],
          |r| {
            let inline: String = r.get(2)?;
            let attachments: String = r.get(3)?;
            Ok(json!({
              "text": r.get::<_, Option<String>>(0)?,
              "html": r.get::<_, Option<String>>(1)?,
              "inlineImages": serde_json::from_str::<Value>(&inline).unwrap_or(json!({})),
              "attachments": serde_json::from_str::<Value>(&attachments).unwrap_or(json!([])),
            }))
          },
        )
        .optional()?;
      let mut value = serde_json::to_value(&m.row)?;
      value["body"] = body.unwrap_or(Value::Null);
      out.push(value);
    }
    Ok(json!({ "messages": out }))
  }

  /// Full-text search over the copy. Threads, newest first, each marked with
  /// the message that matched best.
  pub fn messages_search(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let q = str_arg(args, "q")?;
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(50).clamp(1, 500);
    let include_hidden = args.get("includeDeleted").and_then(Value::as_bool).unwrap_or(false);
    // A search inside a folder keeps only threads that belong to it.
    let within = match opt_str_arg(args, "view") {
      Some(view) if view != "all" => Some(View::parse(&view, opt_str_arg(args, "label"))?),
      _ => None,
    };
    let Some(plan) = parse_search(&q) else {
      // The provider's language; the caller asks the provider.
      return Ok(json!({ "threads": [], "handled": false }));
    };
    if plan.is_empty() {
      return Ok(json!({ "threads": [], "handled": true }));
    }
    let conn = self.conn_mut();
    // One statement finds the messages: through the index when there are
    // words, from the table alone when only the filters narrow it.
    let mut sql = String::new();
    let mut binds: Vec<SqlValue> = Vec::new();
    if plan.fts.is_empty() {
      sql.push_str(
        "SELECT 0.0, m.account_email, m.thread_id, m.message_id FROM messages m WHERE 1 = 1",
      );
    } else {
      sql.push_str(
        "SELECT bm25(messages_fts), m.account_email, m.thread_id, m.message_id
           FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH ?",
      );
      binds.push(SqlValue::Text(plan.fts.clone()));
    }
    let marks = std::iter::repeat("?").take(accounts.len()).collect::<Vec<_>>().join(",");
    sql.push_str(&format!(" AND LOWER(m.account_email) IN ({marks})"));
    binds.extend(accounts.iter().map(|a| SqlValue::Text(a.to_lowercase())));
    if let Some(after) = plan.after {
      sql.push_str(" AND m.sent_at >= ?");
      binds.push(SqlValue::Integer(after));
    }
    if let Some(before) = plan.before {
      sql.push_str(" AND m.sent_at < ?");
      binds.push(SqlValue::Integer(before));
    }
    if plan.attachment {
      sql.push_str(" AND m.has_attachments = 1");
    }
    sql.push_str(if plan.fts.is_empty() {
      " ORDER BY m.sent_at DESC LIMIT 400"
    } else {
      " ORDER BY bm25(messages_fts) LIMIT 400"
    });
    let mut stmt = conn.prepare(&sql)?;
    let hits: Vec<(f64, String, String, String)> = stmt
      .query_map(params_from_iter(binds.iter()), |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
      })?
      .collect::<Result<Vec<_>, _>>()?;
    if hits.is_empty() {
      return Ok(json!({ "threads": [], "handled": true }));
    }
    // Best hit per (account, thread).
    let mut best: HashMap<(String, String), (f64, String)> = HashMap::new();
    for (score, account, thread_id, message_id) in hits {
      let entry = best.entry((account, thread_id)).or_insert((f64::MAX, String::new()));
      if score < entry.0 {
        *entry = (score, message_id);
      }
    }
    let view = if include_hidden { View::Trash } else { View::All };
    let mut by_account: HashMap<String, Vec<String>> = HashMap::new();
    for ((account, thread_id), _) in &best {
      by_account.entry(account.clone()).or_default().push(thread_id.clone());
    }
    let mut out: Vec<ThreadRow> = Vec::new();
    for (account, ids) in by_account {
      for chunk in ids.chunks(400) {
        let mut rows = load_threads(&conn, &account, chunk, &view)?;
        for row in rows.iter_mut() {
          if let Some((_, message_id)) = best.get(&(account.clone(), row.thread_id.clone())) {
            row.focus_message_id = Some(message_id.clone());
          }
        }
        out.extend(rows);
      }
    }
    if let Some(view) = &within {
      out.retain(|t| thread_in_view(t, view));
    }
    out.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    out.truncate(limit as usize);
    Ok(json!({ "threads": out, "handled": true }))
  }

  /// Who the mailbox wrote to, newest first, from its sent mail since
  /// `since` (ms). For the contact index; replaces a scan of sent mail.
  pub fn messages_recipients(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let since = args.get("since").and_then(Value::as_i64).unwrap_or(0);
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT m.to_json, m.cc_json, m.sent_at FROM messages m
       WHERE m.account_email = ?1 AND m.sent_at >= ?2
         AND (LOWER(m.from_email) = LOWER(?1) OR EXISTS (
           SELECT 1 FROM message_labels l WHERE l.account_email = m.account_email
             AND l.message_id = m.message_id AND l.label = 'SENT'))
       ORDER BY m.sent_at DESC",
    )?;
    let rows = stmt.query_map(params![account, since], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;
    let mut seen: HashMap<String, (String, i64)> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for row in rows {
      let (to_json, cc_json, at) = row?;
      let to: Vec<Address> = serde_json::from_str(&to_json).unwrap_or_default();
      let cc: Vec<Address> = serde_json::from_str(&cc_json).unwrap_or_default();
      for a in to.into_iter().chain(cc) {
        let key = a.email.trim().to_lowercase();
        if key.is_empty() || !key.contains('@') || key == account.to_lowercase() {
          continue;
        }
        match seen.get_mut(&key) {
          Some(entry) => {
            if entry.0.is_empty() && !a.name.trim().is_empty() {
              entry.0 = a.name.trim().to_string();
            }
          }
          None => {
            seen.insert(key.clone(), (a.name.trim().to_string(), at));
            order.push(key);
          }
        }
      }
    }
    let out: Vec<Value> = order
      .iter()
      .map(|key| {
        let (name, at) = &seen[key];
        json!({ "email": key, "name": name, "lastAt": at })
      })
      .collect();
    Ok(Value::Array(out))
  }

  /// Threads and unread threads per user label, Trash and Junk left out.
  pub fn messages_label_counts(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT l.label, COUNT(DISTINCT m.thread_id),
              COUNT(DISTINCT CASE WHEN m.unread = 1 THEN m.thread_id END)
         FROM message_labels l JOIN messages m
           ON m.account_email = l.account_email AND m.message_id = l.message_id
        WHERE l.account_email = ?1
          AND l.label NOT IN ('INBOX','SENT','DRAFT','TRASH','SPAM','STARRED','IMPORTANT')
          AND NOT EXISTS (SELECT 1 FROM message_labels x WHERE x.account_email = m.account_email
                            AND x.message_id = m.message_id AND x.label IN ('TRASH','SPAM'))
        GROUP BY l.label ORDER BY l.label",
    )?;
    let rows = stmt.query_map(params![account], |r| {
      Ok(json!({ "label": r.get::<_, String>(0)?, "threads": r.get::<_, i64>(1)?, "unread": r.get::<_, i64>(2)? }))
    })?;
    Ok(Value::Array(rows.collect::<Result<Vec<_>, _>>()?))
  }

  /// TypeScript-side writes: the Outlook worker and the tests.
  pub fn messages_upsert_many(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let rows: Vec<MessageRow> = serde_json::from_value(
      args.get("rows").cloned().ok_or_else(|| DbError::BadArgument("rows".into()))?,
    )?;
    let n = self.messages_upsert(&account, &rows)?;
    Ok(json!(n))
  }

  pub fn messages_put_body(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let message_id = str_arg(args, "messageId")?;
    let body: BodyRow = serde_json::from_value(
      args.get("body").cloned().ok_or_else(|| DbError::BadArgument("body".into()))?,
    )?;
    self.bodies_put(&account, &message_id, &body)?;
    Ok(Value::Null)
  }

  /// Every message of a thread read, or the newest unread: the two moves
  /// the interface makes.
  pub fn messages_set_unread(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let unread = args.get("unread").and_then(Value::as_bool).unwrap_or(false);
    let conn = self.conn_mut();
    let changed = if unread {
      conn.execute(
        "UPDATE messages SET unread = 1, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2
           AND sent_at = (SELECT MAX(sent_at) FROM messages m2 WHERE m2.account_email = ?1 AND m2.thread_id = ?2)",
        params![account, thread_id, now_ms()],
      )?
    } else {
      conn.execute(
        "UPDATE messages SET unread = 0, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2 AND unread = 1",
        params![account, thread_id, now_ms()],
      )?
    };
    Ok(json!(changed))
  }

  /// These messages, gone, with their labels and bodies. For a provider
  /// whose delta says a message left.
  pub fn messages_remove_messages(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let ids = str_list_arg(args, "messageIds")?;
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let mut removed = 0;
    for id in ids {
      let found: Option<i64> = tx
        .query_row(
          "SELECT rowid FROM messages WHERE account_email = ?1 AND message_id = ?2",
          params![account, id],
          |r| r.get(0),
        )
        .optional()?;
      if let Some(rowid) = found {
        delete_one(&tx, &account, rowid, &id)?;
        removed += 1;
      }
    }
    tx.commit()?;
    Ok(json!(removed))
  }

  pub fn messages_remove_account(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    self.messages_clear_account(&account, false)?;
    Ok(Value::Null)
  }

  pub fn sync_list(&self) -> DbResult<Value> {
    Ok(serde_json::to_value(self.sync_state_list()?)?)
  }

  pub fn sync_set(&self, args: &Value) -> DbResult<Value> {
    let state: SyncState = serde_json::from_value(
      args.get("state").cloned().ok_or_else(|| DbError::BadArgument("state".into()))?,
    )?;
    self.sync_state_set(&state)?;
    Ok(Value::Null)
  }
}

/// Thread ids of a view with the time of their newest visible message,
/// newest first, older than `before`.
/// The WHERE clauses that make a message row count for a view: the
/// hidden-label filter and the thread-membership filter, as SQL text
/// with `?1` the account and `?2` the view's label.
fn view_filters(view: &View) -> (String, String) {
  let hidden_filter = if view.shows_hidden() {
    String::new()
  } else {
    format!(
      "AND NOT EXISTS (SELECT 1 FROM message_labels x WHERE x.account_email = m.account_email
         AND x.message_id = m.message_id AND x.label IN {HIDDEN_LABELS})"
    )
  };
  let membership = match view {
    View::Archived => format!(
      "AND m.thread_id NOT IN (SELECT m2.thread_id FROM messages m2 JOIN message_labels l
           ON l.account_email = m2.account_email AND l.message_id = m2.message_id
         WHERE m2.account_email = ?1 AND l.label IN ('INBOX','DRAFT'))
       AND m.thread_id IN (SELECT m3.thread_id FROM messages m3 WHERE m3.account_email = ?1
         AND NOT EXISTS (SELECT 1 FROM message_labels y WHERE y.account_email = m3.account_email
           AND y.message_id = m3.message_id AND y.label IN ('SENT','DRAFT','TRASH','SPAM')))"
    ),
    View::All => String::new(),
    _ => "AND m.thread_id IN (SELECT m2.thread_id FROM messages m2 JOIN message_labels l
           ON l.account_email = m2.account_email AND l.message_id = m2.message_id
         WHERE m2.account_email = ?1 AND l.label = ?2)"
      .to_string(),
  };
  (hidden_filter, membership)
}

fn candidate_threads(
  conn: &Connection,
  account: &str,
  view: &View,
  before: i64,
  limit: i64,
) -> DbResult<Vec<(String, i64)>> {
  let (hidden_filter, membership) = view_filters(view);
  let sql = format!(
    "SELECT m.thread_id, MAX(m.sent_at) AS last_at FROM messages m
     WHERE m.account_email = ?1 {hidden_filter} {membership}
     GROUP BY m.thread_id HAVING last_at < ?3 ORDER BY last_at DESC LIMIT ?4"
  );
  let label = view.member_label().unwrap_or_default();
  let mut stmt = conn.prepare(&sql)?;
  let rows = stmt.query_map(params![account, label, before, limit], |r| {
    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
  })?;
  Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn messages_of_threads(
  conn: &Connection,
  account: &str,
  thread_ids: &[String],
) -> DbResult<Vec<StoredMessage>> {
  if thread_ids.is_empty() {
    return Ok(Vec::new());
  }
  let marks = std::iter::repeat("?").take(thread_ids.len()).collect::<Vec<_>>().join(",");
  let sql = format!(
    "SELECT m.rowid, m.message_id, m.thread_id, m.uid, m.modseq, m.rfc_message_id, m.in_reply_to,
       m.ref_headers, m.from_name, m.from_email, m.to_json, m.cc_json, m.bcc_json, m.subject,
       m.snippet, m.sent_at, m.size_estimate, m.has_attachments, m.unread, m.starred, m.is_draft,
       m.folder,
       (SELECT group_concat(label, char(31)) FROM message_labels l
          WHERE l.account_email = m.account_email AND l.message_id = m.message_id) AS labels
     FROM messages m WHERE m.account_email = ? AND m.thread_id IN ({marks})
     ORDER BY m.thread_id, m.sent_at ASC"
  );
  let mut stmt = conn.prepare(&sql)?;
  let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
  for id in thread_ids {
    values.push(id);
  }
  let rows = stmt.query_map(values.as_slice(), |r| {
    let labels: Option<String> = r.get(22)?;
    Ok(StoredMessage {
      row: MessageRow {
        message_id: r.get(1)?,
        thread_id: r.get(2)?,
        folder: r.get(21)?,
        uid: r.get(3)?,
        modseq: r.get(4)?,
        rfc_message_id: r.get(5)?,
        in_reply_to: r.get(6)?,
        references: r.get(7)?,
        from_name: r.get(8)?,
        from_email: r.get(9)?,
        to: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default(),
        cc: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default(),
        bcc: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
        subject: r.get(13)?,
        snippet: r.get(14)?,
        sent_at: r.get(15)?,
        size_estimate: r.get(16)?,
        has_attachments: r.get::<_, i64>(17)? != 0,
        unread: r.get::<_, i64>(18)? != 0,
        starred: r.get::<_, i64>(19)? != 0,
        is_draft: r.get::<_, i64>(20)? != 0,
        labels: labels
          .map(|s| s.split('\u{1f}').map(str::to_string).collect())
          .unwrap_or_default(),
      },
    })
  })?;
  Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The rows the list draws for these threads, in no particular order.
fn load_threads(
  conn: &Connection,
  account: &str,
  thread_ids: &[String],
  view: &View,
) -> DbResult<Vec<ThreadRow>> {
  let messages = messages_of_threads(conn, account, thread_ids)?;
  let mut by_thread: HashMap<String, Vec<StoredMessage>> = HashMap::new();
  for m in messages {
    by_thread.entry(m.row.thread_id.clone()).or_default().push(m);
  }
  let hidden_ok = view.shows_hidden();
  let only_label = if hidden_ok { view.member_label() } else { None };
  let mut out = Vec::new();
  for (thread_id, list) in by_thread {
    let visible: Vec<&StoredMessage> = list
      .iter()
      .filter(|m| {
        let hidden = m.row.labels.iter().any(|l| l == TRASH || l == SPAM);
        if let Some(only) = &only_label {
          m.row.labels.iter().any(|l| l == only)
        } else {
          !hidden
        }
      })
      .collect();
    let Some(latest) = visible.last() else {
      continue;
    };
    let mut participants: Vec<Address> = Vec::new();
    let senders: Vec<Address> = visible
      .iter()
      .map(|m| Address { name: m.row.from_name.clone(), email: m.row.from_email.clone() })
      .collect();
    let mut seen = HashSet::new();
    let mut labels: Vec<String> = Vec::new();
    let mut label_seen = HashSet::new();
    for m in &visible {
      let mut push = |a: &Address| {
        let key = a.email.trim().to_lowercase();
        if key.is_empty() || !seen.insert(key) {
          return;
        }
        participants.push(Address { name: a.name.clone(), email: a.email.clone() });
      };
      push(&Address { name: m.row.from_name.clone(), email: m.row.from_email.clone() });
      for a in &m.row.to {
        push(a);
      }
      for a in &m.row.cc {
        push(a);
      }
      for l in &m.row.labels {
        if label_seen.insert(l.clone()) {
          labels.push(l.clone());
        }
      }
    }
    let subject = visible
      .iter()
      .rev()
      .map(|m| m.row.subject.trim())
      .find(|s| !s.is_empty())
      .unwrap_or("")
      .to_string();
    out.push(ThreadRow {
      account: account.to_string(),
      thread_id,
      subject,
      last_at: latest.row.sent_at,
      message_count: visible.len() as i64,
      unread: visible.iter().any(|m| m.row.unread),
      has_attachments: visible.iter().any(|m| m.row.has_attachments),
      starred: visible.iter().any(|m| m.row.starred),
      is_draft: latest.row.is_draft,
      labels,
      latest: LatestMessage {
        message_id: latest.row.message_id.clone(),
        from_name: latest.row.from_name.clone(),
        from_email: latest.row.from_email.clone(),
        to: latest.row.to.clone(),
        snippet: latest.row.snippet.clone(),
        sent_at: latest.row.sent_at,
        unread: latest.row.unread,
        rfc_message_id: latest.row.rfc_message_id.clone(),
        in_reply_to: latest.row.in_reply_to.clone(),
        references: latest.row.references.clone(),
      },
      participants,
      senders,
      focus_message_id: None,
    });
  }
  Ok(out)
}

/// Whether a thread the search found belongs to the view searched in.
fn thread_in_view(t: &ThreadRow, view: &View) -> bool {
  let has = |l: &str| t.labels.iter().any(|x| x == l);
  match view {
    View::Inbox => has(INBOX),
    View::Sent => has(SENT),
    View::Drafts => has(DRAFT),
    View::Starred => has(STARRED),
    View::Trash => has(TRASH),
    View::Junk => has(SPAM),
    View::Archived => !has(INBOX) && !has(DRAFT),
    View::All => true,
    View::Label(l) => has(l),
  }
}

/// What a search asks for, read from what was typed.
#[derive(Debug, Default, PartialEq)]
pub struct SearchPlan {
  /// The FTS5 query; empty when only the filters below narrow the list.
  pub fts: String,
  /// Sent at or after this (ms), from `after:` or `newer_than:`.
  pub after: Option<i64>,
  /// Sent before this (ms), from `before:` or `older_than:`.
  pub before: Option<i64>,
  /// Only mail with a file attached, from `has:attachment`.
  pub attachment: bool,
}

impl SearchPlan {
  pub fn is_empty(&self) -> bool {
    self.fts.is_empty() && self.after.is_none() && self.before.is_none() && !self.attachment
  }
}

/// Keys the copy cannot answer. A query with one goes to the provider,
/// which speaks them. `has:` is here for every value but `attachment`.
const PROVIDER_KEYS: &[&str] = &[
  "in", "label", "is", "has", "filename", "larger", "smaller", "size", "category", "list",
  "deliveredto", "bcc", "rfc822msgid",
];
const LOCAL_KEYS: &[&str] =
  &["from", "to", "cc", "subject", "after", "before", "newer_than", "older_than"];

/// The words as typed, read as a search over the copy.
///
/// Plain words are required prefixes; "a phrase" is kept whole; `from:`,
/// `to:`, `cc:`, and `subject:` look in one column; `-word` leaves out;
/// `OR` between two words takes either; `has:attachment`, `before:`,
/// `after:`, `newer_than:`, and `older_than:` narrow by what the table
/// knows. The same words Gmail reads, so nobody learns a second language.
///
/// `None` when the query asks something only the provider can answer —
/// `in:`, `label:`, `is:`, and the rest — so the caller asks the provider.
pub fn parse_search(q: &str) -> Option<SearchPlan> {
  let mut plan = SearchPlan::default();
  let mut positives: Vec<String> = Vec::new();
  let mut negatives: Vec<String> = Vec::new();
  let mut or_next = false;
  for raw in split_search(q) {
    if raw == "OR" {
      or_next = !positives.is_empty();
      continue;
    }
    if raw == "AND" {
      continue;
    }
    let (neg, rest) = match raw.strip_prefix('-') {
      Some(r) if !r.is_empty() => (true, r),
      _ => (false, raw.as_str()),
    };
    // `key:value`, when the key is one anybody's mail search knows. A
    // colon in anything else — a URL, a time — is part of the word.
    let (key, value) = match rest.split_once(':') {
      Some((k, v)) if !rest.starts_with('"') => {
        let lower = k.to_ascii_lowercase();
        if LOCAL_KEYS.contains(&lower.as_str()) || PROVIDER_KEYS.contains(&lower.as_str()) {
          (Some(lower), v)
        } else {
          (None, rest)
        }
      }
      _ => (None, rest),
    };
    let (phrase, text) = match value.strip_prefix('"') {
      Some(v) => (true, v.strip_suffix('"').unwrap_or(v)),
      None => (false, value),
    };
    match key.as_deref() {
      None | Some("from") | Some("to") | Some("cc") | Some("subject") => {
        let Some(term) = fts_term(text, phrase) else { continue };
        let column = match key.as_deref() {
          Some("from") => "from_text: ",
          Some("to") | Some("cc") => "to_text: ",
          Some("subject") => "subject: ",
          _ => "",
        };
        let piece = format!("{column}{term}");
        if neg {
          negatives.push(piece);
        } else if or_next {
          // Grouped, so `a b OR c` reads as Gmail reads it: a, and one of b or c.
          let last = positives.pop().unwrap_or_default();
          positives.push(format!("({last} OR {piece})"));
          or_next = false;
        } else {
          positives.push(piece);
        }
      }
      Some("has") if text.eq_ignore_ascii_case("attachment") && !neg => plan.attachment = true,
      Some("after") if !neg => plan.after = Some(parse_day(text)?),
      Some("before") if !neg => plan.before = Some(parse_day(text)?),
      Some("newer_than") if !neg => plan.after = Some(now_ms() - parse_span_ms(text)?),
      Some("older_than") if !neg => plan.before = Some(now_ms() - parse_span_ms(text)?),
      Some(_) => return None,
    }
  }
  // Nothing to take away from: the provider can list a whole mailbox
  // less a word; the index cannot.
  if positives.is_empty() && !negatives.is_empty() {
    return None;
  }
  let mut fts = positives.join(" ");
  for n in negatives {
    fts.push_str(" NOT ");
    fts.push_str(&n);
  }
  plan.fts = fts;
  Some(plan)
}

/// Words split on spaces, except that a quoted span stays one word.
fn split_search(q: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut cur = String::new();
  let mut quoted = false;
  for c in q.chars() {
    if c == '"' {
      quoted = !quoted;
      cur.push(c);
      continue;
    }
    if c.is_whitespace() && !quoted {
      if !cur.is_empty() {
        out.push(std::mem::take(&mut cur));
      }
      continue;
    }
    cur.push(c);
  }
  if !cur.is_empty() {
    out.push(cur);
  }
  out
}

/// One FTS5 term: a quoted prefix for a word, a quoted phrase as it was.
/// Quotes inside are doubled, as FTS wants.
fn fts_term(text: &str, phrase: bool) -> Option<String> {
  if phrase {
    let t = text.trim();
    if t.is_empty() {
      return None;
    }
    return Some(format!("\"{}\"", t.replace('"', "\"\"")));
  }
  let cleaned =
    text.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_');
  if cleaned.is_empty() {
    return None;
  }
  Some(format!("\"{}\"*", cleaned.replace('"', "\"\"")))
}

/// What the reader typed, as an FTS5 query. Empty for a query the copy
/// does not answer.
pub fn fts_query(q: &str) -> String {
  parse_search(q).map(|p| p.fts).unwrap_or_default()
}

/// `2026-01-15` or `2026/01/15` as the ms of that day's start, UTC. A day
/// is coarse enough that the zone does not matter.
fn parse_day(text: &str) -> Option<i64> {
  let parts: Vec<&str> = text.split(['-', '/']).collect();
  if parts.len() != 3 || parts[0].len() != 4 {
    return None;
  }
  let y: i64 = parts[0].parse().ok()?;
  let m: u32 = parts[1].parse().ok()?;
  let d: u32 = parts[2].parse().ok()?;
  if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
    return None;
  }
  Some(days_from_civil(y, m, d) * 86_400_000)
}

/// Days since 1970-01-01 for a calendar date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
  let doy = (153 * mp + 2) / 5 + d as i64 - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

/// `7d`, `2w`, `3m`, `1y` as ms, the way Gmail reads them.
fn parse_span_ms(text: &str) -> Option<i64> {
  let (num, unit) = text.split_at(text.len().checked_sub(1)?);
  let n: i64 = num.parse().ok()?;
  let days = match unit {
    "d" => 1,
    "w" => 7,
    "m" => 30,
    "y" => 365,
    _ => return None,
  };
  Some(n * days * 86_400_000)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn db() -> MailDb {
    MailDb::open_in_memory().expect("open")
  }

  fn msg(id: &str, thread: &str, uid: i64, at: i64, labels: &[&str]) -> MessageRow {
    MessageRow {
      message_id: id.into(),
      thread_id: thread.into(),
      folder: String::new(),
      uid: Some(uid),
      from_name: "Ann Sender".into(),
      from_email: "ann@sender.test".into(),
      to: vec![Address { name: "Vera".into(), email: "vera@example.com".into() }],
      subject: format!("Subject {thread}"),
      snippet: format!("snippet of {id}"),
      sent_at: at,
      unread: true,
      labels: labels.iter().map(|s| s.to_string()).collect(),
      ..Default::default()
    }
  }

  #[test]
  fn the_background_fetch_takes_recent_bodies_newest_first_and_skips_big_ones() {
    let db = db();
    let mut big = msg("m3", "t3", 3, 3_000, &[INBOX]);
    big.size_estimate = Some(10_000_000);
    let mut old = msg("m4", "t4", 4, 10, &[INBOX]);
    old.size_estimate = Some(100);
    db.messages_upsert(
      "vera@example.com",
      &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[INBOX]), big, old],
    )
    .unwrap();
    let missing = db.messages_bodies_missing("vera@example.com", 500, 5_000_000, 10).unwrap();
    assert_eq!(missing, vec![("m2".to_string(), 2), ("m1".to_string(), 1)]);

    // A body kept, or given up on, is not asked for again.
    db.bodies_put("vera@example.com", "m2", &BodyRow { text: Some("hello".into()), ..Default::default() })
      .unwrap();
    db.messages_body_skipped("vera@example.com", "m1").unwrap();
    assert!(db.messages_bodies_missing("vera@example.com", 500, 5_000_000, 10).unwrap().is_empty());
  }

  #[test]
  fn entities_come_back_as_their_characters_and_unknown_ones_stay() {
    assert_eq!(decode_entities("K&aelig;re Ulrik &#248; &#xE9; &amp; co"), "Kære Ulrik ø é & co");
    // Double-encoded is decoded once, as a browser would.
    assert_eq!(decode_entities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
    assert_eq!(decode_entities("fish &chips; &unknownname; & more"), "fish &chips; &unknownname; & more");
    assert_eq!(decode_entities("no entities"), "no entities");
  }

  #[test]
  fn tags_in_a_plain_part_go_and_other_angle_brackets_stay() {
    assert_eq!(
      strip_stray_tags("Dear <span class=\"personaldata\">Dr Holm</span>, your <b>e-ticket</b><br/>receipt"),
      "Dear Dr Holm, your e-ticket receipt"
    );
    for kept in [
      "Write to Ada <ada@example.org> today",
      "See <https://example.org/a?b=1> for more",
      "if a < b and b > c",
      "Dear <name>, I <3 this",
      "a lone <span with no end",
    ] {
      assert_eq!(strip_stray_tags(kept), kept);
    }
    let stripped = strip_html("<p>K&aelig;re &nbsp;Ulrik</p>");
    let words: Vec<&str> = stripped.split_whitespace().collect();
    assert_eq!(words, vec!["Kære", "Ulrik"]);
  }

  #[test]
  fn the_stripper_skips_comments_and_the_head_and_survives_a_cut_comment() {
    let mso = "<!DOCTYPE html><html><head><title>Hidden</title><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><style>.a{color:red}</style></head><body><p>Hej Ulrik, dit fly er forsinket.</p></body></html>";
    let text = strip_html(mso);
    assert!(!text.contains("96"), "{text:?}");
    assert!(!text.contains("Hidden"), "{text:?}");
    assert!(text.contains("Hej Ulrik, dit fly er forsinket."), "{text:?}");
    // Cut inside the comment, as a two-kilobyte prefix would be.
    let cut = &mso[..mso.find("PixelsPerInch>96").unwrap() + 16];
    assert_eq!(strip_html(cut).trim(), "");
    // And the case that panicked: a character whose lower case is longer.
    assert!(strip_html("aİ<b>x</b>").contains("x"));
  }

  #[test]
  fn a_store_with_poor_snippets_is_repaired_when_opened() {
    let db = db();
    let mut plain = msg("m1", "t1", 1, 1_000, &[INBOX]);
    plain.snippet = "96".into();
    let mut html = msg("m2", "t2", 2, 2_000, &[INBOX]);
    html.snippet = "96 Since launching ShowerSpaah, we have learned a great deal".into();
    db.messages_upsert("vera@example.com", &[plain, html]).unwrap();
    {
      let conn = db.conn_mut();
      // Bodies kept by a build whose stripper read the Outlook block as
      // words: the search text it wrote begins with 96 too.
      conn
        .execute(
          "INSERT INTO message_bodies (account_email, message_id, text_body, search_text, fetched_at)
           VALUES ('vera@example.com', 'm1', 'Dit fly er forsinket.', 'Dit fly er forsinket.', 1)",
          [],
        )
        .unwrap();
      conn
        .execute(
          "INSERT INTO message_bodies (account_email, message_id, html_body, search_text, fetched_at)
           VALUES ('vera@example.com', 'm2',
             '<html><head><!--[if gte mso 9]><xml><o:PixelsPerInch>96</o:PixelsPerInch></xml><![endif]--></head><body><p>Since launching ShowerSpaah, we have learned a great deal.</p></body></html>',
             '96 Since launching ShowerSpaah, we have learned a great deal.', 1)",
          [],
        )
        .unwrap();
      // The store opened before these rows existed and remembered the
      // repair as done; forget that, as an older store would not have it.
      conn.execute("DELETE FROM settings WHERE key = 'repair.snippets'", []).unwrap();
      migrate(&conn).unwrap();
      let snippet = |id: &str| -> String {
        conn.query_row("SELECT snippet FROM messages WHERE message_id = ?1", [id], |r| r.get(0)).unwrap()
      };
      assert_eq!(snippet("m1"), "Dit fly er forsinket.");
      assert_eq!(snippet("m2"), "Since launching ShowerSpaah, we have learned a great deal.");
      let text: String = conn
        .query_row("SELECT search_text FROM message_bodies WHERE message_id = 'm2'", [], |r| r.get(0))
        .unwrap();
      assert!(!text.starts_with("96"), "{text}");
    }
    // Findable by its words, and not by the number that was never there.
    let hit = db.messages_search(&json!({ "accounts": ["vera@example.com"], "q": "ShowerSpaah", "limit": 5 })).unwrap();
    assert_eq!(hit["threads"].as_array().unwrap().len(), 1);
  }

  #[test]
  fn a_kept_body_replaces_a_poor_snippet() {
    let db = db();
    let mut row = msg("m1", "t1", 1, 1_000, &[INBOX]);
    row.snippet = "96".into();
    db.messages_upsert("vera@example.com", &[row]).unwrap();
    db.bodies_put(
      "vera@example.com",
      "m1",
      &BodyRow { html: Some("<p>Hej Ulrik, dit fly er forsinket med to timer.</p>".into()), ..Default::default() },
    )
    .unwrap();
    let out = db.messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 })).unwrap();
    assert_eq!(out["threads"][0]["latest"]["snippet"], "Hej Ulrik, dit fly er forsinket med to timer.");
  }

  #[test]
  fn inbox_threads_come_newest_first_with_the_latest_message_on_top() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[
        msg("m1", "t1", 1, 1_000, &[INBOX]),
        msg("m2", "t1", 2, 3_000, &[INBOX]),
        msg("m3", "t2", 3, 2_000, &[INBOX]),
        msg("m4", "t3", 4, 4_000, &[SENT]),
      ],
    )
    .unwrap();
    let out = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 10 }))
      .unwrap();
    let threads = out["threads"].as_array().unwrap();
    assert_eq!(threads.len(), 2, "sent-only thread is not in the inbox");
    assert_eq!(threads[0]["threadId"], "t1");
    assert_eq!(threads[0]["latest"]["messageId"], "m2");
    assert_eq!(threads[0]["messageCount"], 2);
    assert_eq!(threads[1]["threadId"], "t2");
    assert!(out["nextBefore"].is_null());
  }

  #[test]
  fn paging_walks_down_by_the_newest_message() {
    let db = db();
    let rows: Vec<MessageRow> = (1..=5)
      .map(|i| msg(&format!("m{i}"), &format!("t{i}"), i, i * 1_000, &[INBOX]))
      .collect();
    db.messages_upsert("vera@example.com", &rows).unwrap();
    let first = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 2 }))
      .unwrap();
    assert_eq!(first["nextBefore"], 4_000);
    let second = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 2, "before": 4_000 }))
      .unwrap();
    let ids: Vec<&str> = second["threads"]
      .as_array()
      .unwrap()
      .iter()
      .map(|t| t["threadId"].as_str().unwrap())
      .collect();
    assert_eq!(ids, vec!["t3", "t2"]);
  }

  #[test]
  fn trash_hides_from_every_view_but_its_own() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[TRASH])],
    )
    .unwrap();
    let inbox = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox" }))
      .unwrap();
    assert_eq!(inbox["threads"].as_array().unwrap().len(), 1);
    let all = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "all" }))
      .unwrap();
    assert_eq!(all["threads"].as_array().unwrap().len(), 1);
    let trash = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "trash" }))
      .unwrap();
    assert_eq!(trash["threads"][0]["threadId"], "t2");
  }

  #[test]
  fn archived_is_what_left_the_inbox_and_was_not_only_sent() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[
        msg("m1", "t1", 1, 1_000, &[]),
        msg("m2", "t2", 2, 2_000, &[INBOX]),
        msg("m3", "t3", 3, 3_000, &[SENT]),
      ],
    )
    .unwrap();
    let out = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "archived" }))
      .unwrap();
    let ids: Vec<&str> = out["threads"]
      .as_array()
      .unwrap()
      .iter()
      .map(|t| t["threadId"].as_str().unwrap())
      .collect();
    assert_eq!(ids, vec!["t1"]);
  }

  #[test]
  fn search_finds_subjects_and_then_bodies_once_fetched() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[INBOX])],
    )
    .unwrap();
    let both = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject" }))
      .unwrap();
    assert_eq!(both["threads"].as_array().unwrap().len(), 2, "both subjects say Subject");
    let one = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject t2" }))
      .unwrap();
    assert_eq!(one["threads"].as_array().unwrap().len(), 1, "every word is required");
    let none = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "jetblue" }))
      .unwrap();
    assert_eq!(none["threads"].as_array().unwrap().len(), 0);
    db.bodies_put(
      "vera@example.com",
      "m1",
      &BodyRow {
        html: Some("<p>Your <b>JetBlue</b> booking &amp; receipt</p><style>p{}</style>".into()),
        ..Default::default()
      },
    )
    .unwrap();
    let found = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "jetblue booking" }))
      .unwrap();
    assert_eq!(found["threads"][0]["threadId"], "t1");
    assert_eq!(found["threads"][0]["focusMessageId"], "m1");
    let thread = db
      .messages_thread(&json!({ "account": "vera@example.com", "threadId": "t1" }))
      .unwrap();
    assert!(thread["messages"][0]["body"]["html"].as_str().unwrap().contains("JetBlue"));
  }

  #[test]
  fn flags_follow_the_server_and_a_dropped_uid_leaves_no_trace() {
    let db = db();
    db.messages_upsert("vera@example.com", &[msg("m1", "t1", 7, 1_000, &[INBOX])]).unwrap();
    assert!(db
      .messages_set_flags("vera@example.com", "", 7, Some(false), Some(true), Some(&[INBOX.into(), STARRED.into()]), Some(99))
      .unwrap());
    let out = db
      .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "starred" }))
      .unwrap();
    assert_eq!(out["threads"][0]["unread"], false);
    assert_eq!(out["threads"][0]["starred"], true);
    assert_eq!(db.messages_high_water("vera@example.com", "").unwrap(), (Some(7), Some(99)));
    assert_eq!(db.messages_delete_uids("vera@example.com", "", &[7]).unwrap(), 1);
    assert!(db.messages_known_uids("vera@example.com", "").unwrap().is_empty());
    let gone = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject" }))
      .unwrap();
    assert!(gone["threads"].as_array().unwrap().is_empty());
    // A message in Trash has a UID of its own folder's numbering.
    db.messages_upsert("vera@example.com", &[MessageRow { folder: "trash".into(), ..msg("t1", "tt", 7, 5_000, &[TRASH]) }]).unwrap();
    db.messages_upsert("vera@example.com", &[msg("m9", "t9", 7, 6_000, &[INBOX])]).unwrap();
    assert_eq!(db.messages_known_uids("vera@example.com", "trash").unwrap(), vec![7]);
    assert_eq!(db.messages_known_uids("vera@example.com", "").unwrap(), vec![7]);
    let ids = db.messages_uids_for("vera@example.com", &["t1".into(), "m9".into()]).unwrap();
    assert_eq!(ids[0].2, "trash");
    assert_eq!(ids[1].2, "");
  }

  #[test]
  fn counts_and_sync_state_round_trip() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[
        msg("m1", "t1", 1, 1_000, &[INBOX]),
        MessageRow { unread: false, ..msg("m2", "t2", 2, 2_000, &[INBOX]) },
      ],
    )
    .unwrap();
    let counts = db
      .messages_counts(&json!({ "accounts": ["vera@example.com"], "view": "inbox" }))
      .unwrap();
    assert_eq!(counts["threads"], 2);
    assert_eq!(counts["unread"], 1);
    db.sync_state_set(&SyncState {
      account: "vera@example.com".into(),
      phase: "full".into(),
      uid_validity: Some(5),
      full_sync_total: Some(200),
      full_sync_done: Some(50),
      ..Default::default()
    })
    .unwrap();
    let state = db.sync_state_get("vera@example.com", "").unwrap().unwrap();
    assert_eq!(state.phase, "full");
    assert_eq!(state.full_sync_done, Some(50));
    let listed = db.sync_list().unwrap();
    assert_eq!(listed[0]["account"], "vera@example.com");
  }

  #[test]
  fn recipients_come_from_sent_mail_and_counts_from_labels() {
    let db = db();
    db.messages_upsert(
      "vera@example.com",
      &[
        MessageRow {
          from_email: "vera@example.com".into(),
          to: vec![Address { name: "Ann".into(), email: "ann@x.test".into() }],
          cc: vec![Address { name: "".into(), email: "bo@x.test".into() }],
          unread: false,
          ..msg("s1", "t1", 1, 5_000, &[SENT, "Work"])
        },
        MessageRow {
          from_email: "vera@example.com".into(),
          to: vec![Address { name: "Bo Bosen".into(), email: "BO@x.test".into() }],
          unread: false,
          ..msg("s2", "t2", 2, 4_000, &[SENT])
        },
        msg("r1", "t3", 3, 3_000, &[INBOX, "Work"]),
        msg("r2", "t4", 4, 2_000, &[TRASH, "Work"]),
      ],
    )
    .unwrap();
    let who = db.messages_recipients(&json!({ "account": "vera@example.com", "since": 0 })).unwrap();
    let list = who.as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["email"], "ann@x.test");
    assert_eq!(list[1]["email"], "bo@x.test");
    assert_eq!(list[1]["name"], "Bo Bosen", "a later name fills an empty one");
    assert_eq!(list[1]["lastAt"], 5_000, "the newest mention sets the time");
    let counts = db.messages_label_counts(&json!({ "account": "vera@example.com" })).unwrap();
    assert_eq!(counts[0]["label"], "Work");
    assert_eq!(counts[0]["threads"], 2, "the trashed thread is left out");
    assert_eq!(counts[0]["unread"], 1);
    let within = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject", "view": "label", "label": "Work" }))
      .unwrap();
    let ids: Vec<&str> = within["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["t1", "t3"]);
  }

  #[test]
  fn a_query_becomes_required_prefixes() {
    assert_eq!(fts_query("jet blue"), "\"jet\"* \"blue\"*");
    assert_eq!(fts_query("  ann@sender.test "), "\"ann@sender.test\"*");
    assert_eq!(fts_query("\"quoted words\""), "\"quoted words\"", "a phrase stays whole");
    assert_eq!(fts_query("  "), "");
    assert_eq!(fts_query("https://x.test/a"), "\"https://x.test/a\"*", "a colon in a URL is not a key");
  }

  #[test]
  fn the_words_gmail_reads_become_a_plan() {
    let plan = parse_search("from:ann subject:\"jet blue\" -receipt paris OR london to:vera").unwrap();
    assert_eq!(
      plan.fts,
      "from_text: \"ann\"* subject: \"jet blue\" (\"paris\"* OR \"london\"*) to_text: \"vera\"* NOT \"receipt\"*"
    );
    assert!(plan.after.is_none() && plan.before.is_none() && !plan.attachment);

    let plan = parse_search("has:attachment after:2026-01-10 before:2026/02/01").unwrap();
    assert!(plan.fts.is_empty() && plan.attachment);
    assert_eq!(plan.after, Some(days_from_civil(2026, 1, 10) * 86_400_000));
    assert_eq!(plan.before, Some(days_from_civil(2026, 2, 1) * 86_400_000));
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(days_from_civil(2000, 3, 1), 11_017);

    let plan = parse_search("newer_than:7d").unwrap();
    let after = plan.after.unwrap();
    assert!(now_ms() - after >= 7 * 86_400_000 && now_ms() - after < 8 * 86_400_000);

    assert!(parse_search("in:inbox paris").is_none(), "in: is the provider's");
    assert!(parse_search("is:unread").is_none());
    assert!(parse_search("has:drive").is_none());
    assert!(parse_search("-only").is_none(), "nothing to take away from");
    assert!(parse_search("after:yesterday").is_none(), "a date it cannot read goes out");
    assert!(parse_search("OR paris OR").unwrap().fts == "\"paris\"*", "a stray OR is nothing");
    assert!(parse_search("   ").unwrap().is_empty());
  }

  #[test]
  fn a_fetched_body_settles_whether_there_is_a_file() {
    let db = db();
    let mut guessed = msg("m1", "t1", 1, 1_000, &[INBOX]);
    guessed.has_attachments = true;
    let mut plain = msg("m2", "t2", 2, 2_000, &[INBOX]);
    plain.has_attachments = false;
    db.messages_upsert("vera@example.com", &[guessed, plain]).unwrap();
    let flagged = |db: &MailDb| -> Vec<String> {
      let out = db
        .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "has:attachment" }))
        .unwrap();
      out["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect()
    };
    assert_eq!(flagged(&db), vec!["t1"], "the outer type's guess, before any body is in");

    // A multipart/mixed newsletter with only a picture in it: no file.
    db.bodies_put("vera@example.com", "m1", &BodyRow { html: Some("<p>News</p>".into()), attachments: json!([]), ..Default::default() }).unwrap();
    // A plain-looking mail whose structure turned out to carry a PDF.
    db.bodies_put(
      "vera@example.com",
      "m2",
      &BodyRow { text: Some("See attached".into()), attachments: json!([{ "filename": "a.pdf" }]), ..Default::default() },
    )
    .unwrap();
    assert_eq!(flagged(&db), vec!["t2"], "the body's own list decides");

    // Rows flagged by an older build are put right once, when the store opens.
    {
      let conn = db.conn_mut();
      conn.execute("UPDATE messages SET has_attachments = 1 WHERE message_id = 'm1'", []).unwrap();
      conn.execute("DELETE FROM settings WHERE key = 'repair.attachments'", []).unwrap();
      migrate(&conn).unwrap();
    }
    assert_eq!(flagged(&db), vec!["t2"]);
  }

  #[test]
  fn search_answers_the_operators_from_the_copy() {
    let db = db();
    let jan = days_from_civil(2026, 1, 15) * 86_400_000;
    let mar = days_from_civil(2026, 3, 15) * 86_400_000;
    let mut with_file = msg("m2", "t2", 2, mar, &[INBOX]);
    with_file.has_attachments = true;
    with_file.from_name = "Bo Reader".into();
    with_file.from_email = "bo@reader.test".into();
    db.messages_upsert("vera@example.com", &[msg("m1", "t1", 1, jan, &[INBOX]), with_file]).unwrap();
    let ids = |v: &Value| -> Vec<String> {
      v["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect()
    };
    let search = |q: &str| db.messages_search(&json!({ "accounts": ["vera@example.com"], "q": q })).unwrap();

    assert_eq!(ids(&search("from:ann")), vec!["t1"], "from: reads the sender column only");
    assert_eq!(ids(&search("from:bo@reader.test")), vec!["t2"]);
    assert_eq!(ids(&search("subject:ann")).len(), 0, "the sender is not in the subject");
    assert_eq!(ids(&search("to:vera")).len(), 2);
    assert_eq!(ids(&search("\"subject t1\"")), vec!["t1"], "a phrase, in order");
    assert_eq!(ids(&search("\"t1 subject\"")).len(), 0);
    assert_eq!(ids(&search("subject -t2")), vec!["t1"]);
    assert_eq!(ids(&search("t1 OR t2")).len(), 2);
    assert_eq!(ids(&search("has:attachment")), vec!["t2"], "filters alone, no words");
    assert_eq!(ids(&search("subject has:attachment")), vec!["t2"]);
    assert_eq!(ids(&search("after:2026-02-01")), vec!["t2"]);
    assert_eq!(ids(&search("subject before:2026-02-01")), vec!["t1"]);
    assert_eq!(ids(&search("after:2026-01-01 before:2026-12-31")).len(), 2);
    assert_eq!(search("subject")["handled"], true);

    let out = search("in:inbox subject");
    assert_eq!(out["handled"], false, "the provider's words are handed back");
    assert_eq!(ids(&out).len(), 0);
  }

  #[test]
  fn quoted_addresses_already_stored_are_repaired_once() {
    let db = db();
    let mut m = msg("m1", "t1", 1, 1_000, &["INBOX"]);
    m.to = vec![
      Address { name: "Ann Berg".into(), email: "'ann@x.test'".into() },
      Address { name: String::new(), email: "o'neill@w.test".into() },
    ];
    m.cc = vec![Address { name: String::new(), email: "'bo@y.test'".into() }];
    db.messages_upsert("vera@example.com", &[m]).unwrap();
    let conn = db.conn_mut();
    conn.execute_batch(
      "DELETE FROM settings WHERE key = 'repair.quoted-addresses';
       INSERT INTO source_contacts (source, account, email) VALUES
         ('history', 'vera@example.com', '''ann@x.test'''),
         ('history', 'vera@example.com', '''bo@y.test'''),
         ('history', 'vera@example.com', 'bo@y.test');",
    )
    .unwrap();
    repair_quoted_addresses(&conn).unwrap();
    let (to, cc): (String, String) = conn
      .query_row("SELECT to_json, cc_json FROM messages WHERE message_id = 'm1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
      .unwrap();
    let to: Vec<Address> = serde_json::from_str(&to).unwrap();
    let cc: Vec<Address> = serde_json::from_str(&cc).unwrap();
    assert_eq!(to[0], Address { name: "Ann Berg".into(), email: "ann@x.test".into() });
    assert_eq!(to[1].email, "o'neill@w.test");
    assert_eq!(cc[0].email, "bo@y.test");
    let mut stmt = conn.prepare("SELECT email FROM source_contacts ORDER BY email").unwrap();
    let emails: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(emails, vec!["ann@x.test", "bo@y.test"]);
  }

  #[test]
  fn html_is_read_as_words() {
    assert_eq!(squash(&strip_html("<div>Hi<br>there &amp; you</div><script>x()</script>")), "Hi there & you");
  }
}
