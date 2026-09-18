//! The outbox: a message the reader has sent, until the server has it.
//!
//! A send is written here first and shown as sent. The worker carries it
//! over SMTP as soon as it is woken — before a first sync, and between its
//! batches — retries a connection that failed, gives a
//! refused message back to the reader with the server's words, and holds a
//! message with a time until that time. Gmail files the sent copy itself,
//! and the live sync brings it into the copy. See docs/mail-local-store.md,
//! section 7.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{now_ms, DbResult, MailDb};

pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email   TEXT NOT NULL,
    thread_id       TEXT,
    recipients_json TEXT NOT NULL,
    raw             TEXT NOT NULL,
    subject         TEXT NOT NULL DEFAULT '',
    to_json         TEXT NOT NULL DEFAULT '[]',
    send_at         INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    failed_at       INTEGER,
    draft_message_id TEXT
  );
  CREATE INDEX IF NOT EXISTS outbox_account_idx ON outbox (account_email, send_at);
"#;

/// Columns added after the table first shipped. A store from before them
/// gets them here; a store that has them answers "duplicate column",
/// which is the one error this is meant to meet.
pub fn migrate(conn: &rusqlite::Connection) -> DbResult<()> {
  let _ = conn.execute("ALTER TABLE outbox ADD COLUMN failed_at INTEGER", []);
  let _ = conn.execute("ALTER TABLE outbox ADD COLUMN draft_message_id TEXT", []);
  Ok(())
}

/// Tries at a connection that keeps failing before the message is given back.
pub const MAX_ATTEMPTS: i64 = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRow {
  pub id: i64,
  pub account: String,
  #[serde(default)]
  pub thread_id: Option<String>,
  pub recipients: Vec<String>,
  pub subject: String,
  pub to: Vec<String>,
  pub send_at: i64,
  pub attempts: i64,
  #[serde(default)]
  pub last_error: Option<String>,
  pub created_at: i64,
  /// Set once the message has been given up: it stays in the outbox for
  /// the reader to try again or delete, rather than vanishing.
  #[serde(default)]
  pub failed_at: Option<i64>,
  /// The draft this message was written from, discarded once it is sent.
  #[serde(default)]
  pub draft_message_id: Option<String>,
}

impl OutboxRow {
  /// "waiting" for its time, "sending" when due, "failed" when given up.
  pub fn status(&self, now: i64) -> &'static str {
    if self.failed_at.is_some() {
      "failed"
    } else if self.send_at > now {
      "waiting"
    } else {
      "sending"
    }
  }
}

impl MailDb {
  pub fn outbox_enqueue(
    &self,
    account: &str,
    thread_id: Option<&str>,
    recipients: &[String],
    raw: &str,
    subject: &str,
    to: &[String],
    send_at: Option<i64>,
    draft_message_id: Option<&str>,
  ) -> DbResult<i64> {
    let conn = self.conn_mut();
    let now = now_ms();
    conn.execute(
      "INSERT INTO outbox (account_email, thread_id, recipients_json, raw, subject, to_json, send_at, created_at, draft_message_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      params![
        account,
        thread_id,
        serde_json::to_string(recipients)?,
        raw,
        subject,
        serde_json::to_string(to)?,
        send_at.unwrap_or(now),
        now,
        draft_message_id,
      ],
    )?;
    Ok(conn.last_insert_rowid())
  }

  /// Rows whose time has come, oldest first, with their source.
  pub fn outbox_due(&self, account: &str, now: i64) -> DbResult<Vec<(OutboxRow, String)>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!(
      "{OUTBOX_SELECT}, raw FROM outbox WHERE account_email = ?1 AND send_at <= ?2 AND failed_at IS NULL ORDER BY send_at, id"
    ))?;
    let rows = stmt.query_map(params![account, now], |r| Ok((read_row(r)?, r.get::<_, String>(12)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  /// Every row of a mailbox, without the source, for the list of what is held.
  pub fn outbox_list(&self, account: &str) -> DbResult<Vec<OutboxRow>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!("{OUTBOX_SELECT} FROM outbox WHERE account_email = ?1 ORDER BY send_at, id"))?;
    let rows = stmt.query_map(params![account], read_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  pub fn outbox_done(&self, id: i64) -> DbResult<()> {
    let conn = self.conn_mut();
    conn.execute("DELETE FROM outbox WHERE id = ?1", params![id])?;
    Ok(())
  }

  /// One more failed try. True when the message has been given up: it
  /// stays in the outbox, marked failed, with the server's words on it.
  pub fn outbox_failed(&self, id: i64, error: &str, permanent: bool) -> DbResult<bool> {
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE outbox SET attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
      params![id, error],
    )?;
    let attempts: i64 = conn.query_row("SELECT attempts FROM outbox WHERE id = ?1", params![id], |r| r.get(0))?;
    if permanent || attempts >= MAX_ATTEMPTS {
      conn.execute("UPDATE outbox SET failed_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
      return Ok(true);
    }
    Ok(false)
  }

  pub fn outbox_cancel(&self, account: &str, id: i64) -> DbResult<bool> {
    let conn = self.conn_mut();
    let n = conn.execute("DELETE FROM outbox WHERE id = ?1 AND account_email = ?2", params![id, account])?;
    Ok(n > 0)
  }

  /// Send now — and for a message that was given up, try again from the
  /// start: the failure is cleared and the attempts begin at nought.
  pub fn outbox_send_now(&self, account: &str, id: i64) -> DbResult<bool> {
    let conn = self.conn_mut();
    let n = conn.execute(
      "UPDATE outbox SET send_at = ?3, failed_at = NULL, attempts = 0, last_error = NULL
       WHERE id = ?1 AND account_email = ?2",
      params![id, account, now_ms()],
    )?;
    Ok(n > 0)
  }

  pub fn outbox_count_due(&self, account: &str, now: i64) -> DbResult<i64> {
    let conn = self.conn_mut();
    Ok(conn.query_row(
      "SELECT COUNT(*) FROM outbox WHERE account_email = ?1 AND send_at <= ?2 AND failed_at IS NULL",
      params![account, now],
      |r| r.get(0),
    )?)
  }
}

const OUTBOX_SELECT: &str = "SELECT id, account_email, thread_id, recipients_json, subject, to_json, send_at, attempts, last_error, created_at, failed_at, draft_message_id";

fn read_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxRow> {
  let recipients: String = r.get(3)?;
  let to: String = r.get(5)?;
  Ok(OutboxRow {
    id: r.get(0)?,
    account: r.get(1)?,
    thread_id: r.get(2)?,
    recipients: serde_json::from_str(&recipients).unwrap_or_default(),
    subject: r.get(4)?,
    to: serde_json::from_str(&to).unwrap_or_default(),
    send_at: r.get(6)?,
    attempts: r.get(7)?,
    last_error: r.get(8)?,
    created_at: r.get(9)?,
    failed_at: r.get(10)?,
    draft_message_id: r.get(11)?,
  })
}

pub fn row_json(row: &OutboxRow) -> Value {
  let mut value = serde_json::to_value(row).unwrap_or(json!({}));
  if let Some(map) = value.as_object_mut() {
    map.insert("status".into(), json!(row.status(now_ms())));
  }
  value
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_held_message_waits_for_its_time_and_a_sent_one_goes() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let later = db
      .outbox_enqueue("vera@example.com", Some("1a"), &["ann@x.test".into()], "raw1", "Later", &["ann@x.test".into()], Some(now + 60_000), None)
      .unwrap();
    let soon = db
      .outbox_enqueue("vera@example.com", None, &["bo@x.test".into()], "raw2", "Now", &["bo@x.test".into()], None, None)
      .unwrap();
    let due = db.outbox_due("vera@example.com", now + 1).unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].0.id, soon);
    assert_eq!(due[0].1, "raw2");
    assert_eq!(db.outbox_list("vera@example.com").unwrap().len(), 2);
    assert!(db.outbox_send_now("vera@example.com", later).unwrap());
    assert_eq!(db.outbox_due("vera@example.com", now_ms() + 1).unwrap().len(), 2);
    db.outbox_done(soon).unwrap();
    assert!(!db.outbox_failed(later, "451 try later", false).unwrap());
    assert!(db.outbox_failed(later, "550 no", true).unwrap());
    // Given up, but kept: in the list as failed, no longer due, and a
    // "send now" starts it over.
    let left = db.outbox_list("vera@example.com").unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].status(now_ms()), "failed");
    assert_eq!(left[0].last_error.as_deref(), Some("550 no"));
    assert!(db.outbox_due("vera@example.com", now_ms() + 1).unwrap().is_empty());
    assert!(db.outbox_send_now("vera@example.com", later).unwrap());
    let again = db.outbox_due("vera@example.com", now_ms() + 1).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].0.attempts, 0);
    assert_eq!(again[0].0.status(now_ms()), "sending");
    assert!(db.outbox_cancel("vera@example.com", later).unwrap());
    assert!(db.outbox_list("vera@example.com").unwrap().is_empty());
  }
}
