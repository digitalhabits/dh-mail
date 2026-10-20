//! The upgrade of a store from an older build. See schema.rs.

use std::collections::BTreeMap;

use rusqlite::Connection;

use crate::db::MailDb;
use crate::schema::{add_column, stored_version, upgrade, VERSION};

/// A store from before the upgrade steps had numbers: no `ews_url` or
/// `ews_username` on accounts, no `card` on contacts, no `folder` on
/// messages, no `failed_at`, `draft_message_id` or `claimed_at` on the
/// outbox, and no `bcc_json` on scheduled sends. All data is invented.
const UNVERSIONED_STORE: &str = r#"
  CREATE TABLE accounts (
    provider TEXT NOT NULL, email TEXT NOT NULL, owner_id TEXT NOT NULL,
    history_id TEXT, last_synced_at TEXT, last_sync_error TEXT,
    in_mail_tab INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (provider, email, owner_id)
  );
  CREATE TABLE source_contacts (
    source TEXT NOT NULL, account TEXT NOT NULL, email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', last_emailed_at TEXT, hidden INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT,
    PRIMARY KEY (source, account, email)
  );
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
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_email TEXT NOT NULL, thread_id TEXT,
    recipients_json TEXT NOT NULL, raw TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]', send_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE scheduled_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_email TEXT NOT NULL, provider TEXT NOT NULL,
    draft_id TEXT NOT NULL, thread_id TEXT, subject TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]',
    send_at INTEGER NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, refused_at INTEGER, claimed_at INTEGER
  );
  INSERT INTO accounts (provider, email, owner_id, updated_at) VALUES ('gmail', 'reader@example.com', 'local', 1);
  INSERT INTO source_contacts (source, account, email, name) VALUES ('history', 'reader@example.com', 'friend@example.org', 'Ada Example');
  INSERT INTO messages (account_email, message_id, thread_id, uid, subject, sent_at, updated_at)
    VALUES ('reader@example.com', 'm1', 't1', 5, 'Plans for the garden', 1000, 1);
  INSERT INTO outbox (account_email, recipients_json, raw, subject, send_at, created_at)
    VALUES ('reader@example.com', '["friend@example.org"]', 'raw', 'Waiting', 9999999999999, 1);
"#;

/// Each table with its columns, in their order.
fn columns(conn: &Connection) -> BTreeMap<String, Vec<String>> {
  let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").unwrap();
  let tables: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
  tables
    .into_iter()
    .map(|table| {
      let mut stmt = conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')")).unwrap();
      let names = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
      (table, names)
    })
    .collect()
}

fn scratch_file(name: &str) -> std::path::PathBuf {
  let dir = std::env::temp_dir().join(format!("dh-mail-schema-{}-{name}", std::process::id()));
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  dir.join("mail.sqlite3")
}

#[test]
fn a_store_from_before_the_versions_upgrades_and_keeps_all_its_data() {
  let path = scratch_file("old");
  let before = {
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(UNVERSIONED_STORE).unwrap();
    assert_eq!(stored_version(&conn).unwrap(), 0);
    columns(&conn)
  };

  let db = MailDb::open_file_for_tests(&path).expect("the upgrade runs");
  let after = columns(&db.conn_mut());
  // No table and no column is gone or renamed. Each old column keeps its
  // place, and the new ones come after it.
  for (table, old) in &before {
    let new = after.get(table).unwrap_or_else(|| panic!("{table} is gone"));
    assert_eq!(&new[..old.len()], &old[..], "{table}");
  }
  let has = |table: &str, column: &str| after[table].iter().any(|c| c == column);
  assert!(has("accounts", "ews_url") && has("accounts", "ews_username"));
  assert!(has("source_contacts", "card"));
  assert!(has("messages", "folder"));
  assert!(has("outbox", "failed_at") && has("outbox", "draft_message_id") && has("outbox", "claimed_at"));
  assert!(has("scheduled_sends", "bcc_json"));
  assert_eq!(stored_version(&db.conn_mut()).unwrap(), VERSION);

  // The rows are all there.
  {
    let conn = db.conn_mut();
    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(count("SELECT COUNT(*) FROM accounts WHERE email = 'reader@example.com'"), 1);
    assert_eq!(count("SELECT COUNT(*) FROM source_contacts WHERE name = 'Ada Example'"), 1);
    assert_eq!(count("SELECT COUNT(*) FROM messages WHERE subject = 'Plans for the garden'"), 1);
  }
  assert_eq!(db.outbox_list("reader@example.com").unwrap().len(), 1);

  // A second open finds the store current and changes nothing.
  drop(db);
  let db = MailDb::open_file_for_tests(&path).expect("the second open");
  assert_eq!(columns(&db.conn_mut()), after);
  assert_eq!(stored_version(&db.conn_mut()).unwrap(), VERSION);
  drop(db);
  let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn a_new_store_is_current_at_once() {
  let db = MailDb::open_in_memory().unwrap();
  assert_eq!(stored_version(&db.conn_mut()).unwrap(), VERSION);
}

#[test]
fn a_store_that_has_some_of_the_new_columns_upgrades() {
  let conn = Connection::open_in_memory().unwrap();
  conn.execute_batch(UNVERSIONED_STORE).unwrap();
  conn.execute_batch("ALTER TABLE outbox ADD COLUMN failed_at INTEGER; ALTER TABLE accounts ADD COLUMN ews_url TEXT;").unwrap();
  crate::schema::migrate(&conn).expect("a column that is there is not an error");
  assert_eq!(stored_version(&conn).unwrap(), VERSION);
}

#[test]
fn an_upgrade_error_is_returned_and_the_step_is_not_counted() {
  // No tables: step 1 cannot add its columns.
  let conn = Connection::open_in_memory().unwrap();
  assert!(upgrade(&conn).is_err());
  assert_eq!(stored_version(&conn).unwrap(), 0, "the failed step is not counted");
}

#[test]
fn a_step_that_ran_does_not_run_again() {
  // No tables, but the store says that step 1 ran. If the step ran again,
  // it would fail.
  let conn = Connection::open_in_memory().unwrap();
  conn.pragma_update(None, "user_version", VERSION).unwrap();
  upgrade(&conn).expect("no step runs");
}

#[test]
fn a_store_from_a_newer_build_opens() {
  let conn = Connection::open_in_memory().unwrap();
  conn.pragma_update(None, "user_version", VERSION + 5).unwrap();
  crate::schema::migrate(&conn).expect("a newer store opens");
  assert_eq!(stored_version(&conn).unwrap(), VERSION + 5, "the number is not lowered");
}

#[test]
fn only_the_duplicate_column_error_is_ignored() {
  let conn = Connection::open_in_memory().unwrap();
  conn.execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES ('x');").unwrap();
  add_column(&conn, "notes", "title", "TEXT").unwrap();
  add_column(&conn, "notes", "title", "TEXT").expect("the column is there already");
  assert!(add_column(&conn, "missing_table", "title", "TEXT").is_err());
  assert!(add_column(&conn, "notes", "bad", "TEXT NOT NULL").is_err(), "NOT NULL with no default, on a table with rows");
}
