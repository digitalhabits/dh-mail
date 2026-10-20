//! The tables of the store, and the upgrade of a store from an older build.
//!
//! An open does these steps, in this sequence:
//!
//! 1. It makes each table that is not there (`CREATE TABLE IF NOT EXISTS`).
//!    A new store gets all columns here.
//! 2. It runs each upgrade step that the store did not run yet. The store
//!    keeps the number of the last step in `PRAGMA user_version`. Each step
//!    runs once, in a transaction with its new number.
//! 3. It runs the index change and the one-time repairs of the local copy
//!    of the mail (`messages::migrate`). These keep their own marks.
//!
//! Rules for a new upgrade step:
//!
//! - Add the step at the end of `STEPS`, with the next number.
//! - Add the column to the `CREATE TABLE` too, so a new store has it.
//! - Never drop or rename a table or a column. The reader's mail and
//!   settings are in them, and an older build must still open the store.

use rusqlite::Connection;

use crate::db::{DbError, DbResult};

/// The tables that db.rs operates on. The other modules keep their own.
const CORE_TABLES: &str = r#"

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
  CREATE INDEX IF NOT EXISTS chat_message_ids_chat_idx ON chat_message_ids (chat_id);"#;

/// The number of the last upgrade step. A store at this number is current.
pub const VERSION: i32 = 1;

type Step = fn(&Connection) -> DbResult<()>;

/// The upgrade steps, by number. Each one runs once for each store.
const STEPS: &[(i32, Step)] = &[(1, columns_added_before_versions)];

/// Make the tables, and bring an older store up to date.
pub fn migrate(conn: &Connection) -> DbResult<()> {
  conn.execute_batch(CORE_TABLES)?;
  conn.execute_batch(crate::messages::SCHEMA)?;
  conn.execute_batch(crate::actions::SCHEMA)?;
  conn.execute_batch(crate::outbox::SCHEMA)?;
  conn.execute_batch(crate::scheduled_sends::SCHEMA)?;
  upgrade(conn)?;
  // The local copy of the mail: its index change and its repairs.
  crate::messages::migrate(conn)?;
  Ok(())
}

/// The upgrade step number that the store holds.
pub fn stored_version(conn: &Connection) -> DbResult<i32> {
  Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

pub(crate) fn upgrade(conn: &Connection) -> DbResult<()> {
  let at = stored_version(conn)?;
  if at > VERSION {
    // A newer build made this store. Its steps only added columns, so
    // this build can use the store as it is.
    log::warn!("[mail-db] the store is at upgrade step {at}, and this build knows {VERSION}");
    return Ok(());
  }
  for (number, step) in STEPS.iter().filter(|(number, _)| *number > at) {
    let tx = conn.unchecked_transaction()?;
    step(&tx)?;
    tx.pragma_update(None, "user_version", number)?;
    tx.commit()?;
  }
  Ok(())
}

/// Add a column to a table. A store that has the column already is not
/// an error. Every other error is returned.
///
/// `definition` is the text after the column name, for example
/// "TEXT NOT NULL DEFAULT ''".
pub fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> DbResult<()> {
  match conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), []) {
    Ok(_) => Ok(()),
    Err(e) if is_duplicate_column(&e) => Ok(()),
    Err(e) => Err(DbError::Sqlite(e)),
  }
}

fn is_duplicate_column(error: &rusqlite::Error) -> bool {
  matches!(
    error,
    rusqlite::Error::SqliteFailure(_, Some(message)) if message.starts_with("duplicate column name")
  )
}

/// Step 1: the columns that builds added before the store had a version.
///
/// A store at version 0 can have some of these columns and not others, so
/// a column that is there already is not an error.
fn columns_added_before_versions(conn: &Connection) -> DbResult<()> {
  // The address book's id for a card, so two addresses on one card are
  // one person.
  add_column(conn, "source_contacts", "card", "TEXT")?;
  crate::account_exchange::add_columns(conn)?;
  crate::outbox::add_columns(conn)?;
  crate::messages::add_columns(conn)?;
  crate::scheduled_sends::add_columns(conn)?;
  Ok(())
}
