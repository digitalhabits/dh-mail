//! Messages that this computer sends later, from a draft on the server.
//!
//! See docs/mail-send-later.md. "Send later" on a Gmail (API) or an
//! Exchange mailbox saves the message as a normal draft on the server, and
//! this table keeps only which draft, and when. At that time the page sends
//! the draft. Sending a draft takes it out of Drafts, so a second try — a
//! retry after a crash, or a second copy of the app — finds no draft and
//! sends nothing. If the app never runs again, the message is still a draft.
//!
//! The rows here are claimed before a send, as the outbox's are, so two
//! workers on one store never both send a row.
//!
//! The late rule: a row more than `LATE_AFTER_MS` past its time is not sent
//! without a question. It is listed as "late", and the person chooses Send
//! now or Keep as draft. A message meant for 09:00 must not go at 15:00
//! because the computer was asleep.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now_ms, DbResult, MailDb};

/// Columns added after the table first shipped to a dev build. An upgrade
/// step in schema.rs calls this.
pub fn add_columns(conn: &rusqlite::Connection) -> crate::db::DbResult<()> {
  crate::schema::add_column(conn, "scheduled_sends", "bcc_json", "TEXT NOT NULL DEFAULT '[]'")
}

pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS scheduled_sends (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email  TEXT NOT NULL,
    provider       TEXT NOT NULL,
    draft_id       TEXT NOT NULL,
    thread_id      TEXT,
    subject        TEXT NOT NULL DEFAULT '',
    to_json        TEXT NOT NULL DEFAULT '[]',
    cc_json        TEXT NOT NULL DEFAULT '[]',
    bcc_json       TEXT NOT NULL DEFAULT '[]',
    body_text      TEXT NOT NULL DEFAULT '',
    body_html      TEXT,
    send_at        INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    claimed_at     INTEGER,
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    refused_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS scheduled_sends_time_idx ON scheduled_sends (send_at);
  CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sends_draft_idx ON scheduled_sends (account_email, draft_id);
"#;

/// Past its time by more than this, a message waits for the person
/// (Ulrik, 2026-10-17: 30 minutes; 2026-10-20: an hour).
pub const LATE_AFTER_MS: i64 = 60 * 60 * 1000;

/// How long a claim is believed. As the outbox's: a worker that died
/// mid-send lets go of nothing, so a claim also grows old.
pub const CLAIM_STALE_MS: i64 = crate::outbox::CLAIM_STALE_MS;

/// Told to the page when the rows change, so the lists read them again.
pub const CHANGED_EVENT: &str = "mail-scheduled-changed";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledSend {
  pub id: i64,
  pub account: String,
  /// "gmail" or "exchange": which server's draft this is.
  pub provider: String,
  pub draft_id: String,
  #[serde(default)]
  pub thread_id: Option<String>,
  pub subject: String,
  pub to: Vec<String>,
  #[serde(default)]
  pub cc: Vec<String>,
  /// Kept for Edit only: the draft on the server carries its own Bcc.
  #[serde(default)]
  pub bcc: Vec<String>,
  /// The words, for the list's preview and for Edit, which opens them in
  /// the composer. The message itself is the draft on the server.
  #[serde(default)]
  pub body_text: String,
  #[serde(default)]
  pub body_html: Option<String>,
  pub send_at: i64,
  pub created_at: i64,
  pub attempts: i64,
  #[serde(default)]
  pub last_error: Option<String>,
  /// The server refused the message. It stays, with the server's words,
  /// for the person to edit or delete; it is never tried again by itself.
  #[serde(default)]
  pub refused_at: Option<i64>,
}

impl ScheduledSend {
  /// "waiting" for its time, "sending" when due, "late" when it waits for
  /// the person, "refused" when the server said no.
  pub fn status(&self, now: i64) -> &'static str {
    if self.refused_at.is_some() {
      "refused"
    } else if self.send_at > now {
      "waiting"
    } else if now - self.send_at > LATE_AFTER_MS {
      "late"
    } else {
      "sending"
    }
  }
}

/// What a failed send means. The page decides from the server's answer.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SendFailure {
  /// The draft is not there: sent or deleted elsewhere, or our own earlier
  /// try went through. The schedule is dropped and nothing else is sent.
  Gone,
  /// Network, timeout, signed out, a busy server: try again later.
  Retry,
  /// The server will not send this message. Keep it for the person.
  Refused,
}

/// What the page gives to schedule a draft.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewScheduled {
  pub provider: String,
  pub draft_id: String,
  #[serde(default)]
  pub thread_id: Option<String>,
  #[serde(default)]
  pub subject: String,
  #[serde(default)]
  pub to: Vec<String>,
  #[serde(default)]
  pub cc: Vec<String>,
  #[serde(default)]
  pub bcc: Vec<String>,
  #[serde(default)]
  pub body_text: String,
  #[serde(default)]
  pub body_html: Option<String>,
  pub send_at: i64,
}

impl MailDb {
  /// Schedule a draft. A draft scheduled again gets its new time.
  pub fn scheduled_add(&self, account: &str, new: &NewScheduled) -> DbResult<i64> {
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO scheduled_sends (account_email, provider, draft_id, thread_id, subject, to_json, cc_json, body_text, body_html, send_at, created_at, bcc_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT (account_email, draft_id) DO UPDATE SET
         send_at = excluded.send_at, subject = excluded.subject, to_json = excluded.to_json,
         cc_json = excluded.cc_json, bcc_json = excluded.bcc_json, body_text = excluded.body_text, body_html = excluded.body_html,
         thread_id = excluded.thread_id, claimed_at = NULL, attempts = 0,
         last_error = NULL, refused_at = NULL",
      params![
        account,
        new.provider,
        new.draft_id,
        new.thread_id,
        new.subject,
        serde_json::to_string(&new.to)?,
        serde_json::to_string(&new.cc)?,
        new.body_text,
        new.body_html,
        new.send_at,
        now_ms(),
        serde_json::to_string(&new.bcc)?
      ],
    )?;
    let draft_id = new.draft_id.as_str();
    Ok(conn.query_row(
      "SELECT id FROM scheduled_sends WHERE account_email = ?1 AND draft_id = ?2",
      params![account, draft_id],
      |r| r.get(0),
    )?)
  }

  /// Every row, oldest time first. One mailbox, or all when `account` is None.
  pub fn scheduled_list(&self, account: Option<&str>) -> DbResult<Vec<ScheduledSend>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!(
      "{SELECT} FROM scheduled_sends WHERE (?1 IS NULL OR account_email = ?1) ORDER BY send_at, id"
    ))?;
    let rows = stmt.query_map(params![account], read_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  /// Take every row whose time has come and that is not late, refused, or
  /// held by another worker. A row is in the answer only if this call
  /// claimed it, so two callers never get the same row.
  pub fn scheduled_take_due(&self, now: i64) -> DbResult<Vec<ScheduledSend>> {
    let conn = self.conn_mut();
    let candidates: Vec<ScheduledSend> = {
      let mut stmt = conn.prepare(&format!(
        "{SELECT} FROM scheduled_sends
         WHERE send_at <= ?1 AND send_at >= ?2 AND refused_at IS NULL
           AND (claimed_at IS NULL OR claimed_at <= ?3)
         ORDER BY send_at, id"
      ))?;
      let rows = stmt.query_map(params![now, now - LATE_AFTER_MS, now - CLAIM_STALE_MS], read_row)?;
      rows.collect::<Result<_, _>>()?
    };
    let mut taken = Vec::new();
    for row in candidates {
      let n = conn.execute(
        "UPDATE scheduled_sends SET claimed_at = ?2
         WHERE id = ?1 AND (claimed_at IS NULL OR claimed_at <= ?3)",
        params![row.id, now, now - CLAIM_STALE_MS],
      )?;
      if n > 0 {
        taken.push(row);
      }
    }
    Ok(taken)
  }

  /// Sent. The row goes.
  pub fn scheduled_done(&self, id: i64) -> DbResult<()> {
    self.conn_mut().execute("DELETE FROM scheduled_sends WHERE id = ?1", params![id])?;
    Ok(())
  }

  /// A send that did not go. See `SendFailure`.
  pub fn scheduled_failed(&self, id: i64, failure: SendFailure, error: &str) -> DbResult<()> {
    let conn = self.conn_mut();
    match failure {
      SendFailure::Gone => {
        conn.execute("DELETE FROM scheduled_sends WHERE id = ?1", params![id])?;
      }
      SendFailure::Retry => {
        conn.execute(
          "UPDATE scheduled_sends SET claimed_at = NULL, attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
          params![id, error],
        )?;
      }
      SendFailure::Refused => {
        conn.execute(
          "UPDATE scheduled_sends SET claimed_at = NULL, attempts = attempts + 1, last_error = ?2, refused_at = ?3
           WHERE id = ?1",
          params![id, error, now_ms()],
        )?;
      }
    }
    Ok(())
  }

  /// Keep as draft: the schedule goes, the draft stays on the server.
  pub fn scheduled_cancel(&self, account: &str, id: i64) -> DbResult<Option<ScheduledSend>> {
    let conn = self.conn_mut();
    let row = conn
      .query_row(&format!("{SELECT} FROM scheduled_sends WHERE id = ?1 AND account_email = ?2"), params![id, account], read_row)
      .ok();
    conn.execute("DELETE FROM scheduled_sends WHERE id = ?1 AND account_email = ?2", params![id, account])?;
    Ok(row)
  }

  /// Send now: the time becomes now, and a late or refused row is tried
  /// again from the start. The next take sends it.
  pub fn scheduled_send_now(&self, account: &str, id: i64) -> DbResult<bool> {
    let n = self.conn_mut().execute(
      "UPDATE scheduled_sends SET send_at = ?3, refused_at = NULL, attempts = 0, last_error = NULL, claimed_at = NULL
       WHERE id = ?1 AND account_email = ?2",
      params![id, account, now_ms()],
    )?;
    Ok(n > 0)
  }

  /// Change the time. A late or refused row is given its new chance.
  pub fn scheduled_reschedule(&self, account: &str, id: i64, send_at: i64) -> DbResult<bool> {
    let n = self.conn_mut().execute(
      "UPDATE scheduled_sends SET send_at = ?3, refused_at = NULL, attempts = 0, last_error = NULL, claimed_at = NULL
       WHERE id = ?1 AND account_email = ?2",
      params![id, account, send_at],
    )?;
    Ok(n > 0)
  }

  /// How many messages only this computer will send, and the first time.
  /// For the question on Quit. Refused rows count: they are still waiting
  /// on the person.
  pub fn scheduled_waiting(&self) -> DbResult<(i64, Option<i64>)> {
    let conn = self.conn_mut();
    Ok(conn.query_row("SELECT COUNT(*), MIN(send_at) FROM scheduled_sends", [], |r| Ok((r.get(0)?, r.get(1)?)))?)
  }
}

/// Everything only this computer sends later — scheduled drafts and the
/// outbox's messages with a time — and the first time. Outlook's scheduled
/// mail is not here: Microsoft's server holds and sends it.
pub fn waiting_here(db: &MailDb, now: i64) -> DbResult<(i64, Option<i64>)> {
  let (drafts, first_draft) = db.scheduled_waiting()?;
  let (outbox, first_outbox) = db.outbox_scheduled_waiting(now)?;
  let first = match (first_draft, first_outbox) {
    (Some(a), Some(b)) => Some(a.min(b)),
    (a, b) => a.or(b),
  };
  Ok((drafts + outbox, first))
}

/// The question on Quit now, for this store. None: quit without asking.
pub fn quit_question_now(db: &MailDb) -> DbResult<Option<String>> {
  let now = now_ms();
  let (count, first) = waiting_here(db, now)?;
  Ok(quit_question(count, first, now))
}

/// The question on Quit, or None when nothing waits on this computer.
pub fn quit_question(count: i64, first: Option<i64>, now: i64) -> Option<String> {
  if count <= 0 {
    return None;
  }
  let what = if count == 1 { "1 message is".to_string() } else { format!("{count} messages are") };
  let when = first.map(|at| {
    let minutes = ((at - now).max(0) + 59_999) / 60_000;
    let gap = if minutes <= 1 {
      "now".to_string()
    } else if minutes < 60 {
      format!("in {minutes} minutes")
    } else if minutes < 48 * 60 {
      let hours = (minutes + 30) / 60;
      if hours == 1 { "in 1 hour".to_string() } else { format!("in {hours} hours") }
    } else {
      format!("in {} days", (minutes + 12 * 60) / (24 * 60))
    };
    if count == 1 { format!(" It is due {gap}.") } else { format!(" The first is due {gap}.") }
  });
  Some(format!(
    "{what} scheduled.{} Mail sends them only while it is open. If you quit, they wait as drafts until you open Mail again.",
    when.unwrap_or_default()
  ))
}

const SELECT: &str = "SELECT id, account_email, provider, draft_id, thread_id, subject, to_json, send_at, created_at, attempts, last_error, refused_at, cc_json, body_text, body_html, bcc_json";

fn read_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledSend> {
  let to: String = r.get(6)?;
  Ok(ScheduledSend {
    id: r.get(0)?,
    account: r.get(1)?,
    provider: r.get(2)?,
    draft_id: r.get(3)?,
    thread_id: r.get(4)?,
    subject: r.get(5)?,
    to: serde_json::from_str(&to).unwrap_or_default(),
    send_at: r.get(7)?,
    created_at: r.get(8)?,
    attempts: r.get(9)?,
    last_error: r.get(10)?,
    refused_at: r.get(11)?,
    cc: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
    body_text: r.get(13)?,
    body_html: r.get(14)?,
    bcc: serde_json::from_str(&r.get::<_, String>(15)?).unwrap_or_default(),
  })
}

pub fn row_json(row: &ScheduledSend, now: i64) -> Value {
  let mut value = serde_json::to_value(row).unwrap_or(json!({}));
  if let Some(map) = value.as_object_mut() {
    map.insert("status".into(), json!(row.status(now)));
  }
  value
}

fn changed(app: &AppHandle) {
  let _ = app.emit(CHANGED_EVENT, ());
}

fn key(account: &str) -> String {
  account.trim().to_lowercase()
}

// ---------------------------------------------------------------------------
// Commands. The page saves the draft and sends it; these keep the schedule.
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn mail_scheduled_add(app: AppHandle, account: String, message: NewScheduled) -> Result<i64, String> {
  let mut message = message;
  if !matches!(message.provider.as_str(), "gmail" | "exchange") {
    return Err(format!("\"{}\" does not send from a draft", message.provider));
  }
  message.draft_id = message.draft_id.trim().to_string();
  if message.draft_id.is_empty() {
    return Err("a scheduled message needs its draft".into());
  }
  if message.send_at <= now_ms() {
    return Err("that time has passed".into());
  }
  let db = app.state::<MailDb>();
  let id = db.scheduled_add(&key(&account), &message).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(id)
}

/// One mailbox's rows, or every mailbox's when `account` is left out.
#[tauri::command(async)]
pub fn mail_scheduled_list(app: AppHandle, account: Option<String>) -> Result<Vec<Value>, String> {
  let db = app.state::<MailDb>();
  let account = account.map(|a| key(&a));
  let rows = db.scheduled_list(account.as_deref()).map_err(|e| e.to_string())?;
  let now = now_ms();
  Ok(rows.iter().map(|r| row_json(r, now)).collect())
}

/// The rows to send now, claimed for this caller.
#[tauri::command(async)]
pub fn mail_scheduled_take_due(app: AppHandle) -> Result<Vec<Value>, String> {
  let db = app.state::<MailDb>();
  let now = now_ms();
  let rows = db.scheduled_take_due(now).map_err(|e| e.to_string())?;
  Ok(rows.iter().map(|r| row_json(r, now)).collect())
}

#[tauri::command(async)]
pub fn mail_scheduled_done(app: AppHandle, id: i64) -> Result<(), String> {
  app.state::<MailDb>().scheduled_done(id).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(())
}

#[tauri::command(async)]
pub fn mail_scheduled_failed(app: AppHandle, id: i64, failure: SendFailure, error: String) -> Result<(), String> {
  app.state::<MailDb>().scheduled_failed(id, failure, &error).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(())
}

/// Keep as draft. Answers the row that was dropped, for an Edit that opens
/// its draft next.
#[tauri::command(async)]
pub fn mail_scheduled_cancel(app: AppHandle, account: String, id: i64) -> Result<Option<Value>, String> {
  let row = app.state::<MailDb>().scheduled_cancel(&key(&account), id).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(row.map(|r| row_json(&r, now_ms())))
}

#[tauri::command(async)]
pub fn mail_scheduled_send_now(app: AppHandle, account: String, id: i64) -> Result<bool, String> {
  let found = app.state::<MailDb>().scheduled_send_now(&key(&account), id).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(found)
}

#[tauri::command(async)]
pub fn mail_scheduled_reschedule(app: AppHandle, account: String, id: i64, send_at: i64) -> Result<bool, String> {
  if send_at <= now_ms() {
    return Err("that time has passed".into());
  }
  let found = app.state::<MailDb>().scheduled_reschedule(&key(&account), id, send_at).map_err(|e| e.to_string())?;
  changed(&app);
  Ok(found)
}

#[cfg(test)]
mod tests {
  use super::*;

  const A: &str = "vera@example.com";

  fn new(provider: &str, draft: &str, send_at: i64) -> NewScheduled {
    NewScheduled {
      provider: provider.into(),
      draft_id: draft.into(),
      thread_id: Some("t1".into()),
      subject: "Hello".into(),
      to: vec!["ann@x.test".into()],
      bcc: vec!["kim@x.test".into()],
      body_text: "See you then.".into(),
      send_at,
      ..Default::default()
    }
  }

  fn add(db: &MailDb, draft: &str, send_at: i64) -> i64 {
    db.scheduled_add(A, &new("gmail", draft, send_at)).unwrap()
  }

  #[test]
  fn a_row_waits_for_its_time_and_then_is_taken_once() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now + 60_000);
    assert!(db.scheduled_take_due(now).unwrap().is_empty());
    let taken = db.scheduled_take_due(now + 61_000).unwrap();
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].id, id);
    // A second worker at the same moment gets nothing.
    assert!(db.scheduled_take_due(now + 61_000).unwrap().is_empty());
    db.scheduled_done(id).unwrap();
    assert!(db.scheduled_list(None).unwrap().is_empty());
  }

  #[test]
  fn a_claim_older_than_five_minutes_can_be_taken_again() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    add(&db, "r-1", now - 1_000);
    assert_eq!(db.scheduled_take_due(now).unwrap().len(), 1);
    assert!(db.scheduled_take_due(now + CLAIM_STALE_MS - 1).unwrap().is_empty());
    // The worker died mid-send. Within the late window, another takes it.
    assert_eq!(db.scheduled_take_due(now + CLAIM_STALE_MS + 1).unwrap().len(), 1);
  }

  #[test]
  fn a_draft_gone_drops_the_row_and_nothing_else_is_tried() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now - 1_000);
    db.scheduled_take_due(now).unwrap();
    db.scheduled_failed(id, SendFailure::Gone, "404").unwrap();
    assert!(db.scheduled_list(None).unwrap().is_empty());
    assert!(db.scheduled_take_due(now + 10 * 60_000).unwrap().is_empty());
  }

  #[test]
  fn a_network_failure_lets_go_and_the_next_take_tries_again() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now - 1_000);
    db.scheduled_take_due(now).unwrap();
    db.scheduled_failed(id, SendFailure::Retry, "timed out").unwrap();
    let again = db.scheduled_take_due(now + 1).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].attempts, 1);
    assert_eq!(again[0].last_error.as_deref(), Some("timed out"));
  }

  #[test]
  fn a_refused_message_stays_and_is_not_tried_by_itself() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now - 1_000);
    db.scheduled_take_due(now).unwrap();
    db.scheduled_failed(id, SendFailure::Refused, "550 no such user").unwrap();
    let rows = db.scheduled_list(Some(A)).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status(now), "refused");
    assert!(db.scheduled_take_due(now + 1).unwrap().is_empty());
    // Send now starts it over.
    assert!(db.scheduled_send_now(A, id).unwrap());
    assert_eq!(db.scheduled_take_due(now_ms() + 1).unwrap().len(), 1);
  }

  #[test]
  fn fifty_minutes_late_goes_seventy_minutes_late_waits_for_the_person() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let on_time = add(&db, "r-50", now - 50 * 60_000);
    let late = add(&db, "r-70", now - 70 * 60_000);
    let taken = db.scheduled_take_due(now).unwrap();
    assert_eq!(taken.iter().map(|r| r.id).collect::<Vec<_>>(), vec![on_time]);
    let rows = db.scheduled_list(None).unwrap();
    let late_row = rows.iter().find(|r| r.id == late).unwrap();
    assert_eq!(late_row.status(now), "late");
    // Send now makes it due again; Keep as draft drops it.
    assert!(db.scheduled_send_now(A, late).unwrap());
    assert!(db.scheduled_take_due(now_ms() + 1).unwrap().iter().any(|r| r.id == late));
  }

  #[test]
  fn keep_as_draft_drops_the_schedule_and_answers_the_draft() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now + 60_000);
    let dropped = db.scheduled_cancel(A, id).unwrap().unwrap();
    assert_eq!(dropped.draft_id, "r-1");
    assert_eq!(dropped.body_text, "See you then.");
    assert_eq!(dropped.bcc, vec!["kim@x.test".to_string()]);
    assert!(db.scheduled_list(None).unwrap().is_empty());
    // Not another mailbox's row.
    let other = db.scheduled_add("bo@example.com", &new("exchange", "AAMk1", now + 60_000)).unwrap();
    assert!(db.scheduled_cancel(A, other).unwrap().is_none());
    assert_eq!(db.scheduled_list(None).unwrap().len(), 1);
  }

  #[test]
  fn quit_asks_only_when_this_computer_has_something_to_send() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    assert_eq!(waiting_here(&db, now).unwrap(), (0, None));
    assert!(quit_question(0, None, now).is_none());
    add(&db, "r-1", now + 3 * 60 * 60_000);
    // An ordinary send in the outbox is on its way: no question for it.
    db.outbox_enqueue(A, None, &["ann@x.test".into()], "raw", "Now", &[], None, None).unwrap();
    // A message the outbox holds for a time counts.
    db.outbox_enqueue(A, None, &["bo@x.test".into()], "raw", "Later", &[], Some(now + 20 * 60_000), None).unwrap();
    let (count, first) = waiting_here(&db, now).unwrap();
    assert_eq!((count, first), (2, Some(now + 20 * 60_000)));
    let text = quit_question(count, first, now).unwrap();
    assert!(text.starts_with("2 messages are scheduled. The first is due in 20 minutes."), "{text}");
    assert_eq!(
      quit_question(1, Some(now + 3 * 60 * 60_000), now).unwrap().split(". Mail").next().unwrap(),
      "1 message is scheduled. It is due in 3 hours"
    );
  }

  #[test]
  fn a_new_time_moves_it_and_a_late_one_is_given_its_chance_again() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let id = add(&db, "r-1", now - 70 * 60_000);
    assert_eq!(db.scheduled_list(None).unwrap()[0].status(now), "late");
    assert!(db.scheduled_reschedule(A, id, now + 60_000).unwrap());
    let row = &db.scheduled_list(None).unwrap()[0];
    assert_eq!((row.send_at, row.status(now)), (now + 60_000, "waiting"));
    assert!(!db.scheduled_reschedule("bo@example.com", id, now + 120_000).unwrap());
  }

  #[test]
  fn the_same_draft_scheduled_again_moves_its_time() {
    let db = MailDb::open_in_memory().unwrap();
    let now = now_ms();
    let first = add(&db, "r-1", now + 60_000);
    let second = add(&db, "r-1", now + 120_000);
    assert_eq!(first, second);
    let rows = db.scheduled_list(None).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].send_at, now + 120_000);
    assert_eq!(db.scheduled_waiting().unwrap(), (1, Some(now + 120_000)));
  }
}
