//! Import of a mail state snapshot that an earlier host kept on a server.
//!
//! On the first launch with the local store, an app that kept mail state on
//! a server can ask it for what it held for this person — mailboxes, snoozes, conversations, mail
//! settings — and writes it here. Every insert is `OR IGNORE`, so a row the
//! store already has stays as it is, and a second import is a no-op.
//!
//! Tokens are not part of a snapshot. A mailbox row arrives with no token,
//! and the interface asks the reader to sign that mailbox in again.
//!
//! This is not a store operation. `MAIL_STORE_OPERATIONS` is what mail does
//! in the course of a day; this is a one-time move, and it takes rows as
//! rows.

use rusqlite::params;
use serde::Deserialize;

use crate::db::{DbResult, MailDb};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  #[serde(default)]
  pub accounts: Vec<AccountRow>,
  #[serde(default)]
  pub settings: Vec<SettingRow>,
  #[serde(default)]
  pub snoozes: Vec<SnoozeRow>,
  #[serde(default)]
  pub chats: Vec<ChatRow>,
  #[serde(default)]
  pub chat_parts: Vec<ChatPartRow>,
  #[serde(default)]
  pub chat_bindings: Vec<ChatBindingRow>,
  #[serde(default)]
  pub chat_message_ids: Vec<ChatMessageIdRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRow {
  pub provider: String,
  pub email: String,
  #[serde(default = "yes")]
  pub in_mail_tab: bool,
  #[serde(default)]
  pub sort_order: i64,
}
fn yes() -> bool {
  true
}

#[derive(Debug, Deserialize)]
pub struct SettingRow {
  pub key: String,
  pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeRow {
  pub account_email: String,
  pub thread_id: String,
  pub snoozed_until: String,
  #[serde(default)]
  pub tip_message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRow {
  pub id: String,
  pub title: String,
  pub created_by_account: String,
  pub participant_fingerprint: String,
  #[serde(default)]
  pub participant_emails: Vec<String>,
  #[serde(default = "active")]
  pub status: String,
  pub rotate_at: i64,
  #[serde(default)]
  pub no_quote: bool,
}
fn active() -> String {
  "active".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPartRow {
  pub id: String,
  pub chat_id: String,
  pub part_index: i64,
  pub subject: String,
  pub status: String,
  #[serde(default)]
  pub message_count: i64,
  #[serde(default)]
  pub opened_at: Option<String>,
  #[serde(default)]
  pub closed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatBindingRow {
  pub part_id: String,
  pub account_email: String,
  pub provider: String,
  pub provider_thread_id: String,
  #[serde(default)]
  pub provider_tip_message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageIdRow {
  pub account_email: String,
  pub rfc_message_id: String,
  pub chat_id: String,
  pub part_id: String,
}

/// How many rows each table took. Rows the store already had count as
/// skipped, not as errors.
#[derive(Debug, Default, serde::Serialize, PartialEq)]
pub struct ImportReport {
  pub accounts: usize,
  pub settings: usize,
  pub snoozes: usize,
  pub chats: usize,
  pub chat_parts: usize,
  pub chat_bindings: usize,
  pub chat_message_ids: usize,
}

impl MailDb {
  /// Write a snapshot into the store. One transaction: all of it or none.
  pub fn import_snapshot(&self, owner_id: &str, snapshot: &Snapshot) -> DbResult<ImportReport> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let now = crate::db::now_ms();
    let mut report = ImportReport::default();

    for a in &snapshot.accounts {
      let email = a.email.trim().to_lowercase();
      if email.is_empty() {
        continue;
      }
      report.accounts += tx.execute(
        "INSERT OR IGNORE INTO accounts (provider, email, owner_id, in_mail_tab, sort_order, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![a.provider, email, owner_id, a.in_mail_tab as i64, a.sort_order, now],
      )?;
    }
    for s in &snapshot.settings {
      report.settings += tx.execute(
        "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
        params![s.key, s.value, now],
      )?;
    }
    for s in &snapshot.snoozes {
      report.snoozes += tx.execute(
        "INSERT OR IGNORE INTO snoozes (account_email, thread_id, snoozed_until, tip_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
          s.account_email.trim().to_lowercase(),
          s.thread_id,
          s.snoozed_until,
          s.tip_message_id,
          now
        ],
      )?;
    }
    for c in &snapshot.chats {
      let emails = serde_json::to_string(&c.participant_emails)?;
      report.chats += tx.execute(
        "INSERT OR IGNORE INTO chats
           (id, title, created_by_account, participant_fingerprint, participant_emails,
            status, rotate_at, no_quote, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
          c.id,
          c.title,
          c.created_by_account,
          c.participant_fingerprint,
          emails,
          c.status,
          c.rotate_at,
          c.no_quote as i64,
          now
        ],
      )?;
    }
    for p in &snapshot.chat_parts {
      report.chat_parts += tx.execute(
        "INSERT OR IGNORE INTO chat_parts
           (id, chat_id, part_index, subject, status, message_count, opened_at, closed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
          p.id,
          p.chat_id,
          p.part_index,
          p.subject,
          p.status,
          p.message_count,
          p.opened_at,
          p.closed_at
        ],
      )?;
    }
    for b in &snapshot.chat_bindings {
      report.chat_bindings += tx.execute(
        "INSERT OR IGNORE INTO chat_part_bindings
           (part_id, account_email, provider, provider_thread_id, provider_tip_message_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
          b.part_id,
          b.account_email.trim().to_lowercase(),
          b.provider,
          b.provider_thread_id,
          b.provider_tip_message_id
        ],
      )?;
    }
    for m in &snapshot.chat_message_ids {
      report.chat_message_ids += tx.execute(
        "INSERT OR IGNORE INTO chat_message_ids (account_email, rfc_message_id, chat_id, part_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![
          m.account_email.trim().to_lowercase(),
          m.rfc_message_id,
          m.chat_id,
          m.part_id
        ],
      )?;
    }

    tx.commit()?;
    Ok(report)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn snapshot() -> Snapshot {
    serde_json::from_value(serde_json::json!({
      "accounts": [{ "provider": "gmail", "email": "Me@Example.org", "inMailTab": true, "sortOrder": 0 }],
      "settings": [{ "key": "mail_signature:me@example.org", "value": "{\"html\":\"x\"}" }],
      "snoozes": [{ "accountEmail": "me@example.org", "threadId": "t1", "snoozedUntil": "2030-01-01T00:00:00.000Z", "tipMessageId": null }],
      "chats": [{ "id": "c1", "title": "A", "createdByAccount": "me@example.org", "participantFingerprint": "f", "participantEmails": ["a@example.org"], "status": "active", "rotateAt": 80, "noQuote": true }],
      "chatParts": [{ "id": "p1", "chatId": "c1", "partIndex": 1, "subject": "A", "status": "open", "messageCount": 3, "openedAt": "2026-01-01T00:00:00Z", "closedAt": null }],
      "chatBindings": [{ "partId": "p1", "accountEmail": "me@example.org", "provider": "gmail", "providerThreadId": "t1", "providerTipMessageId": null }],
      "chatMessageIds": [{ "accountEmail": "me@example.org", "rfcMessageId": "<m1@x>", "chatId": "c1", "partId": "p1" }]
    }))
    .unwrap()
  }

  #[test]
  fn imports_every_table_and_a_second_pass_changes_nothing() {
    let db = MailDb::open_in_memory().unwrap();
    let first = db.import_snapshot("local", &snapshot()).unwrap();
    assert_eq!(
      first,
      ImportReport {
        accounts: 1,
        settings: 1,
        snoozes: 1,
        chats: 1,
        chat_parts: 1,
        chat_bindings: 1,
        chat_message_ids: 1
      }
    );
    let second = db.import_snapshot("local", &snapshot()).unwrap();
    assert_eq!(second, ImportReport::default(), "OR IGNORE keeps what is there");

    // What the store now answers through its own operations.
    let active = db
      .call("snoozes.listActive", &serde_json::json!({ "now": "2026-01-01T00:00:00.000Z" }))
      .unwrap();
    assert_eq!(active.as_array().map(|a| a.len()), Some(1));
    let signature = db
      .call("settings.get", &serde_json::json!({ "key": "mail_signature:me@example.org" }))
      .unwrap();
    assert_eq!(signature.as_str(), Some("{\"html\":\"x\"}"));
  }

  #[test]
  fn a_snapshot_with_a_bad_row_writes_nothing() {
    let db = MailDb::open_in_memory().unwrap();
    // A part for a chat that is not in the snapshot: the foreign key fails,
    // and the transaction takes the good rows down with it.
    let bad: Snapshot = serde_json::from_value(serde_json::json!({
      "settings": [{ "key": "k", "value": "v" }],
      "chatParts": [{ "id": "p9", "chatId": "missing", "partIndex": 1, "subject": "s", "status": "open" }]
    }))
    .unwrap();
    assert!(db.import_snapshot("local", &bad).is_err());
    let value = db.call("settings.get", &serde_json::json!({ "key": "k" })).unwrap();
    assert!(value.is_null());
  }
}
