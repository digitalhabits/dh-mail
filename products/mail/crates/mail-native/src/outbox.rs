//! The outbox: a message the reader has sent, until the server has it.
//!
//! A send is written here first and shown as sent. The worker carries it
//! over SMTP as soon as it is woken — before a first sync, and between its
//! batches — retries a connection that failed, gives a
//! refused message back to the reader with the server's words, and holds a
//! message with a time until that time. Gmail files the sent copy itself,
//! and the live sync brings it into the copy. See docs/mail-local-store.md,
//! section 7.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{now_ms, DbError, DbResult, MailDb};
use crate::lock::LockExt;

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
    draft_message_id TEXT,
    claimed_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS outbox_account_idx ON outbox (account_email, send_at);
"#;

/// Columns added after the table first shipped. A store from before them
/// gets them here. An upgrade step in schema.rs calls this.
pub fn add_columns(conn: &rusqlite::Connection) -> DbResult<()> {
  crate::schema::add_column(conn, "outbox", "failed_at", "INTEGER")?;
  crate::schema::add_column(conn, "outbox", "draft_message_id", "TEXT")?;
  crate::schema::add_column(conn, "outbox", "claimed_at", "INTEGER")?;
  Ok(())
}

/// Tries at a connection that keeps failing before the message is given back.
pub const MAX_ATTEMPTS: i64 = 20;

/// How long a claim on a message is believed.
///
/// A worker takes a message before it sends it, and lets go if the send
/// fails. Nothing lets go if the process dies mid-send, so a claim also
/// grows old: after this, another worker may take the message on. Long
/// enough for a big message on a slow line to go, short enough that a
/// crash does not leave a reply sitting there for the afternoon.
pub const CLAIM_STALE_MS: i64 = 5 * 60 * 1000;

/// The `claimed_at` value of a row that the server took, when the store
/// could not delete the row. A claim with this value never runs out.
pub const SENT_MARK: i64 = i64::MAX;

/// How many times `outbox_record_sent` tries to write, and the first pause.
const RECORD_TRIES: u32 = 4;
const RECORD_PAUSE: std::time::Duration = std::time::Duration::from_millis(50);

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
  /// "waiting" for its time, "sending" when due, "failed" when given up,
  /// "late" when a scheduled message waits for the person (`is_late`).
  pub fn status(&self, now: i64) -> &'static str {
    if self.failed_at.is_some() {
      "failed"
    } else if self.send_at > now {
      "waiting"
    } else if self.is_late(now) {
      "late"
    } else {
      "sending"
    }
  }

  /// A message sent later, more than an hour past its time: not sent
  /// without a question (docs/mail-send-later.md, 4.5). Only a message
  /// that was given a time: an ordinary send waiting for the network has
  /// its time on the moment it was written, and goes when it can.
  pub fn is_late(&self, now: i64) -> bool {
    self.send_at > self.created_at && now - self.send_at > crate::scheduled_sends::LATE_AFTER_MS
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
  ///
  /// A row that the server took is never in the answer, also if the store
  /// could not record the send (`outbox_record_sent`).
  pub fn outbox_due(&self, account: &str, now: i64) -> DbResult<Vec<(OutboxRow, String)>> {
    self.outbox_retry_unrecorded();
    let unrecorded = self.outbox_unrecorded.locked().clone();
    let conn = self.conn_mut();
    // Rows with the sent mark went out. Remove them now if the store lets us.
    if let Err(e) = conn.execute(
      "DELETE FROM outbox WHERE account_email = ?1 AND claimed_at = ?2",
      params![account, SENT_MARK],
    ) {
      log::warn!("[mail-outbox] could not remove sent rows: {e}");
    }
    let mut stmt = conn.prepare(&format!(
      "{OUTBOX_SELECT}, raw FROM outbox
       WHERE account_email = ?1 AND send_at <= ?2 AND failed_at IS NULL
         AND (claimed_at IS NULL OR claimed_at <= ?3)
         AND NOT (send_at > created_at AND send_at < ?4)
       ORDER BY send_at, id"
    ))?;
    let late_before = now - crate::scheduled_sends::LATE_AFTER_MS;
    let rows = stmt.query_map(params![account, now, now - CLAIM_STALE_MS, late_before], |r| {
      Ok((read_row(r)?, r.get::<_, String>(12)?))
    })?;
    let mut due: Vec<(OutboxRow, String)> = rows.collect::<Result<_, _>>()?;
    due.retain(|(row, _)| !unrecorded.contains(&row.id));
    Ok(due)
  }

  /// One message's source, for its words on its page (`outbox_words`).
  pub fn outbox_source(&self, account: &str, id: i64) -> DbResult<Option<String>> {
    let conn = self.conn_mut();
    Ok(
      conn
        .query_row(
          "SELECT raw FROM outbox WHERE account_email = ?1 AND id = ?2",
          params![account, id],
          |r| r.get::<_, String>(0),
        )
        .optional()?,
    )
  }

  /// Every row of a mailbox, without the source, for the list of what is held.
  pub fn outbox_list(&self, account: &str) -> DbResult<Vec<OutboxRow>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!("{OUTBOX_SELECT} FROM outbox WHERE account_email = ?1 ORDER BY send_at, id"))?;
    let rows = stmt.query_map(params![account], read_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  /// Take this message on, if nobody else has.
  ///
  /// The one thing standing between a reader and a message sent twice.
  /// Two workers can be looking at one store — a second copy of the app,
  /// or the same copy started again over a first that has not gone — and
  /// both used to find the same row due, open their own connection, and
  /// send it. The update is the race: SQLite lets one of them write, and
  /// the other is told it changed nothing and leaves the message alone.
  pub fn outbox_claim(&self, id: i64, now: i64) -> DbResult<bool> {
    let conn = self.conn_mut();
    let n = conn.execute(
      "UPDATE outbox SET claimed_at = ?2
       WHERE id = ?1 AND (claimed_at IS NULL OR claimed_at <= ?3)",
      params![id, now, now - CLAIM_STALE_MS],
    )?;
    Ok(n > 0)
  }

  /// Record that the server took this message, so that it never goes again.
  ///
  /// The send is done. Thus a failed write here is dangerous: the claim on
  /// the row runs out, and another pass sends the message a second time.
  /// This function tries these steps, in this sequence:
  ///
  /// 1. Delete the row. Try again some times, with a short pause.
  /// 2. If the delete fails, set the sent mark on the row. A row with the
  ///    sent mark is never due, and the next pass deletes it.
  /// 3. If the store refuses all writes, keep the id in memory. This store
  ///    then never gives the row again, and each pass tries the write again.
  ///
  /// The answer is an error only after step 3.
  pub fn outbox_record_sent(&self, id: i64) -> DbResult<()> {
    let mut last: Option<DbError> = None;
    for attempt in 0..RECORD_TRIES {
      if attempt > 0 {
        std::thread::sleep(RECORD_PAUSE * attempt);
      }
      match self.outbox_done(id) {
        Ok(()) => {
          self.outbox_unrecorded.locked().remove(&id);
          return Ok(());
        }
        Err(e) => last = Some(e),
      }
      if let Ok(true) = self.outbox_set_sent_mark(id) {
        self.outbox_unrecorded.locked().remove(&id);
        return Ok(());
      }
    }
    self.outbox_unrecorded.locked().insert(id);
    Err(last.unwrap_or_else(|| DbError::BadArgument("outbox id".into())))
  }

  /// Put the sent mark on a row. True if the row was there.
  fn outbox_set_sent_mark(&self, id: i64) -> DbResult<bool> {
    let conn = self.conn_mut();
    let n = conn.execute("UPDATE outbox SET claimed_at = ?2 WHERE id = ?1", params![id, SENT_MARK])?;
    Ok(n > 0)
  }

  /// Try again to record the sends that this store could not record.
  fn outbox_retry_unrecorded(&self) {
    let waiting: Vec<i64> = self.outbox_unrecorded.locked().iter().copied().collect();
    for id in waiting {
      let recorded = self.outbox_done(id).is_ok() || self.outbox_set_sent_mark(id).is_ok();
      if recorded {
        self.outbox_unrecorded.locked().remove(&id);
      }
    }
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
      "UPDATE outbox SET attempts = attempts + 1, last_error = ?2, claimed_at = NULL WHERE id = ?1",
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
      "UPDATE outbox SET send_at = ?3, failed_at = NULL, attempts = 0, last_error = NULL, claimed_at = NULL
       WHERE id = ?1 AND account_email = ?2 AND (claimed_at IS NULL OR claimed_at <> ?4)",
      params![id, account, now_ms(), SENT_MARK],
    )?;
    Ok(n > 0)
  }

  /// Messages given a time that is still to come, in every mailbox, and the
  /// first time. For the question on Quit: only this computer sends them.
  pub fn outbox_scheduled_waiting(&self, now: i64) -> DbResult<(i64, Option<i64>)> {
    let conn = self.conn_mut();
    Ok(conn.query_row(
      "SELECT COUNT(*), MIN(send_at) FROM outbox WHERE send_at > created_at AND send_at > ?1 AND failed_at IS NULL",
      params![now],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
  }

  pub fn outbox_count_due(&self, account: &str, now: i64) -> DbResult<i64> {
    let conn = self.conn_mut();
    Ok(conn.query_row(
      // Claimed or not: a message being sent is still one the reader is
      // waiting on, and the count is for them.
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

/// What a held message says: its words and its Cc, read from its source.
///
/// A new message sent later from a Gmail mailbox with a local copy waits
/// here, and its page showed an empty bubble and no Edit, because the list
/// carries no source (Ulrik, 2026-10-20). The words carry the signature,
/// which was put on when the message was written.
pub fn outbox_words(raw: &str) -> Value {
  let parsed = crate::mime::parse_message(raw.as_bytes());
  let cc: Vec<String> = crate::imap::header(&parsed.headers, "cc")
    .map(crate::imap::parse_address_list)
    .unwrap_or_default()
    .into_iter()
    .map(|m| m.email)
    .filter(|e| !e.is_empty())
    .collect();
  json!({ "text": parsed.text.unwrap_or_default(), "html": parsed.html, "cc": cc })
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
  fn a_held_message_says_its_words_and_cc() {
    let raw = "From: Vera <vera@example.com>\r\nTo: ann@x.test\r\nCc: Bo <bo@x.test>\r\nSubject: Later\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"b\"\r\n\r\n--b\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVqIGFsbGU=\r\n--b\r\nContent-Type: text/html; charset=\"UTF-8\"\r\n\r\n<p>Hej alle</p>\r\n--b--\r\n";
    let words = outbox_words(raw);
    assert_eq!(words["text"], "Hej alle");
    assert!(words["html"].as_str().unwrap_or("").contains("<p>Hej alle</p>"));
    assert_eq!(words["cc"], json!(["bo@x.test"]));
    let db = MailDb::open_in_memory().unwrap();
    let id = db.outbox_enqueue("vera@example.com", None, &["ann@x.test".into()], raw, "Later", &["ann@x.test".into()], Some(now_ms() + 60_000), None).unwrap();
    assert_eq!(db.outbox_source("vera@example.com", id).unwrap().as_deref(), Some(raw));
    assert_eq!(db.outbox_source("other@example.com", id).unwrap(), None);
  }

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

  #[test]
  fn a_scheduled_message_seventy_minutes_late_waits_and_an_ordinary_send_goes() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let ordinary = db
      .outbox_enqueue("vera@example.com", None, &["ann@x.test".into()], "raw1", "Now", &["ann@x.test".into()], None, None)
      .unwrap();
    let scheduled = db
      .outbox_enqueue("vera@example.com", None, &["bo@x.test".into()], "raw2", "Later", &["bo@x.test".into()], Some(now + 1_000), None)
      .unwrap();
    // Seventy-one minutes on: the computer was asleep.
    let then = now + 71 * 60_000;
    let due: Vec<i64> = db.outbox_due("vera@example.com", then).unwrap().iter().map(|r| r.0.id).collect();
    assert_eq!(due, vec![ordinary]);
    let rows = db.outbox_list("vera@example.com").unwrap();
    assert_eq!(rows.iter().find(|r| r.id == scheduled).unwrap().status(then), "late");
    // Fifty minutes late still goes.
    let soon = now + 51 * 60_000;
    assert_eq!(db.outbox_due("vera@example.com", soon).unwrap().len(), 2);
    // Send now makes the late one due.
    assert!(db.outbox_send_now("vera@example.com", scheduled).unwrap());
    assert!(db.outbox_due("vera@example.com", now_ms() + 1).unwrap().iter().any(|r| r.0.id == scheduled));
  }

  #[test]
  fn one_message_is_sent_by_one_worker() {
    let db = MailDb::open_in_memory().unwrap();
    let id = db
      .outbox_enqueue("vera@example.com", None, &["ann@x.test".into()], "raw", "Hello", &["ann@x.test".into()], None, None)
      .unwrap();
    // Read after the message is queued: Windows' clock moves in steps of
    // about 15 ms, so a time read before could fall before the message's own
    // and count it as not yet due (CI, 2026-10-30).
    let now = now_ms();

    // Two workers, one message: the first takes it, the second is told it
    // changed nothing and leaves it alone.
    assert!(db.outbox_claim(id, now).unwrap());
    assert!(!db.outbox_claim(id, now).unwrap());
    // And it is no longer offered to the pass that comes next.
    assert!(db.outbox_due("vera@example.com", now).unwrap().is_empty());
    // But the reader is still waiting on it, so it still counts.
    assert_eq!(db.outbox_count_due("vera@example.com", now).unwrap(), 1);

    // A send that failed lets the message go, for the next try.
    assert!(!db.outbox_failed(id, "451 try later", false).unwrap());
    assert_eq!(db.outbox_due("vera@example.com", now_ms()).unwrap().len(), 1);

    // A claim nobody let go of — the process died mid-send — is believed
    // for a while and then is not.
    assert!(db.outbox_claim(id, now).unwrap());
    assert!(db.outbox_due("vera@example.com", now + CLAIM_STALE_MS - 1).unwrap().is_empty());
    assert_eq!(db.outbox_due("vera@example.com", now + CLAIM_STALE_MS).unwrap().len(), 1);
    assert!(db.outbox_claim(id, now + CLAIM_STALE_MS).unwrap());

    // Sent, and gone.
    db.outbox_done(id).unwrap();
    assert!(db.outbox_list("vera@example.com").unwrap().is_empty());
  }
  const ME: &str = "reader@example.com";

  fn refuse(db: &MailDb, what: &str) {
    db.conn_mut()
      .execute_batch(&format!(
        "CREATE TEMP TRIGGER refuse_{what} BEFORE {what} ON outbox BEGIN SELECT RAISE(FAIL, 'test: the disk is full'); END;"
      ))
      .unwrap();
  }

  fn allow(db: &MailDb, what: &str) {
    db.conn_mut().execute_batch(&format!("DROP TRIGGER temp.refuse_{what};")).unwrap();
  }

  fn claimed_message(db: &MailDb, now: i64) -> i64 {
    let id = db
      .outbox_enqueue(ME, None, &["friend@example.org".into()], "raw", "Hello", &[], None, None)
      .unwrap();
    assert!(db.outbox_claim(id, now).unwrap());
    id
  }

  #[test]
  fn a_sent_message_does_not_go_again_when_the_store_refuses_the_delete() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = claimed_message(&db, now);
    refuse(&db, "DELETE");

    // The delete fails, so the row gets the sent mark.
    db.outbox_record_sent(id).unwrap();
    let after_the_claim = now + CLAIM_STALE_MS + 1;
    assert!(db.outbox_due(ME, after_the_claim).unwrap().is_empty());
    assert!(!db.outbox_claim(id, after_the_claim).unwrap());
    assert!(!db.outbox_send_now(ME, id).unwrap(), "Send now does not send it again");

    // When the store lets us, the next pass removes the row.
    allow(&db, "DELETE");
    assert!(db.outbox_due(ME, after_the_claim).unwrap().is_empty());
    assert!(db.outbox_list(ME).unwrap().is_empty());
  }

  #[test]
  fn a_sent_message_does_not_go_again_when_the_store_refuses_every_write() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = claimed_message(&db, now);
    let other = db
      .outbox_enqueue(ME, None, &["friend@example.org".into()], "raw2", "Second", &[], None, None)
      .unwrap();
    refuse(&db, "DELETE");
    refuse(&db, "UPDATE");

    assert!(db.outbox_record_sent(id).is_err());
    // The claim runs out, but this store does not give the row again.
    // Other rows still go.
    let after_the_claim = now + CLAIM_STALE_MS + 1;
    let due: Vec<i64> = db.outbox_due(ME, after_the_claim).unwrap().iter().map(|r| r.0.id).collect();
    assert_eq!(due, vec![other]);

    // When the store lets us write, the next pass records the send.
    allow(&db, "DELETE");
    allow(&db, "UPDATE");
    let due: Vec<i64> = db.outbox_due(ME, after_the_claim).unwrap().iter().map(|r| r.0.id).collect();
    assert_eq!(due, vec![other]);
    assert!(db.outbox_unrecorded.locked().is_empty());
    let left: Vec<i64> = db.outbox_list(ME).unwrap().iter().map(|r| r.id).collect();
    assert_eq!(left, vec![other]);
  }

  #[test]
  fn a_sent_message_is_removed_when_the_store_takes_the_write() {
    let db = MailDb::open_in_memory().unwrap();
    let id = claimed_message(&db, now_ms());
    db.outbox_record_sent(id).unwrap();
    assert!(db.outbox_list(ME).unwrap().is_empty());
  }
}
