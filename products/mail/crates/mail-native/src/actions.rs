//! Actions on a thread, applied to the copy first and delivered later.
//!
//! Archive, trash, read, star, a label: the reader sees the result at
//! once, in the copy, and the worker carries it to the server over IMAP on
//! its next pass — in order, retried until it lands, and reverted with a
//! word to the reader if the server refuses it for good. Nothing here
//! waits on the network at the moment the reader acts. See
//! docs/mail-local-store.md, section 7.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{now_ms, DbResult, MailDb};
use crate::imap::{self, Client};
use crate::messages::{DRAFT, INBOX, SPAM, STARRED, TRASH};

pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS pending_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email TEXT NOT NULL,
    thread_id     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    payload       TEXT NOT NULL DEFAULT '{}',
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pending_actions_account_idx ON pending_actions (account_email, id);
"#;

/// How many times the worker tries an action before giving it up.
pub const MAX_ATTEMPTS: i64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
  pub id: i64,
  pub account: String,
  pub thread_id: String,
  pub kind: String,
  #[serde(default)]
  pub payload: Value,
  pub attempts: i64,
  #[serde(default)]
  pub last_error: Option<String>,
}

/// The actions the interface can queue. The string is what TypeScript sends.
pub const KINDS: &[&str] = &[
  "archive", "unarchive", "trash", "untrash", "junk", "notjunk", "read", "unread", "star", "unstar",
  "move", "unmove", "discardDraft",
];

impl MailDb {
  /// Apply the action to the copy and remember it for the worker.
  pub fn actions_apply_and_enqueue(
    &self,
    account: &str,
    thread_id: &str,
    kind: &str,
    payload: &Value,
  ) -> DbResult<i64> {
    self.actions_apply(account, thread_id, kind, payload, true)
  }

  /// Apply the action to the copy only: for a provider whose own call has
  /// already been made, so the list shows the result at once.
  pub fn actions_apply_local(&self, args: &Value) -> DbResult<Value> {
    let account = crate::db::str_arg(args, "account")?;
    let thread_id = crate::db::opt_str_arg(args, "threadId").unwrap_or_default();
    let kind = crate::db::str_arg(args, "kind")?;
    let payload = args.get("payload").cloned().unwrap_or(json!({}));
    self.actions_apply(&account, &thread_id, &kind, &payload, false)?;
    Ok(Value::Null)
  }

  pub(crate) fn actions_apply(
    &self,
    account: &str,
    thread_id: &str,
    kind: &str,
    payload: &Value,
    enqueue: bool,
  ) -> DbResult<i64> {
    if !KINDS.contains(&kind) {
      return Err(crate::db::DbError::BadArgument(format!("unknown action {kind}")));
    }
    let label = payload.get("label").and_then(Value::as_str).map(str::to_string);
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let now = now_ms();
    /*
      What the rows looked like before, for an action that hides them.

      Trash, Junk and a discarded draft used to delete the rows on the
      spot. If Gmail then refused the move for good — a Trash folder not
      shown to IMAP, say — the messages were gone from the copy though
      still on the server, until the folder was rebuilt. Now the rows are
      only marked, and the labels they had go with the action, so that a
      refusal puts them back as they were.
    */
    let mut before = serde_json::Map::new();
    if matches!(kind, "trash" | "junk" | "discardDraft") {
      let ids: Vec<String> = if kind == "discardDraft" {
        payload.get("messageId").and_then(Value::as_str).map(|s| vec![s.to_string()]).unwrap_or_default()
      } else {
        let mut stmt = tx.prepare("SELECT message_id FROM messages WHERE account_email = ?1 AND thread_id = ?2")?;
        let rows = stmt.query_map(params![account, thread_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
      };
      for id in ids {
        let mut stmt = tx.prepare("SELECT label FROM message_labels WHERE account_email = ?1 AND message_id = ?2")?;
        let labels = stmt.query_map(params![account, id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        before.insert(id, json!(labels));
      }
    }
    let labels = |tx: &rusqlite::Connection, add: &[&str], remove: &[&str]| -> DbResult<()> {
      let ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT message_id FROM messages WHERE account_email = ?1 AND thread_id = ?2")?;
        let rows = stmt.query_map(params![account, thread_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        rows
      };
      for id in ids {
        for l in remove {
          tx.execute(
            "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2 AND label = ?3",
            params![account, id, l],
          )?;
        }
        for l in add {
          tx.execute(
            "INSERT OR IGNORE INTO message_labels (account_email, message_id, label) VALUES (?1, ?2, ?3)",
            params![account, id, l],
          )?;
        }
        tx.execute(
          "UPDATE messages SET updated_at = ?3 WHERE account_email = ?1 AND message_id = ?2",
          params![account, id, now],
        )?;
      }
      Ok(())
    };
    match kind {
      "archive" => labels(&tx, &[], &[INBOX])?,
      "unarchive" | "untrash" | "notjunk" => labels(&tx, &[INBOX], &[TRASH, SPAM])?,
      "read" => {
        tx.execute(
          "UPDATE messages SET unread = 0, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2 AND unread = 1",
          params![account, thread_id, now],
        )?;
      }
      "unread" => {
        tx.execute(
          "UPDATE messages SET unread = 1, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2
             AND sent_at = (SELECT MAX(sent_at) FROM messages m2 WHERE m2.account_email = ?1 AND m2.thread_id = ?2)",
          params![account, thread_id, now],
        )?;
      }
      "star" => {
        tx.execute(
          "UPDATE messages SET starred = 1, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2
             AND sent_at = (SELECT MAX(sent_at) FROM messages m2 WHERE m2.account_email = ?1 AND m2.thread_id = ?2)",
          params![account, thread_id, now],
        )?;
        labels(&tx, &[STARRED], &[])?;
      }
      "unstar" => {
        tx.execute(
          "UPDATE messages SET starred = 0, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2",
          params![account, thread_id, now],
        )?;
        labels(&tx, &[], &[STARRED])?;
      }
      // Trash and Junk: the rows stay and wear the label, which every
      // view but Trash and Junk hides. Once the server has moved them
      // the sweep takes the All Mail rows and the side folder's pass
      // brings its own copies.
      "trash" => labels(&tx, &[TRASH], &[INBOX])?,
      "junk" => labels(&tx, &[SPAM], &[INBOX])?,
      "move" => {
        let Some(l) = label.as_deref() else {
          return Err(crate::db::DbError::BadArgument("move needs a label".into()));
        };
        labels(&tx, &[l], &[INBOX])?;
      }
      "unmove" => {
        let Some(l) = label.as_deref() else {
          return Err(crate::db::DbError::BadArgument("unmove needs a label".into()));
        };
        labels(&tx, &[INBOX], &[l])?;
      }
      // A provider draft thrown away: its row is hidden the same way,
      // and goes when the sweep finds the server's copy gone.
      "discardDraft" => {
        let Some(message_id) = payload.get("messageId").and_then(Value::as_str) else {
          return Err(crate::db::DbError::BadArgument("discardDraft needs a messageId".into()));
        };
        tx.execute(
          "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2 AND label = ?3",
          params![account, message_id, DRAFT],
        )?;
        tx.execute(
          "INSERT OR IGNORE INTO message_labels (account_email, message_id, label) VALUES (?1, ?2, ?3)",
          params![account, message_id, TRASH],
        )?;
        tx.execute(
          "UPDATE messages SET updated_at = ?3 WHERE account_email = ?1 AND message_id = ?2",
          params![account, message_id, now],
        )?;
      }
      _ => {}
    }
    let id = if enqueue {
      let mut stored = payload.clone();
      if !before.is_empty() {
        if let Some(map) = stored.as_object_mut() {
          map.insert("before".into(), Value::Object(before));
        }
      }
      tx.execute(
        "INSERT INTO pending_actions (account_email, thread_id, kind, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![account, thread_id, kind, stored.to_string(), now],
      )?;
      tx.last_insert_rowid()
    } else {
      0
    };
    tx.commit()?;
    Ok(id)
  }

  /// Put the rows an action hid back as they were, once the server has
  /// refused it for good. Reads the labels the action carried with it.
  pub fn actions_restore(&self, action: &PendingAction) -> DbResult<()> {
    let Some(before) = action.payload.get("before").and_then(Value::as_object) else {
      return Ok(());
    };
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let now = now_ms();
    for (id, labels) in before {
      tx.execute(
        "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2",
        params![action.account, id],
      )?;
      for label in labels.as_array().into_iter().flatten().filter_map(Value::as_str) {
        tx.execute(
          "INSERT OR IGNORE INTO message_labels (account_email, message_id, label) VALUES (?1, ?2, ?3)",
          params![action.account, id, label],
        )?;
      }
      tx.execute(
        "UPDATE messages SET updated_at = ?3 WHERE account_email = ?1 AND message_id = ?2",
        params![action.account, id, now],
      )?;
    }
    tx.commit()?;
    Ok(())
  }

  pub fn actions_pending(&self, account: &str) -> DbResult<Vec<PendingAction>> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT id, account_email, thread_id, kind, payload, attempts, last_error FROM pending_actions
       WHERE account_email = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![account], |r| {
      let payload: String = r.get(4)?;
      Ok(PendingAction {
        id: r.get(0)?,
        account: r.get(1)?,
        thread_id: r.get(2)?,
        kind: r.get(3)?,
        payload: serde_json::from_str(&payload).unwrap_or(json!({})),
        attempts: r.get(5)?,
        last_error: r.get(6)?,
      })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
  }

  pub fn actions_done(&self, id: i64) -> DbResult<()> {
    let conn = self.conn_mut();
    conn.execute("DELETE FROM pending_actions WHERE id = ?1", params![id])?;
    Ok(())
  }

  /// One more failed try. True when the action has been given up.
  pub fn actions_failed(&self, id: i64, error: &str) -> DbResult<bool> {
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE pending_actions SET attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
      params![id, error],
    )?;
    let attempts: Option<i64> = conn
      .query_row("SELECT attempts FROM pending_actions WHERE id = ?1", params![id], |r| r.get(0))
      .optional()?;
    if attempts.unwrap_or(0) >= MAX_ATTEMPTS {
      conn.execute("DELETE FROM pending_actions WHERE id = ?1", params![id])?;
      return Ok(true);
    }
    Ok(false)
  }

  pub fn actions_count(&self, account: &str) -> DbResult<i64> {
    let conn = self.conn_mut();
    Ok(conn.query_row(
      "SELECT COUNT(*) FROM pending_actions WHERE account_email = ?1",
      params![account],
      |r| r.get(0),
    )?)
  }
}

/// What the worker found when it tried the queue.
#[derive(Debug, Default)]
pub struct FlushReport {
  pub delivered: usize,
  /// Actions given up on, with the server's reason.
  pub given_up: Vec<(PendingAction, String)>,
}

/// Carry every pending action for the mailbox to the server, in order.
///
/// `all_mail` must be selected on `client` when this is called, and is
/// selected again before it returns. `trash` and `junk` are the raw names
/// of those folders, for the actions that reach into them.
pub fn flush_actions(
  db: &MailDb,
  client: &mut Client,
  email: &str,
  folders: &Folders,
) -> Result<FlushReport, imap::ImapError> {
  let mut report = FlushReport::default();
  let pending = match db.actions_pending(email) {
    Ok(p) => p,
    Err(e) => {
      log::warn!("[mail-sync] {email}: could not read the action queue: {e}");
      return Ok(report);
    }
  };
  for action in pending {
    match deliver(client, &action, folders) {
      Ok(()) => {
        let _ = db.actions_done(action.id);
        report.delivered += 1;
      }
      Err(imap::ImapError::Refused { text, .. }) => {
        // The server said no: a label that does not exist, a message that
        // is gone. Not a reason to drop the connection.
        match db.actions_failed(action.id, &text) {
          Ok(true) => {
            if let Err(e) = db.actions_restore(&action) {
              log::warn!("[mail-sync] {email}: could not put back what a refused action hid: {e}");
            }
            report.given_up.push((action, text));
          }
          Ok(false) => {}
          Err(e) => log::warn!("[mail-sync] {email}: could not record a failed action: {e}"),
        }
      }
      Err(other) => {
        // Counted too. The connection is dropped and the next session
        // starts with this same action; one the server answers with a
        // BYE, or with a reply the parser cannot read, would otherwise
        // stop the mailbox syncing for good, since the flush comes first.
        let text = other.to_string();
        match db.actions_failed(action.id, &text) {
          Ok(true) => {
            log::warn!("[mail-sync] {email}: gave up on action {} ({}) after repeated failures: {text}", action.id, action.kind);
            if let Err(e) = db.actions_restore(&action) {
              log::warn!("[mail-sync] {email}: could not put back what a refused action hid: {e}");
            }
            report.given_up.push((action, text));
          }
          Ok(false) => {}
          Err(e) => log::warn!("[mail-sync] {email}: could not record a failed action: {e}"),
        }
        return Err(other);
      }
    }
  }
  Ok(report)
}

/// The folders an action may need, as the server names them.
#[derive(Debug, Clone, Default)]
pub struct Folders {
  pub all_mail: String,
  pub trash: Option<String>,
  pub junk: Option<String>,
  pub drafts: Option<String>,
}

fn thrid(thread_id: &str) -> Option<u64> {
  u64::from_str_radix(thread_id, 16).ok()
}

fn deliver(client: &mut Client, action: &PendingAction, folders: &Folders) -> Result<(), imap::ImapError> {
  if action.kind == "discardDraft" {
    let msgid = action
      .payload
      .get("messageId")
      .and_then(Value::as_str)
      .and_then(|id| u64::from_str_radix(id, 16).ok())
      .ok_or_else(|| imap::ImapError::Refused { command: "discardDraft".into(), text: "no message id".into() })?;
    let Some(drafts) = &folders.drafts else {
      return Err(imap::ImapError::Refused { command: "discardDraft".into(), text: "no Drafts folder".into() });
    };
    client.select(drafts)?;
    let found = client.uid_search(&format!("X-GM-MSGID {msgid}"));
    let done = match found {
      Ok(uids) if !uids.is_empty() => {
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        client.uid_store(&set, "+FLAGS.SILENT", "(\\Deleted)").and_then(|_| client.expunge())
      }
      Ok(_) => Ok(()),
      Err(e) => Err(e),
    };
    client.select(&folders.all_mail)?;
    return done;
  }
  let Some(thrid) = thrid(&action.thread_id) else {
    return Err(imap::ImapError::Refused {
      command: action.kind.clone(),
      text: format!("{} is not a Gmail thread id", action.thread_id),
    });
  };
  let label = action.payload.get("label").and_then(Value::as_str).unwrap_or("");
  let create = action.payload.get("create").and_then(Value::as_bool).unwrap_or(false);
  let in_all_mail = |client: &mut Client| -> Result<Vec<u32>, imap::ImapError> {
    client.uid_search(&format!("X-GM-THRID {thrid}"))
  };
  let set = |uids: &[u32]| uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
  match action.kind.as_str() {
    "archive" => {
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        client.uid_store(&set(&uids), "-X-GM-LABELS", "(\\Inbox)")?;
      }
    }
    "unarchive" => {
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        client.uid_store(&set(&uids), "+X-GM-LABELS", "(\\Inbox)")?;
      }
    }
    "read" => {
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        client.uid_store(&set(&uids), "+FLAGS.SILENT", "(\\Seen)")?;
      }
    }
    "unread" => {
      let uids = in_all_mail(client)?;
      if let Some(newest) = uids.iter().max() {
        client.uid_store(&newest.to_string(), "-FLAGS.SILENT", "(\\Seen)")?;
      }
    }
    "star" => {
      let uids = in_all_mail(client)?;
      if let Some(newest) = uids.iter().max() {
        client.uid_store(&newest.to_string(), "+FLAGS.SILENT", "(\\Flagged)")?;
      }
    }
    "unstar" => {
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        client.uid_store(&set(&uids), "-FLAGS.SILENT", "(\\Flagged)")?;
      }
    }
    "trash" | "junk" => {
      let target = if action.kind == "trash" { &folders.trash } else { &folders.junk };
      let Some(target) = target else {
        return Err(imap::ImapError::Refused { command: action.kind.clone(), text: "no such folder on this mailbox".into() });
      };
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        client.uid_move(&set(&uids), target)?;
      }
    }
    "untrash" | "notjunk" => {
      // The thread sits in Trash or Junk, outside All Mail: select that
      // folder, find it, move it to the inbox, and come back.
      let source = if action.kind == "untrash" { &folders.trash } else { &folders.junk };
      let Some(source) = source else {
        return Err(imap::ImapError::Refused { command: action.kind.clone(), text: "no such folder on this mailbox".into() });
      };
      client.select(source)?;
      let uids = client.uid_search(&format!("X-GM-THRID {thrid}"));
      let moved = match uids {
        Ok(uids) if !uids.is_empty() => client.uid_move(&set(&uids), "INBOX"),
        Ok(_) => Ok(()),
        Err(e) => Err(e),
      };
      client.select(&folders.all_mail)?;
      moved?;
    }
    "move" => {
      if label.is_empty() {
        return Err(imap::ImapError::Refused { command: "move".into(), text: "no label".into() });
      }
      if create {
        // CREATE says no when the label exists; that is fine.
        let _ = client.create(&imap::encode_modified_utf7(label));
      }
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        let quoted = imap::quote(&imap::encode_modified_utf7(label));
        client.uid_store(&set(&uids), "+X-GM-LABELS", &format!("({quoted})"))?;
        client.uid_store(&set(&uids), "-X-GM-LABELS", "(\\Inbox)")?;
      }
    }
    "unmove" => {
      if label.is_empty() {
        return Err(imap::ImapError::Refused { command: "unmove".into(), text: "no label".into() });
      }
      let uids = in_all_mail(client)?;
      if !uids.is_empty() {
        let quoted = imap::quote(&imap::encode_modified_utf7(label));
        client.uid_store(&set(&uids), "-X-GM-LABELS", &format!("({quoted})"))?;
        client.uid_store(&set(&uids), "+X-GM-LABELS", "(\\Inbox)")?;
      }
    }
    other => {
      return Err(imap::ImapError::Refused { command: other.into(), text: "unknown action".into() });
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::messages::MessageRow;

  fn db() -> MailDb {
    MailDb::open_in_memory().expect("open")
  }

  fn seed(db: &MailDb) {
    db.messages_upsert(
      "vera@example.com",
      &[
        MessageRow { message_id: "m1".into(), thread_id: "1a".into(), uid: Some(1), sent_at: 1000, unread: true, labels: vec![INBOX.into()], ..Default::default() },
        MessageRow { message_id: "m2".into(), thread_id: "1a".into(), uid: Some(2), sent_at: 2000, unread: true, labels: vec![INBOX.into()], ..Default::default() },
      ],
    )
    .unwrap();
  }

  fn labels_of(db: &MailDb, id: &str) -> Vec<String> {
    let conn = db.conn_mut();
    let mut stmt = conn.prepare("SELECT label FROM message_labels WHERE message_id = ?1 ORDER BY label").unwrap();
    stmt.query_map(params![id], |r| r.get::<_, String>(0)).unwrap().collect::<Result<_, _>>().unwrap()
  }

  #[test]
  fn archive_read_and_move_change_the_copy_and_queue_in_order() {
    let db = db();
    seed(&db);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    assert!(labels_of(&db, "m1").is_empty());
    db.actions_apply_and_enqueue("vera@example.com", "1a", "read", &json!({})).unwrap();
    let unread: i64 = db.conn_mut().query_row("SELECT SUM(unread) FROM messages", [], |r| r.get(0)).unwrap();
    assert_eq!(unread, 0);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "move", &json!({ "label": "Work" })).unwrap();
    assert_eq!(labels_of(&db, "m2"), vec!["Work"]);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "unmove", &json!({ "label": "Work" })).unwrap();
    assert_eq!(labels_of(&db, "m2"), vec![INBOX]);
    let pending = db.actions_pending("vera@example.com").unwrap();
    let kinds: Vec<&str> = pending.iter().map(|a| a.kind.as_str()).collect();
    assert_eq!(kinds, vec!["archive", "read", "move", "unmove"]);
    assert_eq!(db.actions_count("vera@example.com").unwrap(), 4);
  }

  #[test]
  fn trash_removes_the_rows_and_unread_marks_only_the_newest() {
    let db = db();
    seed(&db);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "read", &json!({})).unwrap();
    db.actions_apply_and_enqueue("vera@example.com", "1a", "unread", &json!({})).unwrap();
    let rows: Vec<(String, i64)> = {
      let conn = db.conn_mut();
      let mut stmt = conn.prepare("SELECT message_id, unread FROM messages ORDER BY sent_at").unwrap();
      stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(rows, vec![("m1".to_string(), 0), ("m2".to_string(), 1)]);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "trash", &json!({})).unwrap();
    // The rows stay, hidden under TRASH and out of the inbox.
    let left: i64 = db.conn_mut().query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 2);
    let labels_of = |id: &str| -> Vec<String> {
      let conn = db.conn_mut();
      let mut stmt = conn.prepare("SELECT label FROM message_labels WHERE message_id = ?1 ORDER BY label").unwrap();
      stmt.query_map([id], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(labels_of("m1"), vec!["TRASH".to_string()]);
    assert!(db.actions_apply_and_enqueue("vera@example.com", "1a", "dance", &json!({})).is_err());
    // Refused for good: the rows come back as they were.
    let action = db.actions_pending("vera@example.com").unwrap().into_iter().find(|a| a.kind == "trash").unwrap();
    assert!(action.payload.get("before").is_some());
    db.actions_restore(&action).unwrap();
    assert_eq!(labels_of("m1"), vec!["INBOX".to_string()]);
  }

  #[test]
  fn the_worker_delivers_the_queue_in_order_and_keeps_a_refused_one_for_later() {
    let db = db();
    seed(&db);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    db.actions_apply_and_enqueue("vera@example.com", "1a", "move", &json!({ "label": "Ølhøst" })).unwrap();
    db.actions_apply_and_enqueue("vera@example.com", "1a", "trash", &json!({})).unwrap();
    let stream = crate::imap::fake_server(vec![
      ("UID SEARCH X-GM-THRID 26", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      ("UID STORE 1,2 -X-GM-LABELS (\\Inbox)", "{tag} OK\r\n"),
      ("UID SEARCH X-GM-THRID 26", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      ("UID STORE 1,2 +X-GM-LABELS (\"&ANg-lh&APg-st\")", "{tag} NO [CANNOT] no such label\r\n"),
      ("UID SEARCH X-GM-THRID 26", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      ("UID MOVE 1,2 \"[Gmail]/Papirkurv\"", "{tag} OK moved\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    let folders = Folders { all_mail: "[Gmail]/Alle mails".into(), trash: Some("[Gmail]/Papirkurv".into()), junk: None, drafts: None };
    let report = flush_actions(&db, &mut client, "vera@example.com", &folders).unwrap();
    assert_eq!(report.delivered, 2);
    assert!(report.given_up.is_empty(), "one refusal is retried later, not given up");
    let left = db.actions_pending("vera@example.com").unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].kind, "move");
    assert_eq!(left[0].attempts, 1);
    assert_eq!(left[0].last_error.as_deref(), Some("[CANNOT] no such label"));
  }

  #[test]
  fn a_refused_action_is_retried_and_then_given_up() {
    let db = db();
    seed(&db);
    let id = db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    for _ in 0..(MAX_ATTEMPTS - 1) {
      assert!(!db.actions_failed(id, "NO").unwrap());
    }
    assert!(db.actions_failed(id, "NO").unwrap());
    assert!(db.actions_pending("vera@example.com").unwrap().is_empty());
  }
}
