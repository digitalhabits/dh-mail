//! The bodies of the last year of an Exchange account, in the background
//! (phase 5 of `docs/mail-exchange-ews.md`, section 14.2).
//!
//! The Gmail worker keeps the bodies of the last year so that search reads
//! whole messages. This does the same for Exchange, slowly: the interface's
//! worker asks for one batch at a time, with a pause between batches, and
//! stops on a busy server.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::{DbResult, MailDb};
use crate::ews::{EwsAccounts, EwsClient, EwsResult};
use crate::ews_read::{keep_bodies, raw_messages};
use crate::secrets::Secrets;

/// Items larger than this are left for the open: the MIME carries the
/// files, and a background read must stay small.
pub const MAX_ITEM_BYTES: i64 = 2 * 1024 * 1024;

/// Items in one background batch: one `GetItem` call.
pub const BATCH: usize = 10;

impl MailDb {
  /// The rows of one account with no body yet, sent since `since` (ms),
  /// newest first, none larger than `max_size`. Any folder: an Exchange row
  /// has no IMAP uid, which the Gmail query asks for.
  pub fn exchange_bodies_missing(&self, account: &str, since: i64, max_size: i64, limit: usize) -> DbResult<Vec<String>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT message_id FROM messages
       WHERE account_email = ?1 AND body_state = 'none' AND sent_at >= ?2
         AND COALESCE(size_estimate, 0) <= ?3
         AND NOT EXISTS (SELECT 1 FROM message_bodies b
                         WHERE b.account_email = messages.account_email
                           AND b.message_id = messages.message_id)
       ORDER BY sent_at DESC LIMIT ?4",
    )?;
    let rows = stmt.query_map(rusqlite::params![account, since, max_size, limit as i64], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BodyBatch {
  /// Bodies kept in this batch.
  pub kept: usize,
  /// True when this batch was full, so more can be left.
  pub more: bool,
}

/// One batch: the missing bodies of the newest rows, from their MIME.
pub async fn fetch_batch(client: &EwsClient, db: &MailDb, account: &str, since: i64) -> EwsResult<(Vec<String>, BodyBatch)> {
  let ids = db
    .exchange_bodies_missing(account, since, MAX_ITEM_BYTES, BATCH)
    .map_err(|e| crate::ews::EwsError::Invalid(e.to_string()))?;
  if ids.is_empty() {
    return Ok((ids, BodyBatch { kept: 0, more: false }));
  }
  let raw = raw_messages(client, &ids).await?;
  let kept = keep_bodies(db, account, raw);
  Ok((ids.clone(), BodyBatch { kept, more: ids.len() == BATCH }))
}

pub mod commands {
  use super::*;

  /// One background batch of bodies, for rows sent since `since` (ms).
  #[tauri::command]
  pub async fn mail_ews_fetch_missing_bodies(
    app: AppHandle,
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    since: i64,
  ) -> Result<BodyBatch, String> {
    let email = account.trim().to_lowercase();
    let client = accounts.client(&secrets, &email).map_err(|e| e.to_string())?;
    let db = app.state::<MailDb>();
    let (_, batch) = fetch_batch(&client, &db, &email, since).await.map_err(|e| e.to_string())?;
    Ok(batch)
  }
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use serde_json::json;

  use super::*;
  use crate::ews_fixtures::{self as fx, Handler};

  fn row(n: u32, sent_at: i64, size: i64) -> serde_json::Value {
    json!({
      "messageId": fx::item_id(n), "threadId": fx::conversation_id(n), "fromName": "Dana Example",
      "fromEmail": "dana@example.com", "to": [], "cc": [], "bcc": [], "subject": format!("Plan {n}"),
      "snippet": "", "sentAt": sent_at, "sizeEstimate": size, "hasAttachments": false, "unread": false,
      "starred": false, "isDraft": false, "labels": ["INBOX"]
    })
  }

  #[test]
  fn the_newest_small_rows_with_no_body_come_first() {
    let db = MailDb::open_in_memory().unwrap();
    let rows = json!([row(1, 1_000, 500), row(2, 3_000, 500), row(3, 2_000, MAX_ITEM_BYTES + 1), row(4, 10, 500)]);
    db.call("messages.upsertMany", &json!({"account": "someone@example.com", "rows": rows})).unwrap();
    let missing = db.exchange_bodies_missing("someone@example.com", 100, MAX_ITEM_BYTES, 10).unwrap();
    // Newest first; the large one and the one before `since` are left.
    assert_eq!(missing, vec![fx::item_id(2), fx::item_id(1)]);
  }

  #[test]
  fn a_batch_keeps_bodies_and_says_when_none_are_left() {
    let db = MailDb::open_in_memory().unwrap();
    db.call("messages.upsertMany", &json!({"account": "someone@example.com", "rows": [row(1, 1_000, 500)]})).unwrap();
    let handler: Handler = Arc::new(|_, _| (200, fx::get_items(&[Some(fx::message_mime(1, &fx::raw_message(1)))])));
    let server = fx::serve(handler);
    let client = fx::client(&server.url);
    let run = |f| tauri::async_runtime::block_on(f);
    let (ids, first) = run(fetch_batch(&client, &db, "someone@example.com", 0)).unwrap();
    assert_eq!((ids.len(), first.kept, first.more), (1, 1, false));
    let (_, second) = run(fetch_batch(&client, &db, "someone@example.com", 0)).unwrap();
    assert_eq!((second.kept, second.more), (0, false));
    // One request only: the second batch found nothing to ask for.
    assert_eq!(server.requests.lock().unwrap().len(), 1);
  }
}
