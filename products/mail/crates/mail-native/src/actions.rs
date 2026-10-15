//! Actions on a thread, applied to the copy first and delivered later.
//!
//! Archive, trash, read, star, a label: the reader sees the result at
//! once, in the copy, and the worker carries it to the server over IMAP on
//! its next pass — in order, retried until it lands, and reverted with a
//! word to the reader if the server refuses it for good. Nothing here
//! waits on the network at the moment the reader acts. See
//! docs/mail-local-store.md, section 7.
//!
//! One action cannot be undone: "deleteForever", on a thread in Trash or in
//! Junk. The rows leave the copy at once, and the worker marks the messages
//! `\Deleted` in that folder and expunges them. Gmail deletes for good what
//! is expunged from Trash or Junk. If the server refuses for good, the folder
//! is read again from nothing, so what is still on the server is shown again.
//!
//! There is no "empty the folder" action, on purpose. Mail is deleted for
//! good one chosen thread at a time, and never by the folder.

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
  "move", "unmove", "discardDraft", "deleteForever",
];

/// The folders mail can be deleted from for good, as the payload names them:
/// the label their rows carry, and the store's key for the folder.
fn purge_target(payload: &Value) -> Option<(&'static str, &'static str)> {
  match payload.get("from").and_then(Value::as_str) {
    Some("trash") => Some((TRASH, "trash")),
    Some("junk") | Some("spam") => Some((SPAM, "spam")),
    _ => None,
  }
}

/// The store's folder that a delete-for-good action emptied, if it is one.
/// The worker reads that folder again when the server refuses the action.
pub fn purged_folder(action: &PendingAction) -> Option<&'static str> {
  if action.kind != "deleteForever" {
    return None;
  }
  purge_target(&action.payload).map(|(_, folder)| folder)
}

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

  /*
    The queue, for the providers whose worker is in the interface: Outlook
    and Exchange. The same table and the same order as the Gmail worker's;
    only the delivery is in TypeScript. See docs/mail-local-store.md, 7.
  */

  /// `actions.enqueue`: remember an action for the server. With `apply`
  /// (the default) the copy changes too, in the same step, and the action
  /// keeps how each message of the thread was. Without it the caller says
  /// how the copy changes: `rows` are written in the same transaction as
  /// the action, and the payload says how they were (Exchange, whose folders
  /// are not labels). Either way the copy and the queue cannot disagree.
  pub fn actions_enqueue_op(&self, args: &Value) -> DbResult<Value> {
    let account = crate::db::str_arg(args, "account")?;
    let thread_id = crate::db::opt_str_arg(args, "threadId").unwrap_or_default();
    let kind = crate::db::str_arg(args, "kind")?;
    let payload = args.get("payload").cloned().unwrap_or(json!({}));
    if args.get("apply").and_then(Value::as_bool).unwrap_or(true) {
      return Ok(json!(self.actions_apply_with(&account, &thread_id, &kind, &payload, true, true)?));
    }
    if !KINDS.contains(&kind.as_str()) {
      return Err(crate::db::DbError::BadArgument(format!("unknown action {kind}")));
    }
    let rows: Vec<crate::messages::MessageRow> = match args.get("rows") {
      Some(Value::Null) | None => Vec::new(),
      Some(rows) => serde_json::from_value(rows.clone())?,
    };
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    tx.execute(
      "INSERT INTO pending_actions (account_email, thread_id, kind, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![account, thread_id, kind, payload.to_string(), now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    for row in &rows {
      crate::messages::upsert_one(&tx, &account, row)?;
    }
    tx.commit()?;
    Ok(json!(id))
  }

  /// `actions.pending`: the mailbox's queue, oldest first.
  pub fn actions_pending_op(&self, args: &Value) -> DbResult<Value> {
    let account = crate::db::str_arg(args, "account")?;
    Ok(serde_json::to_value(self.actions_pending(&account)?).unwrap_or(json!([])))
  }

  /// `actions.done`: delivered, or dropped.
  pub fn actions_done_op(&self, args: &Value) -> DbResult<Value> {
    let id = args.get("id").and_then(Value::as_i64).ok_or_else(|| crate::db::DbError::BadArgument("id".into()))?;
    self.actions_done(id)?;
    Ok(Value::Null)
  }

  /// `actions.failed`: one more try that did not land. `{ givenUp }`.
  pub fn actions_failed_op(&self, args: &Value) -> DbResult<Value> {
    let id = args.get("id").and_then(Value::as_i64).ok_or_else(|| crate::db::DbError::BadArgument("id".into()))?;
    let error = crate::db::opt_str_arg(args, "error").unwrap_or_default();
    let transient = args.get("transient").and_then(Value::as_bool).unwrap_or(false);
    Ok(json!({ "givenUp": self.actions_failed(id, &error, transient)? }))
  }

  /// `actions.doneRenaming`: a move delivered, and the item ids it changed
  /// (EWS gives a moved item a new id) written into the actions queued
  /// after it, in one transaction. Done and renamed in two steps, a stop
  /// between them left the later actions on ids the server no longer knows.
  pub fn actions_done_renaming_op(&self, args: &Value) -> DbResult<Value> {
    let id = args.get("id").and_then(Value::as_i64).ok_or_else(|| crate::db::DbError::BadArgument("id".into()))?;
    let renamed: std::collections::HashMap<String, String> = match args.get("newIds") {
      Some(Value::Null) | None => Default::default(),
      Some(map) => serde_json::from_value(map.clone())?,
    };
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let account: Option<String> = tx
      .query_row("SELECT account_email FROM pending_actions WHERE id = ?1", params![id], |r| r.get(0))
      .optional()?;
    tx.execute("DELETE FROM pending_actions WHERE id = ?1", params![id])?;
    let mut changed = 0;
    if let (Some(account), false) = (account, renamed.is_empty()) {
      let later: Vec<(i64, String)> = {
        let mut stmt = tx.prepare("SELECT id, payload FROM pending_actions WHERE account_email = ?1 AND id > ?2 ORDER BY id")?;
        let rows = stmt.query_map(params![account, id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        rows
      };
      for (later_id, text) in later {
        let mut payload: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        if rename_items(&mut payload, &renamed) {
          tx.execute("UPDATE pending_actions SET payload = ?2 WHERE id = ?1", params![later_id, payload.to_string()])?;
          changed += 1;
        }
      }
    }
    tx.commit()?;
    Ok(json!(changed))
  }

  /// `actions.cancel`: an action the reader took back before it went out.
  /// It leaves the queue and its rows go back as its `before` says, in one
  /// transaction; the server never hears of either. False: it had gone.
  pub fn actions_cancel_op(&self, args: &Value) -> DbResult<Value> {
    let id = args.get("id").and_then(Value::as_i64).ok_or_else(|| crate::db::DbError::BadArgument("id".into()))?;
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let found: Option<(String, String)> = tx
      .query_row("SELECT account_email, payload FROM pending_actions WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
      .optional()?;
    let Some((account, text)) = found else {
      return Ok(json!(false));
    };
    tx.execute("DELETE FROM pending_actions WHERE id = ?1", params![id])?;
    let payload: Value = serde_json::from_str(&text).unwrap_or(json!({}));
    if let Some(before) = payload.get("before").and_then(Value::as_object) {
      restore_before_in(&tx, &account, before)?;
    }
    tx.commit()?;
    Ok(json!(true))
  }

  /// `actions.replay`: the queue put back on top of what a pass wrote.
  pub fn actions_replay_op(&self, args: &Value) -> DbResult<Value> {
    let account = crate::db::str_arg(args, "account")?;
    Ok(json!(self.actions_replay(&account)?))
  }

  /// `actions.restore`: rows put back as an action's `before` says.
  pub fn actions_restore_op(&self, args: &Value) -> DbResult<Value> {
    let account = crate::db::str_arg(args, "account")?;
    if let Some(before) = args.get("before").and_then(Value::as_object) {
      self.restore_before(&account, before)?;
    }
    Ok(Value::Null)
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
    self.actions_apply_with(account, thread_id, kind, payload, enqueue, false)
  }

  /// `whole_before`: keep the labels, unread and starred of every message
  /// of the thread with the action, whatever its kind, so a refusal can put
  /// any of them back. For the providers whose sync reads only what changed
  /// on the server (Outlook): nothing else would ever correct the copy.
  fn actions_apply_with(
    &self,
    account: &str,
    thread_id: &str,
    kind: &str,
    payload: &Value,
    enqueue: bool,
    whole_before: bool,
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
    if whole_before && enqueue && kind != "deleteForever" {
      let rows: Vec<(String, bool, bool)> = {
        let mut stmt = tx.prepare(
          "SELECT message_id, unread, starred FROM messages WHERE account_email = ?1 AND thread_id = ?2",
        )?;
        let rows = stmt
          .query_map(params![account, thread_id], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0)))?
          .collect::<Result<Vec<_>, _>>()?;
        rows
      };
      for (id, unread, starred) in rows {
        let mut stmt = tx.prepare("SELECT label FROM message_labels WHERE account_email = ?1 AND message_id = ?2")?;
        let labels = stmt.query_map(params![account, id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        before.insert(id, json!({ "labels": labels, "unread": unread, "starred": starred }));
      }
    } else if matches!(kind, "trash" | "junk" | "discardDraft") {
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
      // Gone for good. Only the rows that wear the folder's label go: a
      // thread can have one message in Trash and the others in the inbox.
      "deleteForever" => {
        let Some((label, _)) = purge_target(payload) else {
          return Err(crate::db::DbError::BadArgument(format!("{kind} needs from: trash or junk")));
        };
        if thread_id.is_empty() {
          return Err(crate::db::DbError::BadArgument("deleteForever needs a thread".into()));
        }
        let rows: Vec<(i64, String)> = {
          let mut stmt = tx.prepare(
            "SELECT m.rowid, m.message_id FROM messages m
             JOIN message_labels l ON l.account_email = m.account_email AND l.message_id = m.message_id
             WHERE m.account_email = ?1 AND l.label = ?2 AND m.thread_id = ?3",
          )?;
          let rows = stmt
            .query_map(params![account, label, thread_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
          rows
        };
        for (rowid, message_id) in rows {
          crate::messages::delete_one(&tx, account, rowid, &message_id)?;
        }
      }
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
    self.restore_before(&action.account, before)
  }

  /*
    Two shapes. The Gmail queue keeps only the labels, as a list, and only
    for what hides rows. The shared queue keeps `{ labels, unread, starred }`
    for every message the action touched. A message no longer in the copy is
    left out: putting back a row that is gone would make one with no content.
  */
  fn restore_before(&self, account: &str, before: &serde_json::Map<String, Value>) -> DbResult<()> {
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    restore_before_in(&tx, account, before)?;
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
  ///
  /// A transient failure — no network, a server that did not answer — is
  /// written down but not counted. The action is fine; the way to the
  /// server is not. Counted, an hour on a train gave up good actions.
  pub fn actions_failed(&self, id: i64, error: &str, transient: bool) -> DbResult<bool> {
    let conn = self.conn_mut();
    if transient {
      conn.execute("UPDATE pending_actions SET last_error = ?2 WHERE id = ?1", params![id, error])?;
      return Ok(false);
    }
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

  /*
    Put what is still queued back on top of what the server just said.

    A pass that reads labels and flags from the server writes them over
    the copy, and the server has not yet heard of an action still in the
    queue. Open a thread and archive it: the read goes out, the pass that
    follows reads the thread back with its Inbox label, and the archive is
    undone in the copy until it too has gone out. The row came back into
    the inbox a minute later. So each pass ends by applying the queue
    again, in order, to the copy only.
  */
  pub fn actions_replay(&self, account: &str) -> DbResult<usize> {
    let pending = self.actions_pending(account)?;
    for action in &pending {
      self.actions_apply(account, &action.thread_id, &action.kind, &action.payload, false)?;
    }
    Ok(pending.len())
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

/// `restore_before`, inside a transaction the caller holds.
fn restore_before_in(tx: &rusqlite::Transaction<'_>, account: &str, before: &serde_json::Map<String, Value>) -> DbResult<()> {
    let now = now_ms();
    for (id, was) in before {
      let there: Option<i64> = tx
        .query_row("SELECT 1 FROM messages WHERE account_email = ?1 AND message_id = ?2", params![account, id], |r| r.get(0))
        .optional()?;
      if there.is_none() {
        continue;
      }
      let labels = if was.is_array() { Some(was) } else { was.get("labels") };
      if let Some(labels) = labels {
        tx.execute(
          "DELETE FROM message_labels WHERE account_email = ?1 AND message_id = ?2",
          params![account, id],
        )?;
        for label in labels.as_array().into_iter().flatten().filter_map(Value::as_str) {
          tx.execute(
            "INSERT OR IGNORE INTO message_labels (account_email, message_id, label) VALUES (?1, ?2, ?3)",
            params![account, id, label],
          )?;
        }
      }
      if let Some(unread) = was.get("unread").and_then(Value::as_bool) {
        tx.execute(
          "UPDATE messages SET unread = ?3 WHERE account_email = ?1 AND message_id = ?2",
          params![account, id, unread as i64],
        )?;
      }
      if let Some(starred) = was.get("starred").and_then(Value::as_bool) {
        tx.execute(
          "UPDATE messages SET starred = ?3 WHERE account_email = ?1 AND message_id = ?2",
          params![account, id, starred as i64],
        )?;
      }
      tx.execute(
        "UPDATE messages SET updated_at = ?3 WHERE account_email = ?1 AND message_id = ?2",
        params![account, id, now],
      )?;
    }
  Ok(())
}

/// Rename a queued payload's items: `ids` and the keys of `before`. True
/// when anything changed.
fn rename_items(payload: &mut Value, renamed: &std::collections::HashMap<String, String>) -> bool {
  let mut changed = false;
  if let Some(ids) = payload.get_mut("ids").and_then(Value::as_array_mut) {
    for id in ids.iter_mut() {
      if let Some(new) = id.as_str().and_then(|old| renamed.get(old)) {
        *id = json!(new);
        changed = true;
      }
    }
  }
  if let Some(before) = payload.get_mut("before").and_then(Value::as_object_mut) {
    let keys: Vec<String> = before.keys().filter(|k| renamed.contains_key(*k)).cloned().collect();
    for old in keys {
      if let Some(was) = before.remove(&old) {
        before.insert(renamed[&old].clone(), was);
        changed = true;
      }
    }
  }
  changed
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
        match db.actions_failed(action.id, &text, false) {
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
        // Not a lost connection, though: that says nothing of the action.
        let text = other.to_string();
        let transient = matches!(other, imap::ImapError::Io(_));
        match db.actions_failed(action.id, &text, transient) {
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
  if action.kind == "deleteForever" {
    // Gmail deletes for good what is expunged from Trash or Junk. From any
    // other folder an expunge only takes the label off, so this never
    // selects another one.
    let refused = |text: &str| imap::ImapError::Refused { command: action.kind.clone(), text: text.into() };
    let source = match purge_target(&action.payload) {
      Some((_, "trash")) => &folders.trash,
      Some((_, _)) => &folders.junk,
      None => return Err(refused("no folder named")),
    };
    let Some(source) = source else {
      return Err(refused("no such folder on this mailbox"));
    };
    // Always one thread. There is no search for "ALL" here, so no reply
    // from the server can make this empty the folder.
    let query = match thrid(&action.thread_id) {
      Some(id) => format!("X-GM-THRID {id}"),
      None => return Err(refused(&format!("{} is not a Gmail thread id", action.thread_id))),
    };
    client.select(source)?;
    let done = match client.uid_search(&query) {
      Ok(uids) if !uids.is_empty() => {
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        // UID EXPUNGE takes these messages only. A plain EXPUNGE would
        // also take any message that another client had marked.
        client.uid_store(&set, "+FLAGS.SILENT", "(\\Deleted)").and_then(|_| client.uid_expunge(&set))
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
    let uids = client.uid_search(&format!("X-GM-THRID {thrid}"))?;
    /*
      Nothing found is taken as done, and the action leaves the queue. If
      the thread is in fact on the server, it was not changed there, and
      the next read brings it back as it was — an archived row back in the
      inbox. Said in the log, so such a row can be traced (2026-10-13).
    */
    if uids.is_empty() {
      log::warn!(
        "[mail-sync] {}: {} found no message of thread {} in All Mail",
        action.account,
        action.kind,
        action.thread_id
      );
    }
    Ok(uids)
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
  fn a_pass_that_reads_the_server_back_does_not_undo_a_queued_archive() {
    let db = db();
    seed(&db);
    db.actions_apply_and_enqueue("vera@example.com", "1a", "read", &json!({})).unwrap();
    db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    // The server has the read but not yet the archive.
    let inbox = vec![INBOX.to_string()];
    db.messages_set_flags("vera@example.com", "", 1, Some(false), Some(false), Some(&inbox), None).unwrap();
    assert_eq!(labels_of(&db, "m1"), vec![INBOX]);
    assert_eq!(db.actions_replay("vera@example.com").unwrap(), 2);
    assert!(labels_of(&db, "m1").is_empty());
    assert_eq!(db.actions_pending("vera@example.com").unwrap().len(), 2, "replay queues nothing more");
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

  /// Two threads in Trash, one of them with a message still in the inbox,
  /// and one thread in Junk.
  fn seed_trash(db: &MailDb) {
    let row = |id: &str, thread: &str, folder: &str, uid: i64, labels: &[&str]| MessageRow {
      message_id: id.into(),
      thread_id: thread.into(),
      folder: folder.into(),
      uid: Some(uid),
      sent_at: uid * 1000,
      labels: labels.iter().map(|l| l.to_string()).collect(),
      ..Default::default()
    };
    db.messages_upsert(
      "vera@example.com",
      &[
        row("t1", "2b", "trash", 1, &[TRASH]),
        row("t2", "2b", "trash", 2, &[TRASH]),
        row("k1", "2b", "", 9, &[INBOX]),
        row("t3", "3c", "trash", 3, &[TRASH]),
        row("j1", "4d", "spam", 1, &[SPAM]),
      ],
    )
    .unwrap();
  }

  fn ids_left(db: &MailDb) -> Vec<String> {
    let conn = db.conn_mut();
    let mut stmt = conn.prepare("SELECT message_id FROM messages ORDER BY message_id").unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<_, _>>().unwrap()
  }

  #[test]
  fn delete_forever_takes_only_the_trashed_messages_of_the_thread() {
    let db = db();
    seed_trash(&db);
    db.actions_apply_and_enqueue("vera@example.com", "2b", "deleteForever", &json!({ "from": "trash" })).unwrap();
    // The inbox message of the same thread stays, and so does the rest of Trash.
    assert_eq!(ids_left(&db), vec!["j1", "k1", "t3"]);
    // No folder named, or no thread: nothing is touched.
    assert!(db.actions_apply_and_enqueue("vera@example.com", "3c", "deleteForever", &json!({})).is_err());
    assert!(db.actions_apply_and_enqueue("vera@example.com", "", "deleteForever", &json!({ "from": "trash" })).is_err());
    assert!(db.actions_apply_and_enqueue("vera@example.com", "3c", "deleteForever", &json!({ "from": "inbox" })).is_err());
    assert_eq!(ids_left(&db), vec!["j1", "k1", "t3"]);
  }

  #[test]
  fn there_is_no_action_that_empties_a_folder() {
    let db = db();
    seed_trash(&db);
    assert!(db.actions_apply_and_enqueue("vera@example.com", "", "emptyFolder", &json!({ "from": "trash" })).is_err());
    assert_eq!(ids_left(&db), vec!["j1", "k1", "t1", "t2", "t3"]);
  }

  #[test]
  fn the_worker_expunges_from_trash_and_junk_and_from_nowhere_else() {
    let db = db();
    seed_trash(&db);
    db.actions_apply_and_enqueue("vera@example.com", "2b", "deleteForever", &json!({ "from": "trash" })).unwrap();
    db.actions_apply_and_enqueue("vera@example.com", "4d", "deleteForever", &json!({ "from": "junk" })).unwrap();
    let selected = "* 2 EXISTS\r\n{tag} OK [READ-WRITE] selected\r\n";
    let stream = crate::imap::fake_server(vec![
      ("SELECT \"[Gmail]/Papirkurv\" (CONDSTORE)", selected),
      ("UID SEARCH X-GM-THRID 43", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      ("UID STORE 1,2 +FLAGS.SILENT (\\Deleted)", "{tag} OK\r\n"),
      ("UID EXPUNGE 1,2", "{tag} OK\r\n"),
      ("SELECT \"[Gmail]/Alle mails\" (CONDSTORE)", selected),
      ("SELECT \"[Gmail]/Spam\" (CONDSTORE)", selected),
      ("UID SEARCH X-GM-THRID 77", "* SEARCH 1\r\n{tag} OK\r\n"),
      ("UID STORE 1 +FLAGS.SILENT (\\Deleted)", "{tag} OK\r\n"),
      ("UID EXPUNGE 1", "{tag} OK\r\n"),
      ("SELECT \"[Gmail]/Alle mails\" (CONDSTORE)", selected),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    let folders = Folders {
      all_mail: "[Gmail]/Alle mails".into(),
      trash: Some("[Gmail]/Papirkurv".into()),
      junk: Some("[Gmail]/Spam".into()),
      drafts: None,
    };
    let report = flush_actions(&db, &mut client, "vera@example.com", &folders).unwrap();
    assert_eq!(report.delivered, 2);
    assert!(db.actions_pending("vera@example.com").unwrap().is_empty());
  }

  #[test]
  fn a_mailbox_with_no_trash_folder_refuses_and_names_the_folder_to_read_again() {
    let db = db();
    seed_trash(&db);
    db.actions_apply_and_enqueue("vera@example.com", "3c", "deleteForever", &json!({ "from": "trash" })).unwrap();
    let action = db.actions_pending("vera@example.com").unwrap().remove(0);
    assert_eq!(purged_folder(&action), Some("trash"));
    let stream = crate::imap::fake_server(vec![]);
    let mut client = Client::connect_plain(stream).unwrap();
    let folders = Folders { all_mail: "[Gmail]/Alle mails".into(), trash: None, junk: None, drafts: None };
    let report = flush_actions(&db, &mut client, "vera@example.com", &folders).unwrap();
    assert_eq!(report.delivered, 0);
    assert_eq!(db.actions_pending("vera@example.com").unwrap()[0].attempts, 1);
    // An ordinary action names none.
    db.actions_apply_and_enqueue("vera@example.com", "2b", "read", &json!({})).unwrap();
    let read = db.actions_pending("vera@example.com").unwrap().into_iter().find(|a| a.kind == "read").unwrap();
    assert_eq!(purged_folder(&read), None);
  }

  #[test]
  fn a_restarted_folder_loses_its_rows_and_how_far_it_had_read() {
    let db = db();
    seed_trash(&db);
    db.sync_state_set(&crate::messages::SyncState {
      account: "vera@example.com".into(),
      folder: "trash".into(),
      phase: "live".into(),
      highest_uid: Some(3),
      highest_modseq: Some(77),
      ..Default::default()
    })
    .unwrap();
    db.messages_restart_folder("vera@example.com", "trash").unwrap();
    assert_eq!(ids_left(&db), vec!["j1", "k1"]);
    let state = db.sync_state_get("vera@example.com", "trash").unwrap().unwrap();
    assert_eq!((state.phase.as_str(), state.highest_uid, state.highest_modseq), ("expired", None, None));
  }

  #[test]
  fn a_refused_action_is_retried_and_then_given_up() {
    let db = db();
    seed(&db);
    let id = db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    for _ in 0..(MAX_ATTEMPTS - 1) {
      assert!(!db.actions_failed(id, "NO", false).unwrap());
    }
    assert!(db.actions_failed(id, "NO", false).unwrap());
    assert!(db.actions_pending("vera@example.com").unwrap().is_empty());
  }

  /// A server that greets and then says nothing: every read times out.
  fn silent_server() -> std::net::TcpStream {
    use std::io::Write;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      socket.write_all(b"* OK Gimap ready\r\n").unwrap();
      std::thread::sleep(std::time::Duration::from_secs(3));
    });
    std::net::TcpStream::connect(addr).unwrap()
  }

  #[test]
  fn a_lost_connection_does_not_use_up_an_attempt() {
    let db = db();
    seed(&db);
    let id = db.actions_apply_and_enqueue("vera@example.com", "1a", "archive", &json!({})).unwrap();
    let mut client = Client::connect_plain(silent_server()).unwrap();
    client.set_read_timeout(std::time::Duration::from_millis(100)).unwrap();
    let folders = Folders { all_mail: "[Gmail]/All Mail".into(), ..Default::default() };
    let err = flush_actions(&db, &mut client, "vera@example.com", &folders).unwrap_err();
    assert!(matches!(err, imap::ImapError::Io(_)), "{err:?}");
    let left = db.actions_pending("vera@example.com").unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].attempts, 0, "no network is not the action's fault");
    assert!(left[0].last_error.is_some());
    // However long the network is gone.
    for _ in 0..(MAX_ATTEMPTS * 3) {
      assert!(!db.actions_failed(id, "connection: offline", true).unwrap());
    }
    assert_eq!(db.actions_pending("vera@example.com").unwrap()[0].attempts, 0);
    assert!(labels_of(&db, "m1").is_empty(), "still archived in the copy");
  }

  #[test]
  fn a_queued_action_survives_reopening_the_store() {
    let path = std::env::temp_dir().join(format!("dh-mail-queue-{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&path);
    {
      let db = MailDb::open_file_for_tests(&path).unwrap();
      seed(&db);
      // Outlook's way: the store changes the copy and keeps how it was.
      db.call("actions.enqueue", &json!({ "account": "vera@example.com", "threadId": "1a", "kind": "archive" })).unwrap();
      // Exchange's way: the caller changed the copy and says how it was.
      db.call(
        "actions.enqueue",
        &json!({
          "account": "vera@example.com", "threadId": "1a", "kind": "read", "apply": false,
          "payload": { "ids": ["m1", "m2"], "before": { "m1": { "unread": true } } },
        }),
      )
      .unwrap();
    }
    let db = MailDb::open_file_for_tests(&path).unwrap();
    let pending = db.call("actions.pending", &json!({ "account": "vera@example.com" })).unwrap();
    let kinds: Vec<&str> = pending.as_array().unwrap().iter().map(|a| a["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, vec!["archive", "read"]);
    assert_eq!(pending[1]["payload"]["ids"], json!(["m1", "m2"]));
    assert_eq!(pending[0]["payload"]["before"]["m1"]["labels"], json!([INBOX]));
    assert!(labels_of(&db, "m1").is_empty(), "the archive is still in the copy");
    drop(db);
    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn the_shared_queue_puts_back_what_a_refused_action_changed() {
    let db = db();
    seed(&db);
    let id = db.call("actions.enqueue", &json!({ "account": "vera@example.com", "threadId": "1a", "kind": "read" })).unwrap();
    db.call("actions.enqueue", &json!({ "account": "vera@example.com", "threadId": "1a", "kind": "archive" })).unwrap();
    let unread = |db: &MailDb| -> i64 { db.conn_mut().query_row("SELECT SUM(unread) FROM messages", [], |r| r.get(0)).unwrap() };
    assert_eq!(unread(&db), 0);
    // A transient failure is not counted; a refusal is, up to the last.
    let failed = |transient: bool| db.call("actions.failed", &json!({ "id": id, "error": "x", "transient": transient })).unwrap();
    assert_eq!(failed(true)["givenUp"], json!(false));
    for _ in 0..(MAX_ATTEMPTS - 1) {
      assert_eq!(failed(false)["givenUp"], json!(false));
    }
    let read = db.actions_pending("vera@example.com").unwrap().remove(0);
    assert_eq!(failed(false)["givenUp"], json!(true));
    db.call("actions.restore", &json!({ "account": "vera@example.com", "before": read.payload["before"] })).unwrap();
    assert_eq!(unread(&db), 2, "both unread again, as they were");
    // The archive is still queued, and a pass that wrote the server's view
    // over the copy gets it back on top.
    let inbox = vec![INBOX.to_string()];
    db.messages_set_flags("vera@example.com", "", 1, Some(true), Some(false), Some(&inbox), None).unwrap();
    assert_eq!(db.call("actions.replay", &json!({ "account": "vera@example.com" })).unwrap(), json!(1));
    assert!(labels_of(&db, "m1").is_empty());
    let archive = db.actions_pending("vera@example.com").unwrap().remove(0);
    db.call("actions.done", &json!({ "id": archive.id })).unwrap();
    assert!(db.actions_pending("vera@example.com").unwrap().is_empty());
    // Restoring a row that is gone from the copy makes no row.
    db.call("actions.restore", &json!({ "account": "vera@example.com", "before": { "nope": { "labels": [INBOX] } } })).unwrap();
    assert_eq!(labels_of(&db, "nope"), Vec::<String>::new());
  }

  /// An Exchange-shaped action: the caller's rows and its own `before`.
  fn enqueue_exchange(db: &MailDb, thread: &str, kind: &str, ids: &[&str], rows: Value) -> i64 {
    let before: serde_json::Map<String, Value> =
      ids.iter().map(|id| (id.to_string(), json!({ "labels": [INBOX], "unread": true, "starred": false }))).collect();
    db.call(
      "actions.enqueue",
      &json!({
        "account": "vera@example.com", "threadId": thread, "kind": kind, "apply": false, "rows": rows,
        "payload": { "ids": ids, "target": "f-arch", "targetLabel": null, "before": before },
      }),
    )
    .unwrap()
    .as_i64()
    .unwrap()
  }

  #[test]
  fn an_enqueue_without_apply_writes_its_rows_with_the_action() {
    let db = db();
    seed(&db);
    let archived = |id: &str, sent_at: i64| {
      json!({
        "messageId": id, "threadId": "1a", "folder": "", "uid": null, "rfcMessageId": null, "fromName": "", "fromEmail": "",
        "to": [], "cc": [], "bcc": [], "subject": "", "snippet": "", "sentAt": sent_at, "sizeEstimate": null,
        "hasAttachments": false, "unread": false, "starred": false, "isDraft": false, "labels": [],
      })
    };
    enqueue_exchange(&db, "1a", "archive", &["m1", "m2"], json!([archived("m1", 1000), archived("m2", 2000)]));
    assert!(labels_of(&db, "m1").is_empty() && labels_of(&db, "m2").is_empty(), "the rows changed with the action");
    assert_eq!(db.actions_pending("vera@example.com").unwrap().len(), 1);
    // A row the store cannot read: neither the action nor any row is kept.
    let bad = db.call(
      "actions.enqueue",
      &json!({ "account": "vera@example.com", "threadId": "1a", "kind": "read", "apply": false, "rows": [{ "messageId": "m1" }] }),
    );
    assert!(bad.is_err());
    assert_eq!(db.actions_pending("vera@example.com").unwrap().len(), 1);
  }

  #[test]
  fn a_delivered_move_renames_the_items_of_later_actions_in_one_step() {
    let db = db();
    seed(&db);
    let first = enqueue_exchange(&db, "1a", "archive", &["m1", "m2"], Value::Null);
    enqueue_exchange(&db, "1a", "unread", &["m2"], Value::Null);
    enqueue_exchange(&db, "2b", "read", &["x9"], Value::Null);
    let changed = db.call("actions.doneRenaming", &json!({ "id": first, "newIds": { "m1": "m1~1", "m2": "m2~1" } })).unwrap();
    assert_eq!(changed, json!(1), "only the action that names a moved item");
    let left = db.actions_pending("vera@example.com").unwrap();
    assert_eq!(left.iter().map(|a| a.kind.as_str()).collect::<Vec<_>>(), vec!["unread", "read"]);
    assert_eq!(left[0].payload["ids"], json!(["m2~1"]));
    assert!(left[0].payload["before"].get("m2~1").is_some() && left[0].payload["before"].get("m2").is_none());
    assert_eq!(left[1].payload["ids"], json!(["x9"]));
    // No new ids: just done.
    assert_eq!(db.call("actions.doneRenaming", &json!({ "id": left[1].id })).unwrap(), json!(0));
    assert_eq!(db.actions_pending("vera@example.com").unwrap().len(), 1);
  }

  #[test]
  fn a_cancelled_action_leaves_the_queue_and_puts_its_rows_back() {
    let db = db();
    seed(&db);
    let id = db.call("actions.enqueue", &json!({ "account": "vera@example.com", "threadId": "1a", "kind": "archive" })).unwrap();
    assert!(labels_of(&db, "m1").is_empty());
    assert_eq!(db.call("actions.cancel", &json!({ "id": id })).unwrap(), json!(true));
    assert!(db.actions_pending("vera@example.com").unwrap().is_empty());
    assert_eq!(labels_of(&db, "m1"), vec![INBOX], "back in the inbox, as it was");
    assert_eq!(db.call("actions.cancel", &json!({ "id": id })).unwrap(), json!(false), "gone already: nothing to take back");
  }
}
