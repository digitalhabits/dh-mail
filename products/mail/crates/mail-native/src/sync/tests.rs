use super::*;

#[test]
fn system_labels_map_and_user_labels_decode() {
  assert_eq!(map_label("\\Inbox"), Some(INBOX.into()));
  assert_eq!(map_label("\\Sent"), Some(SENT.into()));
  assert_eq!(map_label("\\Important"), Some(IMPORTANT.into()));
  assert_eq!(map_label("\\All"), None);
  assert_eq!(map_label("&AOY-blesag"), Some("æblesag".into()));
  assert_eq!(map_label("Work"), Some("Work".into()));
}

#[test]
fn a_refused_sign_in_says_reconnect() {
  let short = imap::ImapError::Refused {
    command: "AUTHENTICATE".into(),
    text: "[AUTHENTICATIONFAILED] Invalid credentials (Failure) ({\"status\":\"400\",\"schemes\":\"Bearer\",\"scope\":\"https://mail.google.com/\"})".into(),
  };
  let reason = auth_refusal_reason(&short).unwrap();
  assert!(reason.starts_with("needs reconnect:"), "{reason}");
  assert!(reason.contains("tick every permission"), "{reason}");
  let plain = imap::ImapError::Refused { command: "AUTHENTICATE".into(), text: "[AUTHENTICATIONFAILED] no".into() };
  assert_eq!(auth_refusal_reason(&plain).as_deref(), Some("needs reconnect: the mail server refused the grant"));
  let other = imap::ImapError::Refused { command: "SELECT".into(), text: "[NONEXISTENT] gone".into() };
  assert!(auth_refusal_reason(&other).is_none());
  match SyncError::from(short) {
    SyncError::Failed(s) => assert!(s.starts_with("needs reconnect:"), "{s}"),
    other => panic!("{other:?}"),
  }
}

#[test]
fn a_fetched_message_becomes_a_row() {
  let headers = b"From: \"Ann\" <ann@sender.test>\r\nTo: vera@example.com, Bo <bo@x.test>\r\nSubject: =?utf-8?Q?Hej_=C3=B8?=\r\nMessage-ID: <one@sender.test>\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n".to_vec();
  let text = b"--b\r\nContent-Type: text/plain\r\n\r\nFirst words here\r\n--b--".to_vec();
  let f = Fetched {
    seq: 1,
    attributes: vec![
      ("UID".into(), Item::Num(42)),
      ("FLAGS".into(), Item::List(vec![Item::Str("\\Flagged".into())])),
      ("X-GM-MSGID".into(), Item::Num(0x1a2b)),
      ("X-GM-THRID".into(), Item::Num(0x1a20)),
      ("X-GM-LABELS".into(), Item::List(vec![Item::Str("\\Inbox".into()), Item::Str("Work".into())])),
      ("MODSEQ".into(), Item::List(vec![Item::Num(77)])),
      ("RFC822.SIZE".into(), Item::Num(1234)),
      ("INTERNALDATE".into(), Item::Str("03-Sep-2026 14:20:34 +0000".into())),
      ("BODY[HEADER.FIELDS (FROM TO)]".into(), Item::Bytes(headers)),
      ("BODY[TEXT]".into(), Item::Bytes(text)),
    ],
  };
  let folder = SyncFolder { logical: String::new(), raw: "[Gmail]/All Mail".into(), inject: None };
  let row = row_from(&f, &folder).unwrap();
  assert_eq!(row.message_id, "1a2b");
  assert_eq!(row.thread_id, "1a20");
  assert_eq!(row.uid, Some(42));
  assert_eq!(row.modseq, Some(77));
  assert_eq!(row.from_name, "Ann");
  assert_eq!(row.to[1].email, "bo@x.test");
  assert_eq!(row.subject, "Hej ø");
  assert_eq!(row.snippet, "First words here");
  assert!(row.unread, "no \\Seen means unread");
  assert!(row.starred);
  assert!(row.has_attachments);
  assert_eq!(row.labels, vec![INBOX.to_string(), "Work".to_string(), STARRED.to_string()]);
  assert_eq!(row.sent_at, 1_788_445_234_000);
}

// -------------------------------------------------------------------------
// The worker's steps against a scripted server. What the tests above
// check one function at a time, these check as the worker does it: a
// full sync, a live pass with a new message, a changed flag and a
// deletion, a folder rebuilt, bodies fetched by structure, and an
// action the server refuses for good.
// -------------------------------------------------------------------------

use crate::imap::fake_server;
use std::sync::atomic::AtomicBool;

const ME: &str = "vera@example.com";

fn all_mail() -> SyncFolder {
  SyncFolder { logical: String::new(), raw: "[Gmail]/All Mail".into(), inject: None }
}

/// One message as the full sync's FETCH returns it, with the header
/// block and the text as literals.
fn fetched(seq: u32, uid: u32, msgid: u64, thrid: u64, seen: bool, modseq: u64, subject: &str) -> String {
  let headers = format!(
    "From: Ann <ann@sender.test>\r\nTo: {ME}\r\nSubject: {subject}\r\nMessage-ID: <{uid}@sender.test>\r\n\r\n"
  );
  let text = format!("Words of message {uid}");
  let flags = if seen { "\\Seen" } else { "" };
  format!(
    "* {seq} FETCH (UID {uid} FLAGS ({flags}) X-GM-MSGID {msgid} X-GM-THRID {thrid} X-GM-LABELS (\"\\\\Inbox\") MODSEQ ({modseq}) RFC822.SIZE 100 INTERNALDATE \"03-Sep-2026 14:20:34 +0000\" BODY[HEADER.FIELDS (From To Cc Bcc Subject Date Message-ID In-Reply-To References Content-Type Content-Transfer-Encoding)] {{{}}}\r\n{}BODY[TEXT]<0> {{{}}}\r\n{})\r\n",
    headers.len(),
    headers,
    text.len(),
    text
  )
}

fn leak(s: String) -> &'static str {
  Box::leak(s.into_boxed_str())
}

fn select_reply(validity: u32, modseq: u64) -> &'static str {
  leak(format!(
    "* 2 EXISTS\r\n* OK [UIDVALIDITY {validity}] UIDs valid\r\n* OK [HIGHESTMODSEQ {modseq}]\r\n{{tag}} OK [READ-WRITE] selected\r\n"
  ))
}

fn uids_of(db: &MailDb) -> Vec<i64> {
  let mut uids = db.messages_known_uids(ME, "").unwrap();
  uids.sort();
  uids
}

#[test]
fn coming_back_to_all_mail_with_fewer_messages_than_the_copy_asks_for_a_sweep() {
  let db = MailDb::open_in_memory().unwrap();
  let folder = all_mail();
  let stop = AtomicBool::new(false);
  // The copy holds two; the server says 2 EXISTS, then 2 again, then 1.
  let stream = fake_server(vec![
    ("SELECT", select_reply(7, 100)),
    ("UID SEARCH ALL", "* SEARCH 1 2\r\n{tag} OK\r\n"),
    ("UID FETCH 2,1", leak(format!("{}{}{{tag}} OK\r\n", fetched(2, 2, 0x22, 0x20, false, 90, "Second"), fetched(1, 1, 0x11, 0x10, false, 80, "First")))),
    ("SELECT", select_reply(7, 100)),
    ("SELECT", "* 1 EXISTS\r\n* OK [UIDVALIDITY 7] UIDs valid\r\n{tag} OK [READ-WRITE] selected\r\n"),
  ]);
  let mut client = Client::connect_plain(stream).unwrap();
  catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
  assert_eq!(uids_of(&db), vec![1, 2]);
  assert!(!back_to_all_mail(&db, &mut client, &folder, ME).unwrap(), "as many as the copy: nothing to sweep");
  assert!(
    back_to_all_mail(&db, &mut client, &folder, ME).unwrap(),
    "one fewer: a message left while Trash was open, so the sweep runs now"
  );
}

#[test]
fn a_full_sync_then_a_live_pass_with_a_new_message_a_read_flag_and_a_deletion() {
  let db = MailDb::open_in_memory().unwrap();
  let folder = all_mail();
  let stop = AtomicBool::new(false);
  let stream = fake_server(vec![
    ("SELECT", select_reply(7, 100)),
    ("UID SEARCH ALL", "* SEARCH 1 2\r\n{tag} OK\r\n"),
    // Newest first.
    ("UID FETCH 2,1", leak(format!("{}{}{{tag}} OK\r\n", fetched(2, 2, 0x22, 0x20, false, 90, "Second"), fetched(1, 1, 0x11, 0x10, false, 80, "First")))),
    // The live pass: one new message above the high-water mark …
    ("UID FETCH 3:*", leak(format!("{}{{tag}} OK\r\n", fetched(3, 3, 0x33, 0x30, false, 120, "Third")))),
    // … the first one read since the baseline …
    ("CHANGEDSINCE", "* 1 FETCH (UID 1 FLAGS (\\Seen) X-GM-LABELS (\"\\\\Inbox\") MODSEQ (150))\r\n{tag} OK\r\n"),
    // … and the sweep finds the second one gone.
    ("UID SEARCH ALL", "* SEARCH 1 3\r\n{tag} OK\r\n"),
  ]);
  let mut client = Client::connect_plain(stream).unwrap();

  let mut state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
  assert_eq!(state.phase, "live");
  assert_eq!(state.uid_validity, Some(7));
  assert_eq!(state.highest_uid, Some(2));
  // The baseline is the folder's modseq at SELECT, not the rows' largest.
  assert_eq!(state.highest_modseq, Some(100));
  assert_eq!(uids_of(&db), vec![1, 2]);
  assert_eq!(state.full_sync_done, Some(2));

  let mut last_sweep = Instant::now();
  let changed = live_pass(&db, &mut client, &folder, &mut state, ME, &mut last_sweep, true).unwrap();
  assert!(changed);
  assert_eq!(uids_of(&db), vec![1, 3], "the new message is in and the deleted one is gone");
  assert_eq!(state.highest_uid, Some(3));
  assert_eq!(state.highest_modseq, Some(150));
  let listed = db
    .messages_list(&json!({ "accounts": [ME], "view": "all", "limit": 10 }))
    .unwrap();
  let threads = listed["threads"].as_array().unwrap();
  let first = threads.iter().find(|t| t["subject"] == "First").unwrap();
  assert_eq!(first["unread"], false, "the flag change was read");
  assert!(threads.iter().any(|t| t["subject"] == "Third"));
  assert!(!threads.iter().any(|t| t["subject"] == "Second"));
}

#[test]
fn a_rebuilt_folder_is_read_again_from_nothing() {
  let db = MailDb::open_in_memory().unwrap();
  let folder = all_mail();
  let stop = AtomicBool::new(false);
  let first = fake_server(vec![
    ("SELECT", select_reply(7, 100)),
    ("UID SEARCH ALL", "* SEARCH 1\r\n{tag} OK\r\n"),
    ("UID FETCH 1", leak(format!("{}{{tag}} OK\r\n", fetched(1, 1, 0x11, 0x10, false, 80, "Old")))),
  ]);
  let mut client = Client::connect_plain(first).unwrap();
  let state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
  assert_eq!(uids_of(&db), vec![1]);
  db.sync_state_set(&state).unwrap();

  // The same folder with a new UIDVALIDITY: the rows are worthless.
  let second = fake_server(vec![
    ("SELECT", select_reply(8, 5)),
    ("UID SEARCH ALL", "* SEARCH 10\r\n{tag} OK\r\n"),
    ("UID FETCH 10", leak(format!("{}{{tag}} OK\r\n", fetched(1, 10, 0x11, 0x10, false, 3, "Old")))),
  ]);
  let mut client = Client::connect_plain(second).unwrap();
  let state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
  assert_eq!(state.uid_validity, Some(8));
  assert_eq!(uids_of(&db), vec![10]);
  assert_eq!(state.phase, "live");
}

#[test]
fn a_message_sent_during_the_first_sync_is_read_in_before_the_sync_goes_on() {
  let db = MailDb::open_in_memory().unwrap();
  let folder = all_mail();
  let stop = AtomicBool::new(false);
  let stream = fake_server(vec![
    ("SELECT", select_reply(7, 100)),
    ("UID SEARCH ALL", "* SEARCH 1 2\r\n{tag} OK\r\n"),
    ("UID FETCH 2,1", leak(format!("{}{}{{tag}} OK\r\n", fetched(2, 2, 0x22, 0x20, false, 90, "Second"), fetched(1, 1, 0x11, 0x10, false, 80, "First")))),
    // The batch is done, a send went out between batches, and the copy
    // Gmail filed is read from above everything the search returned.
    ("UID FETCH 3:*", leak(format!("{}{{tag}} OK\r\n", fetched(3, 3, 0x33, 0x30, true, 120, "To my parents")))),
  ]);
  let mut client = Client::connect_plain(stream).unwrap();

  let mut sends = 0;
  let mut between = || {
    sends += 1;
    true
  };
  let state = catch_up(None, &db, &mut client, &folder, ME, &stop, Some(&mut between)).unwrap();
  assert_eq!(sends, 1, "asked once, after the one batch");
  assert_eq!(uids_of(&db), vec![1, 2, 3], "the sent copy is in with the rest");
  assert_eq!(state.phase, "live");
  assert_eq!(state.highest_uid, Some(3), "and the high-water mark counts it");
  let listed = db
    .messages_list(&json!({ "accounts": [ME], "view": "all", "limit": 10 }))
    .unwrap();
  assert!(listed["threads"].as_array().unwrap().iter().any(|t| t["subject"] == "To my parents"));
}

#[test]
fn bodies_are_fetched_by_structure_and_only_once() {
  let db = MailDb::open_in_memory().unwrap();
  let now = crate::db::now_ms();
  db.messages_upsert(
    ME,
    &[MessageRow {
      message_id: "aa".into(),
      thread_id: "a0".into(),
      folder: String::new(),
      uid: Some(5),
      from_name: "Ann".into(),
      from_email: "ann@sender.test".into(),
      subject: "Hello".into(),
      sent_at: now,
      labels: vec![INBOX.into()],
      ..Default::default()
    }],
  )
  .unwrap();
  let stream = fake_server(vec![
    (
      "BODYSTRUCTURE",
      "* 1 FETCH (UID 5 BODYSTRUCTURE ((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"UTF-8\") NIL NIL \"7BIT\" 11 1 NIL NIL NIL NIL)(\"APPLICATION\" \"PDF\" (\"NAME\" \"big.pdf\") NIL NIL \"BASE64\" 8000000 NIL (\"ATTACHMENT\" (\"FILENAME\" \"big.pdf\")) NIL NIL) \"MIXED\" (\"BOUNDARY\" \"b\") NIL NIL NIL))\r\n{tag} OK\r\n",
    ),
    // Only the text part is asked for; the eight-megabyte file is not.
    ("BODY.PEEK[1]", "* 1 FETCH (UID 5 BODY[1] {11}\r\nHello there)\r\n{tag} OK\r\n"),
  ]);
  let mut client = Client::connect_plain(stream).unwrap();
  assert_eq!(prefetch_bodies(&db, &mut client, ME).unwrap(), 1);
  let hit = db.messages_search(&json!({ "accounts": [ME], "q": "there", "limit": 5 })).unwrap();
  assert_eq!(hit["threads"].as_array().unwrap().len(), 1, "the body is in the index");
  let thread = db.messages_thread(&json!({ "account": ME, "threadId": "a0" })).unwrap();
  let files = thread["messages"][0]["body"]["attachments"].as_array().unwrap();
  assert_eq!(files.len(), 1);
  assert_eq!(files[0]["filename"], "big.pdf");
  assert_eq!(files[0]["section"], "2");
  // Nothing left to fetch: the server is not asked again.
  assert_eq!(prefetch_bodies(&db, &mut client, ME).unwrap(), 0);
}

#[test]
fn an_action_the_server_refuses_for_good_puts_the_rows_back() {
  let db = MailDb::open_in_memory().unwrap();
  db.messages_upsert(
    ME,
    &[MessageRow {
      message_id: "1a2b".into(),
      thread_id: "1a".into(),
      folder: String::new(),
      uid: Some(7),
      from_email: "ann@sender.test".into(),
      subject: "Keep me".into(),
      sent_at: 1_000,
      labels: vec![INBOX.into()],
      ..Default::default()
    }],
  )
  .unwrap();
  db.actions_apply_and_enqueue(ME, "1a", "trash", &json!({})).unwrap();
  let inbox = |db: &MailDb| {
    db.messages_counts(&json!({ "accounts": [ME], "view": "inbox" })).unwrap()["threads"].as_i64().unwrap()
  };
  assert_eq!(inbox(&db), 0, "hidden while the move is on its way");

  let mut script = Vec::new();
  for _ in 0..crate::actions::MAX_ATTEMPTS {
    script.push(("UID SEARCH X-GM-THRID 26", "* SEARCH 7\r\n{tag} OK\r\n"));
    script.push(("UID MOVE 7", "{tag} NO [CANNOT] Not allowed\r\n"));
  }
  let stream = fake_server(script);
  let mut client = Client::connect_plain(stream).unwrap();
  let folders = Folders {
    all_mail: "[Gmail]/All Mail".into(),
    trash: Some("[Gmail]/Bin".into()),
    junk: None,
    drafts: None,
  };
  let mut given_up = 0;
  for _ in 0..crate::actions::MAX_ATTEMPTS {
    let report = flush_actions(&db, &mut client, ME, &folders).unwrap();
    given_up += report.given_up.len();
  }
  assert_eq!(given_up, 1);
  assert!(db.actions_pending(ME).unwrap().is_empty());
  assert_eq!(inbox(&db), 1, "back in the inbox with the labels it had");
}
