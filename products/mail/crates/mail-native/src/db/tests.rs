use super::*;
use super::vault::{shared_vault_key, vault_key};

/// The team build keeps its Gmail grants apart; the rest stay shared.
#[test]
fn gmail_grants_are_kept_apart_in_the_team_build() {
  assert_eq!(shared_vault_key("gmail", "a@example.com"), "gmail:a@example.com");
  assert_eq!(vault_key("outlook", "a@example.com"), "outlook:a@example.com");
  assert_eq!(vault_key("exchange", "a@example.com"), "exchange:a@example.com");
  #[cfg(feature = "team")]
  assert_eq!(vault_key("gmail", "a@example.com"), "gmail-team:a@example.com");
  #[cfg(not(feature = "team"))]
  assert_eq!(vault_key("gmail", "a@example.com"), "gmail:a@example.com");
}

/// The store as the first shipped build made it, on 2026-09-08: no
/// `folder` on messages, a UID unique on the account alone, no
/// `failed_at` or draft on the outbox. Kept here so an upgrade from it
/// is tried on every run: some users' stores still have it.
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
      .locked()
      .insert(format!("{provider}:{email}"), token.to_string());
    Ok(())
  }
  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    Ok(self.items.locked().get(&format!("{provider}:{email}")).cloned())
  }
  fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
    self.items.locked().remove(&format!("{provider}:{email}"));
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
    let conn = db.conn.locked();
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
fn known_contacts_come_from_connected_mailboxes_once_per_address() {
  let db = db();
  {
    let conn = db.conn.locked();
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

  let contacts = db.known_contacts().unwrap();
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
    *self.stores.locked() += 1;
    self.inner.store(p, e, t)
  }
  fn read(&self, p: &str, e: &str) -> DbResult<Option<String>> {
    *self.reads.locked() += 1;
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
  assert_eq!(*reads.locked(), 0);

  // A mailbox with no token must not be asked for again either.
  for _ in 0..3 {
    assert_eq!(vault.read("gmail", "nobody@x").unwrap(), None);
  }
  assert_eq!(*reads.locked(), 1);
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
  assert_eq!(*stores.locked(), 1, "the same token is not written twice");

  vault.store("gmail", "a@x", "rt-2").unwrap();
  assert_eq!(*stores.locked(), 2, "a different token still goes through");

  vault.remove("gmail", "a@x").unwrap();
  vault.store("gmail", "a@x", "rt-2").unwrap();
  assert_eq!(
    *stores.locked(),
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
    let conn = db.conn.locked();
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

/// The store and the directory that holds it go to their owner alone.
/// A new file on unix is readable by every account on the machine, so a
/// wrong mode here puts one reader's mail in front of another.
#[cfg(unix)]
#[test]
fn the_store_is_readable_by_its_owner_alone() {
  use std::os::unix::fs::PermissionsExt;
  let dir = std::env::temp_dir().join(format!("dh-mail-modes-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let file = dir.join("mail.sqlite3");
  std::fs::write(&file, b"").unwrap();

  owner_only(&dir, 0o700);
  owner_only(&file, 0o600);

  let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
  assert_eq!(mode(&dir), 0o700, "the data directory");
  assert_eq!(mode(&file), 0o600, "the store");
  let _ = std::fs::remove_dir_all(&dir);
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
