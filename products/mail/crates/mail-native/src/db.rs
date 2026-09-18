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
//! through `KeychainVault` below.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::secrets::Secrets;

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

/// The mail databases of the other Digital Habits apps beside this one.
///
/// Each app's data directory is named for its bundle identifier, and all of
/// them sit in one parent: Mail, Mail (Internal) and the Planner, and any
/// flavor added later under `org.digitalhabits.`. A folder left behind by
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

/// Where refresh tokens are kept.
///
/// Not in the SQLite file. The contract hands tokens over in plaintext exactly
/// so each host can protect them its own way, and this host's way is the
/// operating system keychain. A copy of the database is then worth nothing to
/// anyone without the keychain too.
pub trait TokenVault: Send + Sync {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()>;
  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>>;
  fn remove(&self, provider: &str, email: &str) -> DbResult<()>;
}

/// The OS keychain, through `Secrets`. One item per mailbox.
pub struct KeychainVault {
  secrets: Secrets,
}

impl KeychainVault {
  pub fn new(secrets: Secrets) -> Self {
    KeychainVault { secrets }
  }
}

impl TokenVault for KeychainVault {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()> {
    self
      .secrets
      .set(&vault_key(provider, email), token)
      .map_err(DbError::Vault)
  }

  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    self.secrets.get(&vault_key(provider, email)).map_err(DbError::Vault)
  }

  fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
    self.secrets.delete(&vault_key(provider, email)).map_err(DbError::Vault)
  }
}

/// A vault that reads each token once per launch.
///
/// **The keychain asks the operating system, and the operating system asks the
/// user.** Every read is a chance for macOS to put a password prompt on screen,
/// and the mail core asks for a token whenever its own cache expires — which,
/// in development, is every time the webview reloads, because that cache lives
/// in the page. One save became one prompt.
///
/// So the token is held for the life of the process. It is already in memory
/// whenever it is used; this only widens that to the session, on a
/// single-user desktop app whose whole database sits in the same process.
///
/// A write of a new value goes straight through and updates what is held, so a
/// rotated Microsoft token is never served stale. A write of the value already
/// held is skipped. The keychain asks the operating system, and the operating
/// system asks the reader, so the cheapest prompt is the one never requested.
pub struct CachedVault {
  inner: Box<dyn TokenVault>,
  seen: Mutex<HashMap<String, Option<String>>>,
}

impl CachedVault {
  pub fn new(inner: Box<dyn TokenVault>) -> Self {
    CachedVault { inner, seen: Mutex::new(HashMap::new()) }
  }
}

fn vault_key(provider: &str, email: &str) -> String {
  format!("{provider}:{email}")
}

impl TokenVault for CachedVault {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()> {
    let key = vault_key(provider, email);
    // Compare what is held. A read of the keychain to decide this would put
    // the prompt back on screen, which is the thing this skip removes.
    if let Some(Some(held)) = self.seen.lock().unwrap().get(&key) {
      if held == token {
        return Ok(());
      }
    }
    self.inner.store(provider, email, token)?;
    self.seen.lock().unwrap().insert(key, Some(token.to_string()));
    Ok(())
  }

  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    let key = vault_key(provider, email);
    if let Some(held) = self.seen.lock().unwrap().get(&key) {
      return Ok(held.clone());
    }
    let token = self.inner.read(provider, email)?;
    // A missing token is remembered too, or every read of a mailbox that has
    // none goes back to the keychain.
    self.seen.lock().unwrap().insert(key, token.clone());
    Ok(token)
  }

  fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
    self.inner.remove(provider, email)?;
    self.seen.lock().unwrap().insert(vault_key(provider, email), None);
    Ok(())
  }
}

pub struct MailDb {
  conn: Mutex<Connection>,
  vault: Box<dyn TokenVault>,
  /// The other Digital Habits apps' mail databases on this computer. See
  /// `listed_elsewhere`.
  siblings: Vec<PathBuf>,
}

impl MailDb {
  /// The connection, for the import module. Not for operations: those go
  /// through `call`, so the contract stays the one door.
  /// The refresh token for a mailbox, from the vault. For the sync worker.
  pub fn refresh_token(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    self.vault.read(provider, email)
  }

  pub(crate) fn conn_mut(&self) -> std::sync::MutexGuard<'_, Connection> {
    self.conn.lock().unwrap()
  }

  pub fn open(path: &PathBuf, secrets: Secrets) -> DbResult<Self> {
    if let Some(parent) = path.parent() {
      let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    let mut db = Self::from_connection(
      conn,
      Box::new(CachedVault::new(Box::new(KeychainVault::new(secrets)))),
    )?;
    db.siblings = sibling_databases(path);
    Ok(db)
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
    };
    db.migrate()?;
    Ok(db)
  }

  fn migrate(&self) -> DbResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- One cached provider list page per mailbox and folder.
      CREATE TABLE IF NOT EXISTS list_sync_state (
        owner_id         TEXT NOT NULL,
        folder           TEXT NOT NULL,
        account_email    TEXT NOT NULL,
        history_id       TEXT,
        next_page_token  TEXT,
        rows             TEXT NOT NULL,
        rows_fingerprint TEXT,
        updated_at       INTEGER NOT NULL,
        PRIMARY KEY (owner_id, folder, account_email)
      );

      CREATE TABLE IF NOT EXISTS snoozes (
        account_email   TEXT NOT NULL,
        thread_id       TEXT NOT NULL,
        snoozed_until   TEXT NOT NULL,
        tip_message_id  TEXT,
        created_at      INTEGER NOT NULL,
        PRIMARY KEY (account_email, thread_id)
      );
      CREATE INDEX IF NOT EXISTS snoozes_until_idx ON snoozes (snoozed_until);

      -- Connected mailboxes. Refresh tokens are NOT here: they go to the
      -- keychain. See the note at the top of this file.
      CREATE TABLE IF NOT EXISTS accounts (
        provider        TEXT NOT NULL,
        email           TEXT NOT NULL,
        owner_id        TEXT NOT NULL,
        history_id      TEXT,
        last_synced_at  TEXT,
        last_sync_error TEXT,
        in_mail_tab     INTEGER NOT NULL DEFAULT 1,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (provider, email, owner_id)
      );

      CREATE TABLE IF NOT EXISTS contact_source_state (
        source     TEXT NOT NULL,
        account    TEXT NOT NULL,
        synced_at  TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        PRIMARY KEY (source, account)
      );

      CREATE TABLE IF NOT EXISTS source_contacts (
        source          TEXT NOT NULL,
        account         TEXT NOT NULL,
        email           TEXT NOT NULL,
        name            TEXT NOT NULL DEFAULT '',
        last_emailed_at TEXT,
        hidden          INTEGER NOT NULL DEFAULT 0,
        synced_at       TEXT,
        -- The address book's own id for the card this address is on, so two
        -- addresses on one card are one person. NULL for history rows.
        card            TEXT,
        PRIMARY KEY (source, account, email)
      );

      -- A conversation, its parts, and the provider threads bound to them.
      CREATE TABLE IF NOT EXISTS chats (
        id                      TEXT PRIMARY KEY,
        title                   TEXT NOT NULL,
        created_by_account      TEXT NOT NULL,
        participant_fingerprint TEXT NOT NULL,
        participant_emails      TEXT NOT NULL DEFAULT '[]',
        status                  TEXT NOT NULL DEFAULT 'active',
        rotate_at               INTEGER NOT NULL,
        no_quote                INTEGER NOT NULL DEFAULT 0,
        updated_at              INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_parts (
        id            TEXT PRIMARY KEY,
        chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        part_index    INTEGER NOT NULL,
        subject       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'open',
        message_count INTEGER NOT NULL DEFAULT 0,
        opened_at     TEXT,
        closed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS chat_parts_chat_idx ON chat_parts (chat_id);

      CREATE TABLE IF NOT EXISTS chat_part_bindings (
        part_id                 TEXT NOT NULL REFERENCES chat_parts(id) ON DELETE CASCADE,
        account_email           TEXT NOT NULL,
        provider                TEXT NOT NULL,
        provider_thread_id      TEXT NOT NULL,
        provider_tip_message_id TEXT,
        PRIMARY KEY (account_email, provider_thread_id)
      );
      CREATE INDEX IF NOT EXISTS chat_bindings_part_idx ON chat_part_bindings (part_id);

      -- The RFC Message-IDs a bound thread holds. A thread the provider
      -- split off references these, and the reference is how it rejoins
      -- its conversation. See docs/mail-chat-architecture.md.
      CREATE TABLE IF NOT EXISTS chat_message_ids (
        account_email  TEXT NOT NULL,
        rfc_message_id TEXT NOT NULL,
        chat_id        TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        part_id        TEXT NOT NULL,
        PRIMARY KEY (account_email, rfc_message_id)
      );
      CREATE INDEX IF NOT EXISTS chat_message_ids_chat_idx ON chat_message_ids (chat_id);

      "#,
    )?;
    // Books made before the card column existed. SQLite has no "add if
    // missing", so the duplicate-column error is the one to swallow.
    let _ = conn.execute("ALTER TABLE source_contacts ADD COLUMN card TEXT", []);
    crate::outbox::migrate(&conn)?;
    // The local copy of the mail lives in its own module.
    crate::messages::migrate(&conn)?;
    conn.execute_batch(crate::actions::SCHEMA)?;
    conn.execute_batch(crate::outbox::SCHEMA)?;
    Ok(())
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

/// Operations this build answers. The TypeScript side lists 39 in all.
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

  // --- accounts ---------------------------------------------------------

  fn account_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "email": r.get::<_, String>(0)?,
      "ownerId": r.get::<_, String>(1)?,
      "historyId": r.get::<_, Option<String>>(2)?,
      "lastSyncedAt": r.get::<_, Option<String>>(3)?,
      "lastSyncError": r.get::<_, Option<String>>(4)?,
      "inMailTab": r.get::<_, i64>(5)? != 0,
    }))
  }

  fn accounts_list_for_owner(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT email, owner_id, history_id, last_synced_at, last_sync_error, in_mail_tab
         FROM accounts WHERE provider = ?1 AND owner_id = ?2
        ORDER BY sort_order, email",
    )?;
    let rows = stmt.query_map(params![provider, owner_id], Self::account_row)?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  /// One record per mailbox across owners. A row with a checkpoint wins, so
  /// sync does not restart when several owners connected the same mailbox.
  fn accounts_list_all(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT email, owner_id, history_id, last_synced_at, last_sync_error, in_mail_tab
         FROM accounts WHERE provider = ?1
        GROUP BY email
        HAVING history_id IS NOT NULL OR MAX(updated_at) = updated_at
        ORDER BY email",
    )?;
    let rows = stmt.query_map(params![provider], Self::account_row)?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  fn accounts_list_owned_emails(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let wanted = str_list_arg(args, "emails")?;
    if wanted.is_empty() {
      return Ok(json!([]));
    }
    let conn = self.conn.lock().unwrap();
    let mut stmt =
      conn.prepare("SELECT email FROM accounts WHERE provider = ?1 AND owner_id = ?2")?;
    let rows = stmt.query_map(params![provider, owner_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
      let email = row?;
      if wanted.contains(&email) {
        out.push(Value::String(email));
      }
    }
    Ok(Value::Array(out))
  }

  fn accounts_exists(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let conn = self.conn.lock().unwrap();
    let n: i64 = conn.query_row(
      "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
      params![provider, email],
      |r| r.get(0),
    )?;
    Ok(json!(n > 0))
  }

  fn accounts_set_in_mail_tab(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let email = str_arg(args, "email")?;
    let in_tab = args
      .get("inMailTab")
      .and_then(Value::as_bool)
      .ok_or_else(|| DbError::BadArgument("inMailTab".into()))?;
    let conn = self.conn.lock().unwrap();
    let n = conn.execute(
      "UPDATE accounts SET in_mail_tab = ?4, updated_at = ?5
        WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
      params![provider, owner_id, email, in_tab as i64, now_ms()],
    )?;
    Ok(json!(n > 0))
  }

  fn accounts_set_sort_order(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let emails = str_list_arg(args, "emails")?;
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    for (index, email) in emails.iter().enumerate() {
      tx.execute(
        "UPDATE accounts SET sort_order = ?4, updated_at = ?5
          WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
        params![provider, owner_id, email, index as i64, now_ms()],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  fn accounts_remove(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let email = str_arg(args, "email")?;
    let conn = self.conn.lock().unwrap();
    let n = conn.execute(
      "DELETE FROM accounts WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
      params![provider, owner_id, email],
    )?;
    if n > 0 {
      // The token goes when the last owner does, and not before.
      let left: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
        params![provider, email],
        |r| r.get(0),
      )?;
      drop(conn);
      if left == 0 && !self.listed_elsewhere(&provider, &email) {
        self.vault.remove(&provider, &email)?;
      }
    }
    Ok(json!(n > 0))
  }

  /// Whether another Digital Habits app on this computer still lists the
  /// mailbox.
  ///
  /// The apps keep separate account lists but share one keychain entry per
  /// mailbox, so a mailbox connected in one works in the others. Removing it
  /// from one app must not delete the token the others still use: they
  /// would show the mailbox and fail to read it.
  ///
  /// Read-only, and a database that cannot be read counts as a yes. A
  /// token left behind is less harm than a mailbox broken in another app.
  fn listed_elsewhere(&self, provider: &str, email: &str) -> bool {
    self.siblings.iter().any(|path| {
      let found = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
      )
      .and_then(|conn| {
        conn.busy_timeout(std::time::Duration::from_millis(500))?;
        conn.query_row(
          "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
          params![provider, email],
          |r| r.get::<_, i64>(0),
        )
      });
      match found {
        Ok(n) => n > 0,
        Err(err) => {
          log::warn!(
            "[mail] couldn't read {}; keeping the shared token: {err}",
            path.display()
          );
          true
        }
      }
    })
  }

  /// The checkpoint is mailbox state, not owner state, so every row for the
  /// address moves together.
  fn accounts_set_sync_state(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let update = args
      .get("update")
      .ok_or_else(|| DbError::BadArgument("update".into()))?;
    let history_id = update.get("historyId").and_then(Value::as_str);
    let error = update.get("error").and_then(Value::as_str);
    let synced_at = if error.is_none() {
      opt_str_arg(args, "now")
    } else {
      None
    };
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE accounts
          SET history_id = COALESCE(?3, history_id),
              last_synced_at = COALESCE(?4, last_synced_at),
              last_sync_error = ?5,
              updated_at = ?6
        WHERE provider = ?1 AND email = ?2",
      params![provider, email, history_id, synced_at, error, now_ms()],
    )?;
    Ok(Value::Null)
  }

  /// Store the mailbox and hand its token to the keychain.
  ///
  /// A fresh token means the old checkpoint no longer applies, so it clears.
  fn accounts_save(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let email = str_arg(input, "email")?;
    let owner_id = str_arg(input, "ownerId")?;
    let token = str_arg(input, "refreshToken")?;
    {
      let conn = self.conn.lock().unwrap();
      conn.execute(
        "INSERT INTO accounts (provider, email, owner_id, history_id, last_sync_error, updated_at)
         VALUES (?1, ?2, ?3, NULL, NULL, ?4)
         ON CONFLICT(provider, email, owner_id) DO UPDATE SET
           history_id = NULL, last_sync_error = NULL, updated_at = ?4",
        params![provider, email, owner_id, now_ms()],
      )?;
    }
    // The row is worthless without the token, so a keychain refusal reaches the
    // caller rather than leaving a mailbox that silently cannot sign in.
    self.vault.store(&provider, &email, &token)?;
    Ok(Value::Null)
  }

  /// The freshest stored token for a mailbox, with the owner row it came from.
  fn accounts_get_token(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let owner: Option<String> = {
      let conn = self.conn.lock().unwrap();
      conn
        .query_row(
          "SELECT owner_id FROM accounts WHERE provider = ?1 AND email = ?2
            ORDER BY updated_at DESC LIMIT 1",
          params![provider, email],
          |r| r.get(0),
        )
        .optional()?
    };
    let Some(owner_id) = owner else {
      return Ok(Value::Null);
    };
    match self.vault.read(&provider, &email)? {
      Some(refresh_token) => Ok(json!({
        "refreshToken": refresh_token,
        "ownerId": owner_id,
      })),
      None => Ok(Value::Null),
    }
  }

  /// Write a rotated token back. Microsoft rotates on refresh.
  fn accounts_replace_token(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let token = str_arg(args, "refreshToken")?;
    self.vault.store(&provider, &email, &token)?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE accounts SET updated_at = ?3 WHERE provider = ?1 AND email = ?2",
      params![provider, email, now_ms()],
    )?;
    Ok(Value::Null)
  }

  // --- contact sources --------------------------------------------------

  fn sources_list_state(&self) -> DbResult<Value> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT source, account, synced_at, item_count, last_error FROM contact_source_state",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok(json!({
        "source": r.get::<_, String>(0)?,
        "account": r.get::<_, String>(1)?,
        "syncedAt": r.get::<_, Option<String>>(2)?,
        "itemCount": r.get::<_, i64>(3)?,
        "lastError": r.get::<_, Option<String>>(4)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  fn sources_save_state(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let update = args
      .get("update")
      .ok_or_else(|| DbError::BadArgument("update".into()))?;
    let count = update.get("count").and_then(Value::as_i64);
    let error = update.get("error").and_then(Value::as_str);
    let synced = update.get("synced").and_then(Value::as_bool).unwrap_or(false);
    let synced_at = if synced { opt_str_arg(args, "now") } else { None };
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO contact_source_state (source, account, synced_at, item_count, last_error)
       VALUES (?1, ?2, ?3, COALESCE(?4, 0), ?5)
       ON CONFLICT(source, account) DO UPDATE SET
         synced_at = COALESCE(?3, contact_source_state.synced_at),
         item_count = COALESCE(?4, contact_source_state.item_count),
         last_error = ?5",
      params![source, account, synced_at, count, error],
    )?;
    Ok(Value::Null)
  }

  fn sources_clear_error(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE contact_source_state SET last_error = NULL WHERE source = ?1 AND account = ?2",
      params![source, account],
    )?;
    Ok(Value::Null)
  }

  /// Replace an address book whole. A reader must never see the gap.
  fn sources_replace_contacts(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let contacts = args
      .get("contacts")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("contacts".into()))?
      .clone();
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute(
      "DELETE FROM source_contacts WHERE source = ?1 AND account = ?2",
      params![source, account],
    )?;
    for contact in &contacts {
      let email = contact.get("email").and_then(Value::as_str).unwrap_or("");
      if email.is_empty() {
        continue;
      }
      let name = contact.get("name").and_then(Value::as_str).unwrap_or("");
      let card = contact.get("card").and_then(Value::as_str).filter(|c| !c.is_empty());
      tx.execute(
        "INSERT INTO source_contacts (source, account, email, name, synced_at, card)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source, account, email)
         DO UPDATE SET name = ?4, synced_at = ?5, card = ?6",
        params![source, account, email, name, now, card],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  /// A stored name wins over an empty one, and the latest send time wins.
  fn sources_merge_history(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let contacts = args
      .get("contacts")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("contacts".into()))?
      .clone();
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    for contact in &contacts {
      let email = contact.get("email").and_then(Value::as_str).unwrap_or("");
      if email.is_empty() {
        continue;
      }
      let name = contact.get("name").and_then(Value::as_str).unwrap_or("");
      let last = contact.get("lastEmailedAt").and_then(Value::as_str);
      tx.execute(
        "INSERT INTO source_contacts
           (source, account, email, name, last_emailed_at, synced_at)
         VALUES ('history', ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source, account, email) DO UPDATE SET
           name = CASE WHEN source_contacts.name = '' THEN ?3 ELSE source_contacts.name END,
           last_emailed_at = CASE
             WHEN ?4 IS NULL THEN source_contacts.last_emailed_at
             WHEN source_contacts.last_emailed_at IS NULL THEN ?4
             WHEN ?4 > source_contacts.last_emailed_at THEN ?4
             ELSE source_contacts.last_emailed_at END,
           synced_at = ?5",
        params![account, email, name, last, now],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  fn sources_count_history(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let conn = self.conn.lock().unwrap();
    let n: i64 = conn.query_row(
      "SELECT COUNT(*) FROM source_contacts
        WHERE source = 'history' AND account = ?1 AND hidden = 0",
      params![account],
      |r| r.get(0),
    )?;
    Ok(json!(n))
  }

  /// Address books before history, so the caller keeps the first row it sees.
  fn sources_list_visible(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!([]));
    }
    let conn = self.conn.lock().unwrap();
    // 'mac' sorts first: the book the reader keeps by hand, so its spelling of
    // a name wins over one a provider saved automatically.
    let mut stmt = conn.prepare(
      "SELECT source, account, email, name, last_emailed_at, card
         FROM source_contacts WHERE hidden = 0
        ORDER BY CASE source WHEN 'mac' THEN 0 WHEN 'google' THEN 1
                             WHEN 'outlook' THEN 2 ELSE 3 END",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?,
        r.get::<_, Option<String>>(5)?,
      ))
    })?;
    let mut out = Vec::new();
    for row in rows {
      let (source, account, email, name, last, card) = row?;
      // The Mac book belongs to the machine and carries no account, so the
      // mailbox filter would drop every row of it.
      if source != "mac" && !accounts.iter().any(|a| a.eq_ignore_ascii_case(&account)) {
        continue;
      }
      out.push(json!({
        "source": source, "account": account, "email": email,
        "name": name, "lastEmailedAt": last, "card": card,
      }));
    }
    Ok(Value::Array(out))
  }

  /// The contacts Mail knows, for the planner's own pickers: a name and an
  /// address each, once per address.
  ///
  /// Not a store operation. The planner window may not call `mail_store_call`,
  /// which reaches the whole mailbox; it gets this one read instead, through
  /// its own command. The rows are those the compose field suggests: the Mac
  /// book, and the address books and sent history of the mailboxes still
  /// connected. Hidden history rows stay hidden. An address met twice keeps
  /// the first name found (Mac, Google, Outlook, history, as in
  /// `sources_list_visible`) and its latest send time.
  pub fn planner_contacts(&self) -> DbResult<Value> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT sc.email, sc.name, sc.last_emailed_at
         FROM source_contacts sc
        WHERE sc.hidden = 0
          AND (sc.source = 'mac'
               OR EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(sc.account)))
        ORDER BY CASE sc.source WHEN 'mac' THEN 0 WHEN 'google' THEN 1
                                WHEN 'outlook' THEN 2 ELSE 3 END",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, Option<String>>(2)?,
      ))
    })?;
    let mut order: Vec<String> = Vec::new();
    let mut by_email: std::collections::HashMap<String, (String, String, Option<String>)> =
      std::collections::HashMap::new();
    for row in rows {
      let (email, name, last) = row?;
      let key = email.trim().to_lowercase();
      if key.is_empty() {
        continue;
      }
      match by_email.get_mut(&key) {
        Some(entry) => {
          if entry.1.trim().is_empty() && !name.trim().is_empty() {
            entry.1 = name;
          }
          if last.is_some() && (entry.2.is_none() || last > entry.2) {
            entry.2 = last;
          }
        }
        None => {
          order.push(key.clone());
          by_email.insert(key, (email.trim().to_string(), name, last));
        }
      }
    }
    let out = order
      .into_iter()
      .filter_map(|key| by_email.remove(&key))
      .map(|(email, name, last)| {
        json!({ "email": email, "name": name.trim(), "lastEmailedAt": last })
      })
      .collect();
    Ok(Value::Array(out))
  }

  fn sources_hide_history(&self, args: &Value) -> DbResult<Value> {
    let email = str_arg(args, "email")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE source_contacts SET hidden = 1 WHERE source = 'history' AND email = ?1",
      params![email],
    )?;
    Ok(Value::Null)
  }

  // --- conversations ----------------------------------------------------

  /// Columns every binding read returns, joined across the three tables.
  const BINDING_SQL: &'static str = "
    SELECT c.id, c.title, p.part_index, p.subject, p.status, c.rotate_at,
           p.message_count, c.participant_emails, c.no_quote,
           (SELECT COUNT(*) FROM chat_parts p2 WHERE p2.chat_id = c.id),
           b.account_email, b.provider_thread_id
      FROM chat_part_bindings b
      JOIN chat_parts p ON p.id = b.part_id
      JOIN chats c ON c.id = p.chat_id";

  fn binding_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Value)> {
    let participants: String = r.get(7)?;
    let key = format!("{}|{}", r.get::<_, String>(10)?, r.get::<_, String>(11)?);
    Ok((
      key,
      json!({
        "chatId": r.get::<_, String>(0)?,
        "title": r.get::<_, String>(1)?,
        "partIndex": r.get::<_, i64>(2)?,
        "subject": r.get::<_, String>(3)?,
        "partStatus": r.get::<_, String>(4)?,
        "rotateAt": r.get::<_, i64>(5)?,
        "messageCount": r.get::<_, i64>(6)?,
        "participantEmails": serde_json::from_str::<Value>(&participants).unwrap_or(json!([])),
        "noQuote": r.get::<_, i64>(8)? != 0,
        "partCount": r.get::<_, i64>(9)?,
      }),
    ))
  }

  fn chats_find_binding(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn.lock().unwrap();
    let sql = format!(
      "{} WHERE b.account_email = ?1 AND b.provider_thread_id = ?2 LIMIT 1",
      Self::BINDING_SQL
    );
    let found = conn
      .query_row(&sql, params![account, thread_id], Self::binding_row)
      .optional()?;
    Ok(found.map(|(_, v)| v).unwrap_or(Value::Null))
  }

  fn chats_find_bindings(&self, args: &Value) -> DbResult<Value> {
    let keys = args
      .get("keys")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("keys".into()))?;
    let wanted: Vec<String> = keys
      .iter()
      .filter_map(|k| {
        let a = k.get("account").and_then(Value::as_str)?;
        let t = k.get("threadId").and_then(Value::as_str)?;
        Some(format!("{a}|{t}"))
      })
      .collect();
    if wanted.is_empty() {
      return Ok(json!({}));
    }
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(Self::BINDING_SQL)?;
    let rows = stmt.query_map([], Self::binding_row)?;
    let mut out = serde_json::Map::new();
    for row in rows {
      let (key, value) = row?;
      if wanted.contains(&key) {
        out.insert(key, value);
      }
    }
    Ok(Value::Object(out))
  }

  /// The conversation, its first part, and the binding must land together.
  /// A half-created conversation has no open part, and every send then fails.
  fn chats_create(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let chat_id = str_arg(input, "chatId")?;
    let part_id = str_arg(input, "partId")?;
    let now = opt_str_arg(args, "now");
    let participants = input
      .get("participantEmails")
      .cloned()
      .unwrap_or(json!([]))
      .to_string();
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute(
      "INSERT INTO chats (id, title, created_by_account, participant_fingerprint,
                          participant_emails, status, rotate_at, no_quote, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)",
      params![
        chat_id,
        str_arg(input, "title")?,
        str_arg(input, "createdByAccount")?,
        str_arg(input, "participantFingerprint")?,
        participants,
        input.get("rotateAt").and_then(Value::as_i64).unwrap_or(1000),
        input.get("noQuote").and_then(Value::as_bool).unwrap_or(false) as i64,
        now_ms()
      ],
    )?;
    tx.execute(
      "INSERT INTO chat_parts (id, chat_id, part_index, subject, status, message_count, opened_at)
       VALUES (?1, ?2, 1, ?3, 'open', ?4, ?5)",
      params![
        part_id,
        chat_id,
        str_arg(input, "subject")?,
        input.get("messageCount").and_then(Value::as_i64).unwrap_or(0),
        now
      ],
    )?;
    tx.execute(
      "INSERT INTO chat_part_bindings (part_id, account_email, provider, provider_thread_id)
       VALUES (?1, ?2, ?3, ?4)",
      params![
        part_id,
        str_arg(input, "createdByAccount")?,
        str_arg(input, "provider")?,
        str_arg(input, "threadId")?
      ],
    )?;
    tx.commit()?;
    Ok(Value::Null)
  }

  fn chats_set_no_quote(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let no_quote = args
      .get("noQuote")
      .and_then(Value::as_bool)
      .ok_or_else(|| DbError::BadArgument("noQuote".into()))?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chats SET no_quote = ?2, updated_at = ?3 WHERE id = ?1",
      params![chat_id, no_quote as i64, now_ms()],
    )?;
    Ok(Value::Null)
  }

  fn chats_find_open_part(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn.lock().unwrap();
    let found = conn
      .query_row(
        "SELECT id, part_index, subject, message_count FROM chat_parts
          WHERE chat_id = ?1 AND status = 'open' ORDER BY part_index DESC LIMIT 1",
        params![chat_id],
        |r| {
          Ok(json!({
            "partId": r.get::<_, String>(0)?,
            "partIndex": r.get::<_, i64>(1)?,
            "subject": r.get::<_, String>(2)?,
            "messageCount": r.get::<_, i64>(3)?,
          }))
        },
      )
      .optional()?;
    Ok(found.unwrap_or(Value::Null))
  }

  fn chats_find_part_thread(&self, args: &Value) -> DbResult<Value> {
    let part_id = str_arg(args, "partId")?;
    let account = str_arg(args, "account")?;
    let conn = self.conn.lock().unwrap();
    let found: Option<String> = conn
      .query_row(
        "SELECT provider_thread_id FROM chat_part_bindings
          WHERE part_id = ?1 AND account_email = ?2",
        params![part_id, account],
        |r| r.get(0),
      )
      .optional()?;
    Ok(found.map(Value::String).unwrap_or(Value::Null))
  }

  /// Close the current part and open the next. Both must land together.
  fn chats_rotate_part(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute(
      "UPDATE chat_parts SET status = 'closed', closed_at = ?2 WHERE id = ?1",
      params![str_arg(input, "closePartId")?, now],
    )?;
    tx.execute(
      "INSERT INTO chat_parts (id, chat_id, part_index, subject, status, message_count, opened_at)
       VALUES (?1, ?2, ?3, ?4, 'open', 0, ?5)",
      params![
        str_arg(input, "nextPartId")?,
        str_arg(input, "chatId")?,
        input.get("nextIndex").and_then(Value::as_i64).unwrap_or(0),
        str_arg(input, "nextSubject")?,
        now
      ],
    )?;
    tx.execute(
      "UPDATE chats SET updated_at = ?2 WHERE id = ?1",
      params![str_arg(input, "chatId")?, now_ms()],
    )?;
    tx.commit()?;
    Ok(Value::Null)
  }

  fn chats_add_message(&self, args: &Value) -> DbResult<Value> {
    let part_id = str_arg(args, "partId")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chat_parts SET message_count = message_count + 1 WHERE id = ?1",
      params![part_id],
    )?;
    Ok(Value::Null)
  }

  /// Set a part's count to what the provider's thread holds.
  ///
  /// `chats_add_message` counts our sends and nobody else's, so a part where
  /// the other person writes too undercounts until a read corrects it here.
  /// An unbound thread updates nothing, and that is the right answer.
  fn chats_reconcile_count(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let count = input
      .get("messageCount")
      .and_then(Value::as_i64)
      .ok_or_else(|| DbError::BadArgument("messageCount".into()))?
      .max(0);
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chat_parts SET message_count = ?3
        WHERE id = (SELECT part_id FROM chat_part_bindings
                     WHERE account_email = ?1 AND provider_thread_id = ?2)
          AND message_count <> ?3",
      params![str_arg(input, "account")?, str_arg(input, "threadId")?, count],
    )?;
    Ok(Value::Null)
  }

  /// Remember which RFC Message-IDs a bound thread holds.
  fn chats_remember_message_ids(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let account = str_arg(input, "account")?;
    let thread_id = str_arg(input, "threadId")?;
    let ids: Vec<String> = input
      .get("messageIds")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("messageIds".into()))?
      .iter()
      .filter_map(|v| v.as_str())
      .filter(|v| !v.is_empty())
      .map(str::to_owned)
      .collect();
    let conn = self.conn.lock().unwrap();
    // The binding names the part. An unbound thread remembers nothing.
    let Some((chat_id, part_id)) = conn
      .query_row(
        "SELECT p.chat_id, p.id FROM chat_part_bindings b
           JOIN chat_parts p ON p.id = b.part_id
          WHERE b.account_email = ?1 AND b.provider_thread_id = ?2",
        params![account, thread_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
      )
      .optional()?
    else {
      return Ok(Value::Null);
    };
    for id in ids {
      conn.execute(
        "INSERT OR IGNORE INTO chat_message_ids
           (account_email, rfc_message_id, chat_id, part_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![account, id, chat_id, part_id],
      )?;
    }
    Ok(Value::Null)
  }

  /// The conversation that holds any of these Message-IDs, or null.
  fn chats_find_by_message_ids(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let ids: Vec<String> = args
      .get("messageIds")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("messageIds".into()))?
      .iter()
      .filter_map(|v| v.as_str())
      .filter(|v| !v.is_empty())
      .map(str::to_owned)
      .collect();
    let conn = self.conn.lock().unwrap();
    for id in ids {
      let hit = conn
        .query_row(
          "SELECT c.id, c.title, c.participant_emails, c.no_quote
             FROM chat_message_ids m JOIN chats c ON c.id = m.chat_id
            WHERE m.account_email = ?1 AND m.rfc_message_id = ?2",
          params![account, id],
          |r| {
            Ok((
              r.get::<_, String>(0)?,
              r.get::<_, String>(1)?,
              r.get::<_, String>(2)?,
              r.get::<_, i64>(3)?,
            ))
          },
        )
        .optional()?;
      if let Some((chat_id, title, participants, no_quote)) = hit {
        let emails: Value =
          serde_json::from_str(&participants).unwrap_or_else(|_| json!([]));
        return Ok(json!({
          "chatId": chat_id,
          "title": title,
          "participantEmails": emails,
          "noQuote": no_quote != 0,
        }));
      }
    }
    Ok(Value::Null)
  }

  fn chats_bind_thread(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let tip = opt_str_arg(input, "tipMessageId");
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO chat_part_bindings
         (part_id, account_email, provider, provider_thread_id, provider_tip_message_id)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_email, provider_thread_id) DO UPDATE SET
         provider_tip_message_id =
           COALESCE(?5, chat_part_bindings.provider_tip_message_id),
         part_id = ?1",
      params![
        str_arg(input, "partId")?,
        str_arg(input, "account")?,
        str_arg(input, "provider")?,
        str_arg(input, "threadId")?,
        tip
      ],
    )?;
    Ok(Value::Null)
  }

  fn chats_touch(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chats SET updated_at = ?2 WHERE id = ?1",
      params![chat_id, now_ms()],
    )?;
    Ok(Value::Null)
  }

  fn chats_list_parts(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT p.part_index, p.subject, p.status, b.provider_thread_id,
              p.opened_at, p.closed_at, p.message_count
         FROM chat_parts p
         JOIN chat_part_bindings b ON b.part_id = p.id AND b.account_email = ?1
        WHERE p.chat_id = ?2
        ORDER BY p.part_index ASC",
    )?;
    let rows = stmt.query_map(params![account, chat_id], |r| {
      Ok(json!({
        "partIndex": r.get::<_, i64>(0)?,
        "subject": r.get::<_, String>(1)?,
        "status": r.get::<_, String>(2)?,
        "providerThreadId": r.get::<_, String>(3)?,
        "openedAt": r.get::<_, Option<String>>(4)?,
        "closedAt": r.get::<_, Option<String>>(5)?,
        "messageCount": r.get::<_, i64>(6)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  // --- settings ---------------------------------------------------------

  fn settings_get(&self, args: &Value) -> DbResult<Value> {
    let key = str_arg(args, "key")?;
    let conn = self.conn.lock().unwrap();
    let value: Option<String> = conn
      .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
        r.get(0)
      })
      .optional()?;
    Ok(value.map(Value::String).unwrap_or(Value::Null))
  }

  fn settings_set(&self, args: &Value) -> DbResult<Value> {
    let key = str_arg(args, "key")?;
    let value = str_arg(args, "value")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
      params![key, value, now_ms()],
    )?;
    Ok(Value::Null)
  }

  // --- list sync --------------------------------------------------------

  fn list_sync_load(&self, args: &Value) -> DbResult<Value> {
    let owner_id = str_arg(args, "ownerId")?;
    let folder = str_arg(args, "folder")?;
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!({}));
    }
    // Gmail drops history ids after about a week, so an old page is unusable.
    let cutoff = now_ms() - 2 * 24 * 60 * 60 * 1000;
    let conn = self.conn.lock().unwrap();
    let mut out = serde_json::Map::new();
    let mut stmt = conn.prepare(
      "SELECT account_email, history_id, next_page_token, rows
         FROM list_sync_state
        WHERE owner_id = ?1 AND folder = ?2 AND updated_at > ?3",
    )?;
    let rows = stmt.query_map(params![owner_id, folder, cutoff], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, Option<String>>(1)?,
        r.get::<_, Option<String>>(2)?,
        r.get::<_, String>(3)?,
      ))
    })?;
    for row in rows {
      let (account, history_id, next_page_token, rows_json) = row?;
      if !accounts.contains(&account) {
        continue;
      }
      // Stored as empty means empty, not missing — see `list_sync_save`.
      // Only rows we cannot read at all are passed over.
      let Ok(parsed) = serde_json::from_str::<Value>(&rows_json) else {
        continue;
      };
      if !parsed.is_array() {
        continue;
      }
      out.insert(
        account,
        json!({
          "rows": parsed,
          "historyId": history_id,
          "nextPageToken": next_page_token,
        }),
      );
    }
    Ok(Value::Object(out))
  }

  fn list_sync_save(&self, args: &Value) -> DbResult<Value> {
    let owner_id = str_arg(args, "ownerId")?;
    let folder = str_arg(args, "folder")?;
    let account = str_arg(args, "account")?;
    let entry = args
      .get("entry")
      .ok_or_else(|| DbError::BadArgument("entry".into()))?;
    /*
      An empty page is a page, and inbox zero is how it looks.

      This returned early on an empty list, so the last row of a mailbox
      could never be taken out of the stored page: deleting the one mail
      in an inbox filtered the rows to none, the save did nothing, and
      the page still held the mail that had just been trashed. Quitting
      and reopening served that stored page, and the mail was back —
      with the provider having deleted it perfectly well.

      A call carrying no rows at all is still refused. That is a
      malformed call, not an empty mailbox.
    */
    let rows = entry
      .get("rows")
      .filter(|value| value.is_array())
      .cloned()
      .ok_or_else(|| DbError::BadArgument("entry.rows".into()))?;
    let history_id = entry.get("historyId").and_then(Value::as_str);
    let next_page_token = entry.get("nextPageToken").and_then(Value::as_str);
    let conn = self.conn.lock().unwrap();
    // COALESCE keeps the stored position when this poll learned nothing new.
    conn.execute(
      "INSERT INTO list_sync_state
         (owner_id, folder, account_email, history_id, next_page_token, rows,
          rows_fingerprint, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)
       ON CONFLICT(owner_id, folder, account_email) DO UPDATE SET
         history_id = COALESCE(?4, list_sync_state.history_id),
         next_page_token = ?5,
         rows = ?6,
         updated_at = ?7",
      params![
        owner_id,
        folder,
        account,
        history_id,
        next_page_token,
        rows.to_string(),
        now_ms()
      ],
    )?;
    Ok(Value::Null)
  }

  fn list_sync_clear(&self) -> DbResult<Value> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM list_sync_state", [])?;
    Ok(Value::Null)
  }

  // --- snoozes ----------------------------------------------------------

  fn snoozes_list_active(&self, args: &Value) -> DbResult<Value> {
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(0);
    let now = current_iso(args)?;
    let conn = self.conn.lock().unwrap();
    let sql = String::from(
      "SELECT account_email, thread_id, snoozed_until, tip_message_id
         FROM snoozes WHERE snoozed_until > ?1 ORDER BY snoozed_until ASC",
    );
    let sql = if limit > 0 {
      format!("{sql} LIMIT {limit}")
    } else {
      sql
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![now], |r| {
      Ok(json!({
        "accountEmail": r.get::<_, String>(0)?,
        "threadId": r.get::<_, String>(1)?,
        "snoozedUntil": r.get::<_, String>(2)?,
        "tipMessageId": r.get::<_, Option<String>>(3)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  fn snoozes_count_active(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!(0));
    }
    let now = current_iso(args)?;
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT account_email FROM snoozes WHERE snoozed_until > ?1",
    )?;
    let rows = stmt.query_map(params![now], |r| r.get::<_, String>(0))?;
    let mut n = 0i64;
    for row in rows {
      if accounts.contains(&row?) {
        n += 1;
      }
    }
    Ok(json!(n))
  }

  fn snoozes_set(&self, args: &Value) -> DbResult<Value> {
    let record = args
      .get("record")
      .ok_or_else(|| DbError::BadArgument("record".into()))?;
    let account = str_arg(record, "accountEmail")?;
    let thread_id = str_arg(record, "threadId")?;
    let until = str_arg(record, "snoozedUntil")?;
    let tip = opt_str_arg(record, "tipMessageId");
    let conn = self.conn.lock().unwrap();
    // A null tip keeps the stored one.
    conn.execute(
      "INSERT INTO snoozes
         (account_email, thread_id, snoozed_until, tip_message_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_email, thread_id) DO UPDATE SET
         snoozed_until = ?3,
         tip_message_id = COALESCE(?4, snoozes.tip_message_id),
         created_at = ?5",
      params![account, thread_id, until, tip, now_ms()],
    )?;
    Ok(Value::Null)
  }

  fn snoozes_remove(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "accountEmail")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "DELETE FROM snoozes WHERE account_email = ?1 AND thread_id = ?2",
      params![account, thread_id],
    )?;
    Ok(Value::Null)
  }
}

/// "Now" for wake-time comparisons, as an ISO-8601 string.
///
/// Postgres compares against its own clock. This host has no server, so the
/// caller passes its clock in. There is deliberately no fallback: wake times
/// are stored as text and compared as text, so a second format here would make
/// every comparison wrong in a way that looks like it works.
fn current_iso(args: &Value) -> DbResult<String> {
  opt_str_arg(args, "now").ok_or_else(|| DbError::BadArgument("now".into()))
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The store as the first shipped build made it, on 2026-09-08: no
  /// `folder` on messages, a UID unique on the account alone, no
  /// `failed_at` or draft on the outbox. Kept here so an upgrade from it
  /// is tried on every run, since Mikkel's Mac holds one.
  const FIRST_SHIPPED_SCHEMA: &str = r#"
    CREATE TABLE messages (
      account_email TEXT NOT NULL, message_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      uid INTEGER, modseq INTEGER, rfc_message_id TEXT, in_reply_to TEXT, ref_headers TEXT,
      from_name TEXT NOT NULL DEFAULT '', from_email TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]', bcc_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '', sent_at INTEGER NOT NULL,
      size_estimate INTEGER, has_attachments INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0, is_draft INTEGER NOT NULL DEFAULT 0,
      body_state TEXT NOT NULL DEFAULT 'none', updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_email, message_id)
    );
    CREATE UNIQUE INDEX messages_uid_idx ON messages (account_email, uid);
    CREATE TABLE message_labels (
      account_email TEXT NOT NULL, message_id TEXT NOT NULL, label TEXT NOT NULL,
      PRIMARY KEY (account_email, message_id, label)
    );
    CREATE TABLE sync_state (
      account_email TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL,
      uid_validity INTEGER, highest_uid INTEGER, highest_modseq INTEGER, delta_link TEXT,
      full_sync_cursor INTEGER, full_sync_total INTEGER, full_sync_done INTEGER,
      last_ok_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_email, folder)
    );
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_email TEXT NOT NULL, thread_id TEXT,
      recipients_json TEXT NOT NULL, raw TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]', send_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at INTEGER NOT NULL
    );
    INSERT INTO messages (account_email, message_id, thread_id, uid, subject, sent_at, updated_at)
      VALUES ('vera@example.com', 'm1', 't1', 5, 'Kept across the upgrade', 1000, 1);
    INSERT INTO message_labels VALUES ('vera@example.com', 'm1', 'INBOX');
    INSERT INTO sync_state (account_email, folder, phase, uid_validity, highest_uid, updated_at)
      VALUES ('vera@example.com', '', 'live', 7, 5, 1);
    INSERT INTO outbox (account_email, recipients_json, raw, subject, send_at, created_at)
      VALUES ('vera@example.com', '["ann@x.test"]', 'raw', 'Waiting', 9999999999999, 1);
  "#;

  #[test]
  fn a_store_from_the_first_shipped_build_opens_and_keeps_its_rows() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(FIRST_SHIPPED_SCHEMA).unwrap();
    let db = MailDb::from_connection(conn, Box::new(MemoryVault::default())).expect("the upgrade runs");

    let column = |table: &str, name: &str| -> bool {
      let conn = db.conn_mut();
      let n: i64 = conn
        .query_row(
          &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
          [name],
          |r| r.get(0),
        )
        .unwrap();
      n == 1
    };
    assert!(column("messages", "folder"), "the folder column was added");
    assert!(column("outbox", "failed_at") && column("outbox", "draft_message_id"), "the outbox took its columns");

    // The rows survived and read as the interface reads them.
    let listed = db
      .call("messages.list", &serde_json::json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 }))
      .unwrap();
    let threads = listed["threads"].as_array().unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0]["subject"], "Kept across the upgrade");
    let states = db.call("sync.list", &serde_json::json!({})).unwrap();
    assert_eq!(states[0]["phase"], "live");
    let held = db.outbox_list("vera@example.com").unwrap();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].status(now_ms()), "waiting");

    // A row with the same UID in another folder is allowed now: the old
    // index was on the account and UID alone.
    let conn = db.conn_mut();
    conn
      .execute(
        "INSERT INTO messages (account_email, message_id, thread_id, folder, uid, sent_at, updated_at)
         VALUES ('vera@example.com', 'm2', 't2', 'trash', 5, 2000, 2)",
        [],
      )
      .expect("the UID index is per folder");
  }

  /// The JSON door answers in the shape the interface's gates and rows
  /// read. The key names here are the ones `lib/mail/local-store.ts` and
  /// `summaryFromStored` take; the test beside it in apps/mail/tests
  /// (local-store-gates) feeds this shape to those gates.
  #[test]
  fn the_json_door_answers_in_the_shape_the_interface_reads() {
    let db = MailDb::open_in_memory().unwrap();
    db.call(
      "sync.set",
      &serde_json::json!({ "state": { "account": "vera@example.com", "folder": "", "phase": "full", "fullSyncDone": 600, "fullSyncTotal": 1000 } }),
    )
    .unwrap();
    let states = db.call("sync.list", &serde_json::json!({})).unwrap();
    let state = &states.as_array().unwrap()[0];
    for key in ["account", "folder", "phase", "fullSyncDone", "fullSyncTotal"] {
      assert!(state.get(key).is_some(), "sync.list rows carry {key}");
    }
    assert_eq!(state["fullSyncDone"], 600);

    db.call(
      "messages.upsertMany",
      &serde_json::json!({ "account": "vera@example.com", "rows": [{
        "messageId": "m1", "threadId": "t1", "fromName": "Ann", "fromEmail": "ann@sender.test",
        "to": [{ "name": "Vera", "email": "vera@example.com" }], "cc": [], "bcc": [],
        "subject": "Shape", "snippet": "words", "sentAt": 1000, "hasAttachments": false,
        "unread": true, "starred": false, "isDraft": false, "labels": ["INBOX"]
      }] }),
    )
    .unwrap();
    let listed = db
      .call("messages.list", &serde_json::json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 }))
      .unwrap();
    let row = &listed["threads"].as_array().unwrap()[0];
    for key in ["account", "threadId", "subject", "unread", "lastAt", "messageCount", "hasAttachments", "latest", "participants", "senders"] {
      assert!(row.get(key).is_some(), "messages.list rows carry {key}");
    }
    assert_eq!(row["latest"]["fromEmail"], "ann@sender.test");
    assert_eq!(row["unread"], true);
    let counts = db
      .call("messages.counts", &serde_json::json!({ "accounts": ["vera@example.com"], "view": "inbox" }))
      .unwrap();
    assert_eq!(counts["threads"], 1);
    assert_eq!(counts["unread"], 1);
  }
  use std::collections::HashMap;

  /// Stands in for the keychain. The real one needs a signed app and a user
  /// session, so the operation logic is proven here and the adapter stays thin.
  #[derive(Default)]
  pub struct MemoryVault {
    items: Mutex<HashMap<String, String>>,
  }

  impl TokenVault for MemoryVault {
    fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()> {
      self
        .items
        .lock()
        .unwrap()
        .insert(format!("{provider}:{email}"), token.to_string());
      Ok(())
    }
    fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
      Ok(self.items.lock().unwrap().get(&format!("{provider}:{email}")).cloned())
    }
    fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
      self.items.lock().unwrap().remove(&format!("{provider}:{email}"));
      Ok(())
    }
  }

  fn db() -> MailDb {
    MailDb::open_in_memory().expect("open")
  }

  #[test]
  fn settings_round_trip_and_replace() {
    let db = db();
    assert_eq!(db.call("settings.get", &json!({"key": "k"})).unwrap(), Value::Null);
    db.call("settings.set", &json!({"key": "k", "value": "one"})).unwrap();
    assert_eq!(db.call("settings.get", &json!({"key": "k"})).unwrap(), json!("one"));
    db.call("settings.set", &json!({"key": "k", "value": "two"})).unwrap();
    assert_eq!(db.call("settings.get", &json!({"key": "k"})).unwrap(), json!("two"));
  }

  #[test]
  fn list_sync_saves_loads_and_clears() {
    let db = db();
    let rows = json!([{"threadId": "t1", "listSnippet": "hi", "latestRfcId": "<a>", "summary": {}}]);
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": rows, "historyId": "100", "nextPageToken": "tok"}}),
    )
    .unwrap();

    let loaded = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["a@b"]}))
      .unwrap();
    assert_eq!(loaded["a@b"]["historyId"], json!("100"));
    assert_eq!(loaded["a@b"]["nextPageToken"], json!("tok"));
    assert_eq!(loaded["a@b"]["rows"][0]["threadId"], json!("t1"));

    // A null history id must not wipe the stored position.
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": rows, "historyId": null, "nextPageToken": null}}),
    )
    .unwrap();
    let loaded = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["a@b"]}))
      .unwrap();
    assert_eq!(loaded["a@b"]["historyId"], json!("100"));

    // A mailbox that was not asked for stays out of the answer.
    let other = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["z@z"]}))
      .unwrap();
    assert_eq!(other, json!({}));

    db.call("listSync.clear", &json!({})).unwrap();
    let after = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["a@b"]}))
      .unwrap();
    assert_eq!(after, json!({}));
  }

  /// One thread taken out of a page that still holds others. This always
  /// worked — a page with rows left in it was stored like any other — and
  /// the test says so, because the empty case above reads as if removal
  /// itself were the fragile part. It is not: emptiness was.
  #[test]
  fn list_sync_stores_a_page_with_one_row_removed() {
    let db = db();
    let row = |id: &str| {
      json!({"threadId": id, "listSnippet": "hi", "latestRfcId": "<a>", "summary": {}})
    };
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": [row("t1"), row("t2"), row("t3")],
                        "historyId": "100", "nextPageToken": null}}),
    )
    .unwrap();

    // t2 is deleted; the other two stay.
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": [row("t1"), row("t3")],
                        "historyId": "101", "nextPageToken": null}}),
    )
    .unwrap();

    let loaded = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["a@b"]}))
      .unwrap();
    let ids: Vec<String> = loaded["a@b"]["rows"]
      .as_array()
      .unwrap()
      .iter()
      .map(|r| r["threadId"].as_str().unwrap().to_string())
      .collect();
    assert_eq!(ids, vec!["t1", "t3"], "the deleted thread came back");
  }

  /// Deleting the only mail in an inbox leaves a page with no rows in it.
  /// That page has to be stored, and read back: while an empty save was a
  /// no-op, the stored page kept the mail that had just been trashed, and
  /// the next launch served it back.
  #[test]
  fn list_sync_stores_an_emptied_page() {
    let db = db();
    let rows = json!([{"threadId": "t1", "listSnippet": "hi", "latestRfcId": "<a>", "summary": {}}]);
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": rows, "historyId": "100", "nextPageToken": null}}),
    )
    .unwrap();

    // The one thread is deleted, so the page it leaves behind is empty.
    db.call(
      "listSync.save",
      &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
              "entry": {"rows": [], "historyId": "101", "nextPageToken": null}}),
    )
    .unwrap();

    let loaded = db
      .call("listSync.load", &json!({"ownerId": "o", "folder": "inbox", "accounts": ["a@b"]}))
      .unwrap();
    assert_eq!(loaded["a@b"]["rows"], json!([]), "the deleted row came back");
    assert_eq!(loaded["a@b"]["historyId"], json!("101"));

    // A call with no rows at all is malformed, and is still refused.
    assert!(db
      .call(
        "listSync.save",
        &json!({"ownerId": "o", "folder": "inbox", "account": "a@b",
                "entry": {"historyId": "102"}}),
      )
      .is_err());
  }

  #[test]
  fn snoozes_order_expire_and_keep_the_tip() {
    let db = db();
    let now = "2026-08-10T12:00:00Z";
    let set = |acct: &str, thread: &str, until: &str, tip: Value| {
      db.call(
        "snoozes.set",
        &json!({"record": {"accountEmail": acct, "threadId": thread,
                           "snoozedUntil": until, "tipMessageId": tip}}),
      )
      .unwrap();
    };
    set("a@b", "later", "2026-08-10T18:00:00Z", json!("<later>"));
    set("a@b", "soon", "2026-08-10T13:00:00Z", json!("<soon>"));
    set("a@b", "woken", "2026-08-10T11:00:00Z", Value::Null);

    let active = db.call("snoozes.listActive", &json!({"now": now})).unwrap();
    let list = active.as_array().unwrap();
    assert_eq!(list.len(), 2, "a passed wake time is not active");
    assert_eq!(list[0]["threadId"], json!("soon"), "soonest wake first");
    assert_eq!(list[1]["threadId"], json!("later"));
    assert_eq!(list[0]["tipMessageId"], json!("<soon>"));

    // A null tip keeps the stored one.
    set("a@b", "soon", "2026-08-10T19:00:00Z", Value::Null);
    let active = db.call("snoozes.listActive", &json!({"now": now})).unwrap();
    let soon = active
      .as_array()
      .unwrap()
      .iter()
      .find(|r| r["threadId"] == json!("soon"))
      .unwrap()
      .clone();
    assert_eq!(soon["tipMessageId"], json!("<soon>"));

    let limited = db
      .call("snoozes.listActive", &json!({"now": now, "limit": 1}))
      .unwrap();
    assert_eq!(limited.as_array().unwrap().len(), 1);

    assert_eq!(
      db.call("snoozes.countActive", &json!({"now": now, "accounts": ["a@b"]})).unwrap(),
      json!(2)
    );
    assert_eq!(
      db.call("snoozes.countActive", &json!({"now": now, "accounts": ["nobody@x"]})).unwrap(),
      json!(0)
    );
    assert_eq!(
      db.call("snoozes.countActive", &json!({"now": now, "accounts": []})).unwrap(),
      json!(0)
    );

    db.call("snoozes.remove", &json!({"accountEmail": "a@b", "threadId": "soon"}))
      .unwrap();
    let active = db.call("snoozes.listActive", &json!({"now": now})).unwrap();
    assert_eq!(active.as_array().unwrap().len(), 1);
  }

  #[test]
  fn an_unknown_operation_names_itself() {
    let db = db();
    let err = db.call("accounts.nonsense", &json!({})).unwrap_err();
    assert!(
      format!("{err}").contains("accounts.nonsense"),
      "the error must name the operation: {err}"
    );
  }

  #[test]
  fn a_missing_argument_names_itself() {
    let db = db();
    let err = db.call("settings.get", &json!({})).unwrap_err();
    assert!(format!("{err}").contains("key"), "{err}");
  }

  #[test]
  fn the_clock_must_be_supplied() {
    let db = db();
    let err = db.call("snoozes.listActive", &json!({})).unwrap_err();
    assert!(format!("{err}").contains("now"), "{err}");
  }

  #[test]
  fn accounts_list_order_scope_and_removal() {
    let db = db();
    let add = |email: &str, owner: &str, order: i64| {
      let conn = db.conn.lock().unwrap();
      conn.execute(
        "INSERT INTO accounts (provider, email, owner_id, in_mail_tab, sort_order, updated_at)
         VALUES ('gmail', ?1, ?2, 1, ?3, 0)",
        params![email, owner, order],
      )
      .unwrap();
    };
    add("b@x", "owner", 1);
    add("a@x", "owner", 0);
    add("c@x", "other", 0);

    let mine = db
      .call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "owner"}))
      .unwrap();
    let mine = mine.as_array().unwrap();
    assert_eq!(mine.len(), 2, "only this owner's mailboxes");
    assert_eq!(mine[0]["email"], json!("a@x"), "stored order is kept");

    let owned = db
      .call("accounts.listOwnedEmails",
            &json!({"provider": "gmail", "ownerId": "owner", "emails": ["a@x", "c@x"]}))
      .unwrap();
    assert_eq!(owned, json!(["a@x"]), "another owner's mailbox is not mine");

    assert_eq!(db.call("accounts.exists", &json!({"provider": "gmail", "email": "c@x"})).unwrap(), json!(true));
    assert_eq!(db.call("accounts.exists", &json!({"provider": "gmail", "email": "zz@x"})).unwrap(), json!(false));

    assert_eq!(
      db.call("accounts.setInMailTab",
              &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x", "inMailTab": false}))
        .unwrap(),
      json!(true)
    );
    assert_eq!(
      db.call("accounts.setInMailTab",
              &json!({"provider": "gmail", "ownerId": "owner", "email": "nope@x", "inMailTab": false}))
        .unwrap(),
      json!(false),
      "a missing mailbox reports false rather than pretending"
    );

    db.call("accounts.setSortOrder",
            &json!({"provider": "gmail", "ownerId": "owner", "emails": ["b@x", "a@x"]}))
      .unwrap();
    let mine = db
      .call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "owner"}))
      .unwrap();
    assert_eq!(mine[0]["email"], json!("b@x"), "reorder is stored");

    // The checkpoint is mailbox state: every owner's row moves together.
    add("a@x", "second-owner", 0);
    db.call("accounts.setSyncState",
            &json!({"provider": "gmail", "email": "a@x", "now": "2026-01-01T00:00:00Z",
                    "update": {"historyId": "77", "error": null}}))
      .unwrap();
    let second = db
      .call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "second-owner"}))
      .unwrap();
    assert_eq!(second[0]["historyId"], json!("77"));
    assert_eq!(second[0]["lastSyncedAt"], json!("2026-01-01T00:00:00Z"));

    // An error keeps the checkpoint and does not move the sync time.
    db.call("accounts.setSyncState",
            &json!({"provider": "gmail", "email": "a@x", "now": "2026-02-02T00:00:00Z",
                    "update": {"error": "boom"}}))
      .unwrap();
    let second = db
      .call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "second-owner"}))
      .unwrap();
    assert_eq!(second[0]["historyId"], json!("77"));
    assert_eq!(second[0]["lastSyncedAt"], json!("2026-01-01T00:00:00Z"));
    assert_eq!(second[0]["lastSyncError"], json!("boom"));

    assert_eq!(
      db.call("accounts.remove", &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x"}))
        .unwrap(),
      json!(true)
    );
    assert_eq!(
      db.call("accounts.exists", &json!({"provider": "gmail", "email": "a@x"})).unwrap(),
      json!(true),
      "the other owner still has it"
    );
  }

  #[test]
  fn planner_contacts_come_from_connected_mailboxes_once_per_address() {
    let db = db();
    {
      let conn = db.conn.lock().unwrap();
      conn
        .execute(
          "INSERT INTO accounts (provider, email, owner_id, in_mail_tab, sort_order, updated_at)
           VALUES ('gmail', 'me@example.com', 'owner', 1, 0, 0)",
          [],
        )
        .unwrap();
    }
    db.call("contactSources.replaceContacts",
            &json!({"source": "google", "account": "me@example.com",
                    "contacts": [{"email": "Ida@Example.org", "name": ""}]}))
      .unwrap();
    db.call("contactSources.replaceContacts",
            &json!({"source": "mac", "account": "",
                    "contacts": [{"email": "ida@example.org", "name": "Ida Brook"}]}))
      .unwrap();
    db.call("contactSources.mergeHistoryContacts",
            &json!({"account": "me@example.com",
                    "contacts": [{"email": "ida@example.org", "name": "",
                                  "lastEmailedAt": "2026-02-02T00:00:00Z"}]}))
      .unwrap();
    // A mailbox that is no longer connected contributes nothing.
    db.call("contactSources.replaceContacts",
            &json!({"source": "google", "account": "gone@example.com",
                    "contacts": [{"email": "ghost@example.net", "name": "Ghost"}]}))
      .unwrap();

    let contacts = db.planner_contacts().unwrap();
    let list = contacts.as_array().unwrap();
    assert_eq!(list.len(), 1, "one row per address, and none from a removed mailbox");
    assert_eq!(list[0]["name"], json!("Ida Brook"), "the Mac book's name wins");
    assert_eq!(list[0]["lastEmailedAt"], json!("2026-02-02T00:00:00Z"));
  }

  #[test]
  fn contact_sources_replace_merge_and_hide() {
    let db = db();
    db.call("contactSources.saveState",
            &json!({"source": "google", "account": "a@x", "now": "2026-01-01T00:00:00Z",
                    "update": {"count": 7, "synced": true}}))
      .unwrap();
    let state = db.call("contactSources.listState", &json!({})).unwrap();
    assert_eq!(state[0]["itemCount"], json!(7));
    assert_eq!(state[0]["syncedAt"], json!("2026-01-01T00:00:00Z"));

    // An error keeps the count and does not move the sync time.
    db.call("contactSources.saveState",
            &json!({"source": "google", "account": "a@x", "now": "2026-05-05T00:00:00Z",
                    "update": {"error": "bad"}}))
      .unwrap();
    let state = db.call("contactSources.listState", &json!({})).unwrap();
    assert_eq!(state[0]["itemCount"], json!(7));
    assert_eq!(state[0]["syncedAt"], json!("2026-01-01T00:00:00Z"));
    assert_eq!(state[0]["lastError"], json!("bad"));

    db.call("contactSources.clearError", &json!({"source": "google", "account": "a@x"}))
      .unwrap();
    let state = db.call("contactSources.listState", &json!({})).unwrap();
    assert_eq!(state[0]["lastError"], Value::Null);

    db.call("contactSources.replaceContacts",
            &json!({"source": "google", "account": "a@x",
                    "contacts": [{"email": "one@x", "name": "One"}, {"email": "two@x", "name": "Two"}]}))
      .unwrap();
    let visible = db.call("contactSources.listVisible", &json!({"accounts": ["a@x"]})).unwrap();
    assert_eq!(visible.as_array().unwrap().len(), 2);

    db.call("contactSources.replaceContacts",
            &json!({"source": "google", "account": "a@x",
                    "contacts": [{"email": "three@x", "name": "Three"}]}))
      .unwrap();
    let visible = db.call("contactSources.listVisible", &json!({"accounts": ["a@x"]})).unwrap();
    assert_eq!(visible.as_array().unwrap().len(), 1, "replace, not add");

    // History merge: a stored name wins, the latest send time wins.
    db.call("contactSources.mergeHistoryContacts",
            &json!({"account": "a@x",
                    "contacts": [{"email": "h@x", "name": "Hal", "lastEmailedAt": "2026-01-01T00:00:00Z"}]}))
      .unwrap();
    db.call("contactSources.mergeHistoryContacts",
            &json!({"account": "a@x",
                    "contacts": [{"email": "h@x", "name": "", "lastEmailedAt": "2026-03-03T00:00:00Z"}]}))
      .unwrap();
    let visible = db.call("contactSources.listVisible", &json!({"accounts": ["a@x"]})).unwrap();
    let hal = visible.as_array().unwrap().iter().find(|c| c["email"] == json!("h@x")).unwrap().clone();
    assert_eq!(hal["name"], json!("Hal"));
    assert_eq!(hal["lastEmailedAt"], json!("2026-03-03T00:00:00Z"));

    // An older send time must not win.
    db.call("contactSources.mergeHistoryContacts",
            &json!({"account": "a@x",
                    "contacts": [{"email": "h@x", "name": "x", "lastEmailedAt": "2020-01-01T00:00:00Z"}]}))
      .unwrap();
    let visible = db.call("contactSources.listVisible", &json!({"accounts": ["a@x"]})).unwrap();
    let hal = visible.as_array().unwrap().iter().find(|c| c["email"] == json!("h@x")).unwrap().clone();
    assert_eq!(hal["lastEmailedAt"], json!("2026-03-03T00:00:00Z"));

    let ordered = visible.as_array().unwrap();
    assert_eq!(ordered[0]["source"], json!("google"), "address books before history");
    assert_eq!(ordered[ordered.len() - 1]["source"], json!("history"));

    assert_eq!(db.call("contactSources.countVisibleHistory", &json!({"account": "a@x"})).unwrap(), json!(1));
    db.call("contactSources.hideHistoryContact", &json!({"email": "h@x"})).unwrap();
    assert_eq!(db.call("contactSources.countVisibleHistory", &json!({"account": "a@x"})).unwrap(), json!(0));
    assert_eq!(
      db.call("contactSources.listVisible", &json!({"accounts": []})).unwrap(),
      json!([]),
      "no mailboxes means no contacts"
    );
  }

  #[test]
  fn the_mac_book_is_not_filtered_by_mailbox() {
    let db = db();

    // The Mac address book belongs to the machine, so its rows carry no
    // account. Filtering them by mailbox would drop every one of them.
    db.call("contactSources.replaceContacts",
            &json!({"source": "mac", "account": "",
                    "contacts": [{"email": "mac@x", "name": "From the Mac"}]}))
      .unwrap();
    db.call("contactSources.replaceContacts",
            &json!({"source": "google", "account": "a@x",
                    "contacts": [{"email": "goog@x", "name": "From Google"}]}))
      .unwrap();

    let visible = db
      .call("contactSources.listVisible", &json!({"accounts": ["a@x"]}))
      .unwrap();
    let rows = visible.as_array().unwrap();
    assert_eq!(rows.len(), 2, "both books answer: {visible}");
    // The Mac book sorts first, so its spelling of a name is the one kept.
    assert_eq!(rows[0]["source"], json!("mac"));

    // A mailbox that owns nothing still sees the Mac book.
    let other = db
      .call("contactSources.listVisible", &json!({"accounts": ["b@x"]}))
      .unwrap();
    let rows = other.as_array().unwrap();
    assert_eq!(rows.len(), 1, "only the Mac book: {other}");
    assert_eq!(rows[0]["email"], json!("mac@x"));
  }

  #[test]
  fn the_provider_count_wins_over_the_send_count() {
    let db = db();
    db.call(
      "chats.createConversation",
      &json!({"now": "2026-08-10T12:00:00Z", "input": {
        "chatId": "c1", "title": "Talk", "createdByAccount": "a@x",
        "participantFingerprint": "fp", "participantEmails": ["p@x"],
        "rotateAt": 80, "noQuote": true, "partId": "p1",
        "subject": "Talk", "messageCount": 0, "provider": "gmail", "threadId": "t1"}}),
    )
    .unwrap();

    // Two sends, but the other person wrote four more — the thread holds six.
    db.call("chats.addMessageToPart", &json!({"partId": "p1"})).unwrap();
    db.call("chats.addMessageToPart", &json!({"partId": "p1"})).unwrap();
    db.call("chats.reconcilePartCount",
            &json!({"input": {"account": "a@x", "threadId": "t1", "messageCount": 6}}))
      .unwrap();
    let open = db.call("chats.findOpenPart", &json!({"chatId": "c1"})).unwrap();
    assert_eq!(open["messageCount"], json!(6), "the thread's own count wins");

    // A thread bound to nothing reconciles nothing.
    db.call("chats.reconcilePartCount",
            &json!({"input": {"account": "a@x", "threadId": "unbound", "messageCount": 99}}))
      .unwrap();
    let open = db.call("chats.findOpenPart", &json!({"chatId": "c1"})).unwrap();
    assert_eq!(open["messageCount"], json!(6));
  }

  #[test]
  fn a_reference_finds_its_conversation_and_only_for_its_account() {
    let db = db();
    db.call(
      "chats.createConversation",
      &json!({"now": "2026-08-10T12:00:00Z", "input": {
        "chatId": "c1", "title": "Talk", "createdByAccount": "a@x",
        "participantFingerprint": "fp", "participantEmails": ["p@x"],
        "rotateAt": 80, "noQuote": true, "partId": "p1",
        "subject": "Talk", "messageCount": 0, "provider": "gmail", "threadId": "t1"}}),
    )
    .unwrap();

    db.call("chats.rememberMessageIds",
            &json!({"input": {"account": "a@x", "threadId": "t1",
                    "messageIds": ["<m1@x>", "<m2@x>"]}}))
      .unwrap();

    // The split thread references an id the conversation holds.
    let hit = db
      .call("chats.findByMessageIds",
            &json!({"account": "a@x", "messageIds": ["<other@x>", "<m2@x>"]}))
      .unwrap();
    assert_eq!(hit["chatId"], json!("c1"));
    assert_eq!(hit["title"], json!("Talk"));
    assert_eq!(hit["participantEmails"], json!(["p@x"]));
    assert_eq!(hit["noQuote"], json!(true));

    // Another account's chain must not capture this conversation.
    assert_eq!(
      db.call("chats.findByMessageIds",
              &json!({"account": "b@x", "messageIds": ["<m2@x>"]}))
        .unwrap(),
      Value::Null
    );

    // An unbound thread remembers nothing.
    db.call("chats.rememberMessageIds",
            &json!({"input": {"account": "a@x", "threadId": "unbound",
                    "messageIds": ["<m9@x>"]}}))
      .unwrap();
    assert_eq!(
      db.call("chats.findByMessageIds",
              &json!({"account": "a@x", "messageIds": ["<m9@x>"]}))
        .unwrap(),
      Value::Null
    );
  }

  #[test]
  fn a_conversation_rotates_into_a_new_thread() {
    let db = db();
    let now = "2026-08-10T12:00:00Z";
    db.call(
      "chats.createConversation",
      &json!({"now": now, "input": {
        "chatId": "c1", "title": "Talk", "createdByAccount": "a@x",
        "participantFingerprint": "fp", "participantEmails": ["p@x"],
        "rotateAt": 2, "noQuote": true, "partId": "p1",
        "subject": "Talk", "messageCount": 0, "provider": "gmail", "threadId": "t1"}}),
    )
    .unwrap();

    let bound = db.call("chats.findBinding", &json!({"account": "a@x", "threadId": "t1"})).unwrap();
    assert_eq!(bound["chatId"], json!("c1"));
    assert_eq!(bound["partIndex"], json!(1));
    assert_eq!(bound["partCount"], json!(1));
    assert_eq!(bound["partStatus"], json!("open"));
    assert_eq!(bound["noQuote"], json!(true));
    assert_eq!(bound["participantEmails"], json!(["p@x"]));
    assert_eq!(bound["rotateAt"], json!(2));

    assert_eq!(
      db.call("chats.findBinding", &json!({"account": "a@x", "threadId": "nope"})).unwrap(),
      Value::Null
    );

    let batch = db
      .call("chats.findBindings",
            &json!({"keys": [{"account": "a@x", "threadId": "t1"}, {"account": "a@x", "threadId": "no"}]}))
      .unwrap();
    assert_eq!(batch.as_object().unwrap().len(), 1);
    assert_eq!(batch["a@x|t1"]["chatId"], json!("c1"));

    db.call("chats.setNoQuote", &json!({"chatId": "c1", "noQuote": false})).unwrap();
    let bound = db.call("chats.findBinding", &json!({"account": "a@x", "threadId": "t1"})).unwrap();
    assert_eq!(bound["noQuote"], json!(false));

    let open = db.call("chats.findOpenPart", &json!({"chatId": "c1"})).unwrap();
    assert_eq!(open["partId"], json!("p1"));
    assert_eq!(
      db.call("chats.findPartThreadId", &json!({"partId": "p1", "account": "a@x"})).unwrap(),
      json!("t1")
    );

    db.call("chats.addMessageToPart", &json!({"partId": "p1"})).unwrap();
    let open = db.call("chats.findOpenPart", &json!({"chatId": "c1"})).unwrap();
    assert_eq!(open["messageCount"], json!(1));

    // Rotate: close part 1, open part 2, bind a fresh provider thread.
    db.call("chats.rotatePart",
            &json!({"now": now, "input": {"chatId": "c1", "closePartId": "p1",
                                          "nextPartId": "p2", "nextIndex": 2, "nextSubject": "Talk"}}))
      .unwrap();
    let open = db.call("chats.findOpenPart", &json!({"chatId": "c1"})).unwrap();
    assert_eq!(open["partId"], json!("p2"));
    assert_eq!(open["messageCount"], json!(0), "a new part starts empty");

    db.call("chats.bindThread",
            &json!({"input": {"partId": "p2", "account": "a@x", "provider": "gmail",
                              "threadId": "t2", "tipMessageId": "<tip>"}}))
      .unwrap();
    let via_new = db.call("chats.findBinding", &json!({"account": "a@x", "threadId": "t2"})).unwrap();
    assert_eq!(via_new["chatId"], json!("c1"), "the new thread is the same conversation");
    assert_eq!(via_new["partIndex"], json!(2));
    assert_eq!(via_new["partCount"], json!(2));

    let parts = db.call("chats.listParts", &json!({"account": "a@x", "chatId": "c1"})).unwrap();
    let parts = parts.as_array().unwrap();
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0]["partIndex"], json!(1));
    assert_eq!(parts[0]["status"], json!("closed"));
    assert_eq!(parts[0]["providerThreadId"], json!("t1"));
    assert_eq!(parts[0]["closedAt"], json!(now));
    assert_eq!(parts[1]["partIndex"], json!(2));
    assert_eq!(parts[1]["status"], json!("open"));
    assert_eq!(parts[1]["providerThreadId"], json!("t2"));

    db.call("chats.touch", &json!({"chatId": "c1"})).unwrap();
  }

  /// Counts what actually reached the keychain. The counters are shared, so the
  /// test can read them after the vault has been boxed behind the trait.
  struct CountingVault {
    inner: MemoryVault,
    reads: std::sync::Arc<Mutex<usize>>,
    stores: std::sync::Arc<Mutex<usize>>,
  }

  impl TokenVault for CountingVault {
    fn store(&self, p: &str, e: &str, t: &str) -> DbResult<()> {
      *self.stores.lock().unwrap() += 1;
      self.inner.store(p, e, t)
    }
    fn read(&self, p: &str, e: &str) -> DbResult<Option<String>> {
      *self.reads.lock().unwrap() += 1;
      self.inner.read(p, e)
    }
    fn remove(&self, p: &str, e: &str) -> DbResult<()> {
      self.inner.remove(p, e)
    }
  }

  #[test]
  fn a_token_is_read_from_the_keychain_once_per_launch() {
    // Every read is a chance for macOS to ask the user for their password, and
    // the mail core asks for a token whenever its own cache expires.
    let reads = std::sync::Arc::new(Mutex::new(0));
    let vault = CachedVault::new(Box::new(CountingVault {
      inner: MemoryVault::default(),
      reads: std::sync::Arc::clone(&reads),
      stores: std::sync::Arc::new(Mutex::new(0)),
    }));
    vault.store("gmail", "a@x", "rt-1").unwrap();

    for _ in 0..5 {
      assert_eq!(vault.read("gmail", "a@x").unwrap().as_deref(), Some("rt-1"));
    }
    // Storing seeded it, so nothing had to be read at all.
    assert_eq!(*reads.lock().unwrap(), 0);

    // A mailbox with no token must not be asked for again either.
    for _ in 0..3 {
      assert_eq!(vault.read("gmail", "nobody@x").unwrap(), None);
    }
    assert_eq!(*reads.lock().unwrap(), 1);
  }

  #[test]
  fn a_token_already_held_is_not_written_again() {
    // The keychain asks the operating system, and the operating system asks
    // the reader, so the cheapest prompt is the one never requested.
    let stores = std::sync::Arc::new(Mutex::new(0));
    let vault = CachedVault::new(Box::new(CountingVault {
      inner: MemoryVault::default(),
      reads: std::sync::Arc::new(Mutex::new(0)),
      stores: std::sync::Arc::clone(&stores),
    }));

    vault.store("gmail", "a@x", "rt-1").unwrap();
    vault.store("gmail", "a@x", "rt-1").unwrap();
    assert_eq!(*stores.lock().unwrap(), 1, "the same token is not written twice");

    vault.store("gmail", "a@x", "rt-2").unwrap();
    assert_eq!(*stores.lock().unwrap(), 2, "a different token still goes through");

    vault.remove("gmail", "a@x").unwrap();
    vault.store("gmail", "a@x", "rt-2").unwrap();
    assert_eq!(
      *stores.lock().unwrap(),
      3,
      "remove clears what was held, so the next store writes"
    );
  }

  #[test]
  fn a_rotated_token_replaces_what_is_held() {
    // Microsoft rotates on refresh. Serving the old one from memory would work
    // until the old one expired, and then fail with nothing to explain it.
    let vault = CachedVault::new(Box::new(MemoryVault::default()));
    vault.store("outlook", "a@x", "old").unwrap();
    assert_eq!(vault.read("outlook", "a@x").unwrap().as_deref(), Some("old"));
    vault.store("outlook", "a@x", "new").unwrap();
    assert_eq!(vault.read("outlook", "a@x").unwrap().as_deref(), Some("new"));
  }

  #[test]
  fn a_disconnected_mailbox_is_not_still_held() {
    let vault = CachedVault::new(Box::new(MemoryVault::default()));
    vault.store("gmail", "a@x", "rt").unwrap();
    assert_eq!(vault.read("gmail", "a@x").unwrap().as_deref(), Some("rt"));
    vault.remove("gmail", "a@x").unwrap();
    assert_eq!(vault.read("gmail", "a@x").unwrap(), None);
  }

  #[test]
  fn tokens_go_to_the_vault_and_never_to_the_database() {
    let db = db();
    let save = |email: &str, owner: &str, token: &str| {
      db.call(
        "accounts.save",
        &json!({"provider": "gmail",
                "input": {"email": email, "ownerId": owner, "refreshToken": token}}),
      )
      .unwrap();
    };
    save("a@x", "owner", "secret-one");

    // The row exists, and the token is not in any column of it.
    let stored: String = {
      let conn = db.conn.lock().unwrap();
      conn
        .query_row(
          "SELECT COALESCE(provider,'') || COALESCE(email,'') || COALESCE(owner_id,'')
                  || COALESCE(history_id,'') || COALESCE(last_synced_at,'')
                  || COALESCE(last_sync_error,'')
             FROM accounts WHERE email = 'a@x'",
          [],
          |r| r.get(0),
        )
        .unwrap()
    };
    assert!(
      !stored.contains("secret-one"),
      "a refresh token must never reach the database file"
    );

    let got = db
      .call("accounts.getToken", &json!({"provider": "gmail", "email": "a@x"}))
      .unwrap();
    assert_eq!(got["refreshToken"], json!("secret-one"));
    assert_eq!(got["ownerId"], json!("owner"));

    // An unknown mailbox has no token.
    assert_eq!(
      db.call("accounts.getToken", &json!({"provider": "gmail", "email": "no@x"})).unwrap(),
      Value::Null
    );

    // A rotated token replaces the stored one.
    db.call("accounts.replaceToken",
            &json!({"provider": "gmail", "email": "a@x", "ownerId": "owner",
                    "refreshToken": "secret-two"}))
      .unwrap();
    let got = db
      .call("accounts.getToken", &json!({"provider": "gmail", "email": "a@x"}))
      .unwrap();
    assert_eq!(got["refreshToken"], json!("secret-two"));

    // A fresh token clears the stale checkpoint.
    db.call("accounts.setSyncState",
            &json!({"provider": "gmail", "email": "a@x", "now": "2026-01-01T00:00:00Z",
                    "update": {"historyId": "55"}}))
      .unwrap();
    save("a@x", "owner", "secret-three");
    let rows = db
      .call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "owner"}))
      .unwrap();
    assert_eq!(rows[0]["historyId"], Value::Null, "a new token resets the checkpoint");

    // The token survives while another owner still has the mailbox.
    save("a@x", "second", "secret-three");
    db.call("accounts.remove",
            &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x"}))
      .unwrap();
    assert_ne!(
      db.call("accounts.getToken", &json!({"provider": "gmail", "email": "a@x"})).unwrap(),
      Value::Null,
      "the second owner still needs it"
    );

    // The last owner takes it with them.
    db.call("accounts.remove",
            &json!({"provider": "gmail", "ownerId": "second", "email": "a@x"}))
      .unwrap();
    assert_eq!(db.vault.read("gmail", "a@x").unwrap(), None);
  }

  #[test]
  fn token_stays_while_another_app_lists_the_mailbox() {
    let root = std::env::temp_dir().join(format!("dh-mail-siblings-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let mine = root.join("org.digitalhabits.mail.internal").join("mail.sqlite3");
    let theirs = root.join("org.digitalhabits.mail").join("mail.sqlite3");
    for path in [&mine, &theirs] {
      std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    }
    // Not a sibling: another maker's app in the same parent.
    std::fs::create_dir_all(root.join("com.example.mail")).unwrap();
    std::fs::write(root.join("com.example.mail").join("mail.sqlite3"), b"").unwrap();

    let open = |path: &PathBuf| {
      let mut db = MailDb::from_connection(
        Connection::open(path).unwrap(),
        Box::new(MemoryVault::default()),
      )
      .unwrap();
      db.siblings = sibling_databases(path);
      db
    };
    let other = open(&theirs);
    let db = open(&mine);
    assert_eq!(db.siblings, vec![theirs.clone()]);

    let save = |db: &MailDb| {
      db.call("accounts.save",
              &json!({"provider": "gmail",
                      "input": {"email": "a@x", "ownerId": "owner", "refreshToken": "t"}}))
        .unwrap();
    };
    save(&db);
    save(&other);

    db.call("accounts.remove", &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x"}))
      .unwrap();
    assert_eq!(
      db.vault.read("gmail", "a@x").unwrap().as_deref(),
      Some("t"),
      "the other app still lists it"
    );

    other.call("accounts.remove", &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x"}))
      .unwrap();
    save(&db);
    db.call("accounts.remove", &json!({"provider": "gmail", "ownerId": "owner", "email": "a@x"}))
      .unwrap();
    assert_eq!(db.vault.read("gmail", "a@x").unwrap(), None, "no app lists it now");

    let _ = std::fs::remove_dir_all(&root);
  }

  #[test]
  fn every_listed_operation_answers() {
    let db = db();
    for op in IMPLEMENTED {
      match db.call(op, &json!({})) {
        Err(DbError::UnknownOperation(name)) => {
          panic!("{name} is listed as implemented but the match does not answer it")
        }
        _ => {}
      }
    }
  }
}
