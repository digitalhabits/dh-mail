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

mod read;
mod repairs;
mod search;
mod text;
mod write;

#[cfg(test)]
mod tests;

pub use read::{LatestMessage, ThreadRow, View};
pub use repairs::migrate;
pub use search::{fts_query, label_key, parse_search, HiddenPlace, LabelTerm, SearchPlan};
pub use text::{decode_entities, is_html_page, plain_words, strip_html, strip_stray_tags};
pub(crate) use write::{delete_one, upsert_one};

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

/// UIDs are per folder, so the index carries the folder (step 1 in schema.rs).
pub fn add_columns(conn: &Connection) -> DbResult<()> {
  crate::schema::add_column(conn, "messages", "folder", "TEXT NOT NULL DEFAULT ''")
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
