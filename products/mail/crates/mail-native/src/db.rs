//! Local SQLite store for the standalone Mail app.
//!
//! This is the Rust half of `MailStore`. The TypeScript half lives in
//! `products/mail/packages/mail/lib/mail/store/tauri/index.ts`, and the
//! constant `MAIL_STORE_OPERATIONS` there lists every operation this file must
//! answer. Keep the two in step: the list is the contract.
//!
//! One command carries every operation. `mail_store_call` takes an `op` name
//! and an `args` object, and answers JSON. Thirty-nine separate commands would
//! mean thirty-nine places for the two sides to drift.
//!
//! Refresh tokens do not belong in this file. The contract passes them in
//! plaintext so each host protects them its own way, and this host's way is the
//! OS keychain — see `secrets.rs`. `accounts.getToken` and `accounts.save` go
//! through `KeychainVault` in `db/vault.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::secrets::Secrets;
use crate::lock::LockExt;

mod accounts;
mod chats;
mod contacts;
mod local_state;
mod vault;

#[cfg(test)]
mod tests;

pub use vault::{CachedVault, KeychainVault, TokenVault};

#[derive(Debug)]
pub enum DbError {
  Sqlite(rusqlite::Error),
  Json(serde_json::Error),
  /// The operation name is not one this build answers.
  UnknownOperation(String),
  /// The argument is missing, or is the wrong shape.
  BadArgument(String),
  /// The keychain refused.
  Vault(String),
}

impl std::fmt::Display for DbError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      DbError::Sqlite(e) => write!(f, "database error: {e}"),
      DbError::Json(e) => write!(f, "json error: {e}"),
      DbError::UnknownOperation(op) => write!(f, "unknown mail store operation: {op}"),
      DbError::BadArgument(name) => write!(f, "missing or invalid argument: {name}"),
      DbError::Vault(e) => write!(f, "keychain error: {e}"),
    }
  }
}

impl From<rusqlite::Error> for DbError {
  fn from(e: rusqlite::Error) -> Self {
    DbError::Sqlite(e)
  }
}

impl From<serde_json::Error> for DbError {
  fn from(e: serde_json::Error) -> Self {
    DbError::Json(e)
  }
}

pub type DbResult<T> = Result<T, DbError>;

/// `todo.sqlite3` sits beside this one for the To-Do app. Same idea.
pub fn database_path(app_data_dir: PathBuf) -> PathBuf {
  app_data_dir.join("mail.sqlite3")
}

/// Give a file or a directory to its owner alone.
///
/// The store holds message bodies in plain text. On a machine with more than
/// one account, only the reader who owns the mail may open it. Unix makes a
/// new file readable by everybody, so the mode is set here. Windows takes the
/// permissions from the per-user data directory the file sits in, and has no
/// mode to set.
#[cfg(unix)]
fn owner_only(path: &std::path::Path, mode: u32) {
  use std::os::unix::fs::PermissionsExt;
  let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn owner_only(_path: &std::path::Path, _mode: u32) {}

/// The mail databases of the other Digital Habits apps beside this one.
///
/// Each app's data directory is named for its bundle identifier, and all of
/// them sit in one parent: every app of ours under `org.digitalhabits.`,
/// and any flavor added later. A folder left behind by
/// an app that no longer exists is read too; it lists no mailboxes, so it
/// keeps no token.
pub fn sibling_databases(own: &std::path::Path) -> Vec<PathBuf> {
  let (Some(own_dir), Some(parent)) = (own.parent(), own.parent().and_then(|d| d.parent()))
  else {
    return Vec::new();
  };
  let Ok(entries) = std::fs::read_dir(parent) else {
    return Vec::new();
  };
  let file = own.file_name().unwrap_or_default();
  let mut out: Vec<PathBuf> = entries
    .filter_map(Result::ok)
    .filter(|e| e.file_name().to_string_lossy().starts_with("org.digitalhabits."))
    .map(|e| e.path())
    .filter(|dir| dir != own_dir)
    .map(|dir| dir.join(file))
    .filter(|path| path.is_file())
    .collect();
  out.sort();
  out
}

pub struct MailDb {
  conn: Mutex<Connection>,
  pub(crate) vault: Box<dyn TokenVault>,
  /// The other Digital Habits apps' mail databases on this computer. See
  /// `listed_elsewhere`.
  siblings: Vec<PathBuf>,
  /// Removes an Exchange password. See account_exchange.rs.
  pub(crate) exchange_remover: Mutex<Option<crate::account_exchange::ExchangeRemover>>,
  /// Outbox rows that the server took, but the store could not record.
  /// See `outbox_record_sent`.
  pub(crate) outbox_unrecorded: Mutex<std::collections::HashSet<i64>>,
}

impl MailDb {
  /// The connection, for the import module. Not for operations: those go
  /// through `call`, so the contract stays the one door.
  /// The refresh token for a mailbox, from the vault. For the sync worker.
  pub fn refresh_token(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    self.vault.read(provider, email)
  }

  /// The one connection. Every operation takes it here.
  ///
  /// If a thread panicked while it held the connection, the lock is
  /// poisoned. The store goes on: an open transaction is rolled back, and
  /// the poison is cleared. See lock.rs.
  pub(crate) fn conn_mut(&self) -> std::sync::MutexGuard<'_, Connection> {
    match self.conn.lock() {
      Ok(conn) => conn,
      Err(poisoned) => {
        let conn = poisoned.into_inner();
        if !conn.is_autocommit() {
          if let Err(e) = conn.execute_batch("ROLLBACK") {
            log::warn!("[mail-db] could not roll back after a panic: {e}");
          }
        }
        self.conn.clear_poison();
        log::warn!("[mail-db] a thread panicked while it held the store; the store goes on");
        conn
      }
    }
  }

  pub fn open(path: &PathBuf, secrets: Secrets) -> DbResult<Self> {
    if let Some(parent) = path.parent() {
      let _ = std::fs::create_dir_all(parent);
      owner_only(parent, 0o700);
    }
    let conn = Connection::open(path)?;
    // Before the first write. SQLite gives the journal files the mode it
    // finds on the database, so the two beside it start owner-only too.
    owner_only(path, 0o600);
    let mut db = Self::from_connection(
      conn,
      Box::new(CachedVault::new(Box::new(KeychainVault::new(secrets)))),
    )?;
    for suffix in ["-wal", "-shm"] {
      let mut beside = path.clone().into_os_string();
      beside.push(suffix);
      owner_only(std::path::Path::new(&beside), 0o600);
    }
    db.siblings = sibling_databases(path);
    Ok(db)
  }

  /// A store on disk with no keychain, for a test that closes and opens it.
  #[cfg(test)]
  pub fn open_file_for_tests(path: &std::path::Path) -> DbResult<Self> {
    Self::from_connection(Connection::open(path)?, Box::new(tests::MemoryVault::default()))
  }

  #[cfg(test)]
  pub fn open_in_memory() -> DbResult<Self> {
    Self::from_connection(
      Connection::open_in_memory()?,
      Box::new(tests::MemoryVault::default()),
    )
  }

  fn from_connection(conn: Connection, vault: Box<dyn TokenVault>) -> DbResult<Self> {
    // WAL keeps a read during a write from blocking the interface.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let db = MailDb {
      conn: Mutex::new(conn),
      vault,
      siblings: Vec::new(),
      exchange_remover: Mutex::new(None),
      outbox_unrecorded: Mutex::new(Default::default()),
    };
    db.migrate()?;
    Ok(db)
  }

  fn migrate(&self) -> DbResult<()> {
    crate::schema::migrate(&self.conn_mut())
  }
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

pub(crate) fn str_arg(args: &Value, name: &str) -> DbResult<String> {
  args
    .get(name)
    .and_then(Value::as_str)
    .map(str::to_string)
    .ok_or_else(|| DbError::BadArgument(name.to_string()))
}

pub(crate) fn opt_str_arg(args: &Value, name: &str) -> Option<String> {
  args.get(name).and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn str_list_arg(args: &Value, name: &str) -> DbResult<Vec<String>> {
  let list = args
    .get(name)
    .and_then(Value::as_array)
    .ok_or_else(|| DbError::BadArgument(name.to_string()))?;
  Ok(
    list
      .iter()
      .filter_map(Value::as_str)
      .map(str::to_string)
      .collect(),
  )
}

pub(crate) fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// Operations this build answers: every one the TypeScript side lists.
///
/// The test `every_listed_operation_answers` reads it, and so does anyone
/// checking progress against the contract. It has no caller in the app.
#[allow(dead_code)]
pub const IMPLEMENTED: &[&str] = &[
  "settings.get",
  "settings.set",
  "listSync.load",
  "listSync.save",
  "listSync.clear",
  "snoozes.listActive",
  "snoozes.countActive",
  "snoozes.set",
  "snoozes.remove",
  "accounts.listForOwner",
  "accounts.listAll",
  "accounts.listOwnedEmails",
  "accounts.exists",
  "accounts.setInMailTab",
  "accounts.setSortOrder",
  "accounts.remove",
  "accounts.setSyncState",
  "contactSources.listState",
  "contactSources.saveState",
  "contactSources.clearError",
  "contactSources.replaceContacts",
  "contactSources.mergeHistoryContacts",
  "contactSources.countVisibleHistory",
  "contactSources.listVisible",
  "contactSources.hideHistoryContact",
  "chats.findBinding",
  "chats.findBindings",
  "chats.createConversation",
  "chats.setNoQuote",
  "chats.findOpenPart",
  "chats.findPartThreadId",
  "chats.rotatePart",
  "chats.addMessageToPart",
  "chats.reconcilePartCount",
  "chats.rememberMessageIds",
  "chats.findByMessageIds",
  "chats.bindThread",
  "chats.touch",
  "chats.listParts",
  "accounts.save",
  "accounts.getToken",
  "accounts.replaceToken",
  "messages.list",
  "messages.counts",
  "messages.thread",
  "messages.copies",
  "messages.answerLinks",
  "messages.teamStates",
  "messages.search",
  "messages.upsertMany",
  "messages.putBody",
  "messages.removeAccount",
  "messages.setUnread",
  "messages.recipients",
  "messages.labelCounts",
  "messages.applyAction",
  "messages.removeMessages",
  "sync.list",
  "sync.set",
  "actions.enqueue",
  "actions.pending",
  "actions.done",
  "actions.failed",
  "actions.doneRenaming",
  "actions.cancel",
  "actions.replay",
  "actions.restore",
];

/// Nothing is pending. Every operation the contract states is answered here.
///
/// Keep the constant. `scripts/check-store-operations.js` reads it, and a
/// future operation lands here first while its implementation is written.
#[allow(dead_code)]
pub const PENDING_KEYCHAIN: &[&str] = &[];

impl MailDb {
  pub fn call(&self, op: &str, args: &Value) -> DbResult<Value> {
    match op {
      "settings.get" => self.settings_get(args),
      "settings.set" => self.settings_set(args),

      "messages.list" => self.messages_list(args),
      "messages.counts" => self.messages_counts(args),
      "messages.thread" => self.messages_thread(args),
      "messages.copies" => self.messages_copies(args),
      "messages.answerLinks" => self.messages_answer_links(args),
      "messages.teamStates" => self.messages_team_states(args),
      "messages.search" => self.messages_search(args),
      "messages.upsertMany" => self.messages_upsert_many(args),
      "messages.putBody" => self.messages_put_body(args),
      "messages.removeAccount" => self.messages_remove_account(args),
      "messages.setUnread" => self.messages_set_unread(args),
      "messages.recipients" => self.messages_recipients(args),
      "messages.labelCounts" => self.messages_label_counts(args),
      "messages.applyAction" => self.actions_apply_local(args),
      "messages.removeMessages" => self.messages_remove_messages(args),
      "sync.list" => self.sync_list(),
      "sync.set" => self.sync_set(args),
      "actions.enqueue" => self.actions_enqueue_op(args),
      "actions.pending" => self.actions_pending_op(args),
      "actions.done" => self.actions_done_op(args),
      "actions.failed" => self.actions_failed_op(args),
      "actions.doneRenaming" => self.actions_done_renaming_op(args),
      "actions.cancel" => self.actions_cancel_op(args),
      "actions.replay" => self.actions_replay_op(args),
      "actions.restore" => self.actions_restore_op(args),
      "listSync.load" => self.list_sync_load(args),
      "listSync.save" => self.list_sync_save(args),
      "listSync.clear" => self.list_sync_clear(),
      "snoozes.listActive" => self.snoozes_list_active(args),
      "snoozes.countActive" => self.snoozes_count_active(args),
      "snoozes.set" => self.snoozes_set(args),
      "snoozes.remove" => self.snoozes_remove(args),

      "accounts.listForOwner" => self.accounts_list_for_owner(args),
      "accounts.listAll" => self.accounts_list_all(args),
      "accounts.listOwnedEmails" => self.accounts_list_owned_emails(args),
      "accounts.exists" => self.accounts_exists(args),
      "accounts.setInMailTab" => self.accounts_set_in_mail_tab(args),
      "accounts.setSortOrder" => self.accounts_set_sort_order(args),
      "accounts.remove" => self.accounts_remove(args),
      "accounts.setSyncState" => self.accounts_set_sync_state(args),

      "contactSources.listState" => self.sources_list_state(),
      "contactSources.saveState" => self.sources_save_state(args),
      "contactSources.clearError" => self.sources_clear_error(args),
      "contactSources.replaceContacts" => self.sources_replace_contacts(args),
      "contactSources.mergeHistoryContacts" => self.sources_merge_history(args),
      "contactSources.countVisibleHistory" => self.sources_count_history(args),
      "contactSources.listVisible" => self.sources_list_visible(args),
      "contactSources.hideHistoryContact" => self.sources_hide_history(args),

      "chats.findBinding" => self.chats_find_binding(args),
      "chats.findBindings" => self.chats_find_bindings(args),
      "chats.createConversation" => self.chats_create(args),
      "chats.setNoQuote" => self.chats_set_no_quote(args),
      "chats.findOpenPart" => self.chats_find_open_part(args),
      "chats.findPartThreadId" => self.chats_find_part_thread(args),
      "chats.rotatePart" => self.chats_rotate_part(args),
      "chats.addMessageToPart" => self.chats_add_message(args),
      "chats.reconcilePartCount" => self.chats_reconcile_count(args),
      "chats.rememberMessageIds" => self.chats_remember_message_ids(args),
      "chats.findByMessageIds" => self.chats_find_by_message_ids(args),
      "chats.bindThread" => self.chats_bind_thread(args),
      "chats.touch" => self.chats_touch(args),
      "chats.listParts" => self.chats_list_parts(args),

      "accounts.save" => self.accounts_save(args),
      "accounts.getToken" => self.accounts_get_token(args),
      "accounts.replaceToken" => self.accounts_replace_token(args),

      other => Err(DbError::UnknownOperation(other.to_string())),
    }
  }

}
