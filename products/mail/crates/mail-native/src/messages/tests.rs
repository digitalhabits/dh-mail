use super::*;
use super::repairs::{refetch_invites_without_text, refetch_misread_bodies, repair_quoted_addresses};
use super::search::days_from_civil;
use super::text::squash;

fn db() -> MailDb {
  MailDb::open_in_memory().expect("open")
}

/// A mail the reader sent to Trash in an Outlook mailbox. Graph reports
/// the move in two halves that come in no fixed order.
#[test]
fn a_late_left_the_inbox_does_not_take_a_row_that_is_in_trash_now() {
  let db = db();
  let left = |ids: &[&str], folder: &str| {
    db.messages_remove_messages(&json!({ "account": "vera@example.com", "messageIds": ids, "leftFolder": folder }))
      .unwrap()
  };
  let ids = |db: &MailDb| -> Vec<String> {
    let conn = db.conn_mut();
    let mut stmt = conn.prepare("SELECT message_id FROM messages ORDER BY message_id").unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<_, _>>().unwrap()
  };
  db.messages_upsert(
    "vera@example.com",
    &[
      // Delivered by Deleted Items already, or relabelled when the reader acted.
      msg("moved", "t1", 1, 1_000, &[TRASH]),
      // Still in the inbox as far as the copy knows: deleted from another device.
      msg("gone", "t2", 2, 2_000, &[INBOX]),
      // In Outlook's Archive, whose rows wear no label. One is starred.
      msg("archived", "t3", 3, 3_000, &[]),
      msg("archived-star", "t4", 4, 4_000, &[STARRED]),
      // In a named folder.
      msg("filed", "t5", 5, 5_000, &["Receipts"]),
    ],
  )
  .unwrap();

  assert_eq!(left(&["moved", "gone"], INBOX), json!(1), "only the row that is still in the inbox goes");
  assert_eq!(ids(&db), vec!["archived", "archived-star", "filed", "moved"]);

  // Archive reports three gone. Only the rows with no folder label are its own.
  assert_eq!(left(&["archived", "archived-star", "filed"], ""), json!(2));
  assert_eq!(ids(&db), vec!["filed", "moved"]);

  // The folder the row is in is believed about it.
  assert_eq!(left(&["moved"], TRASH), json!(1));
  assert_eq!(left(&["filed"], "Receipts"), json!(1));
  assert!(ids(&db).is_empty());

  // With no folder named, a removal is a removal, as before.
  db.messages_upsert("vera@example.com", &[msg("any", "t6", 6, 6_000, &[TRASH])]).unwrap();
  let plain = db.messages_remove_messages(&json!({ "account": "vera@example.com", "messageIds": ["any"] })).unwrap();
  assert_eq!(plain, json!(1));
}

fn msg(id: &str, thread: &str, uid: i64, at: i64, labels: &[&str]) -> MessageRow {
  MessageRow {
    message_id: id.into(),
    thread_id: thread.into(),
    folder: String::new(),
    uid: Some(uid),
    from_name: "Ann Sender".into(),
    from_email: "ann@sender.test".into(),
    to: vec![Address { name: "Vera".into(), email: "vera@example.com".into() }],
    subject: format!("Subject {thread}"),
    snippet: format!("snippet of {id}"),
    sent_at: at,
    unread: true,
    labels: labels.iter().map(|s| s.to_string()).collect(),
    ..Default::default()
  }
}

#[test]
fn the_background_fetch_takes_recent_bodies_newest_first_and_skips_big_ones() {
  let db = db();
  let mut big = msg("m3", "t3", 3, 3_000, &[INBOX]);
  big.size_estimate = Some(10_000_000);
  let mut old = msg("m4", "t4", 4, 10, &[INBOX]);
  old.size_estimate = Some(100);
  db.messages_upsert(
    "vera@example.com",
    &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[INBOX]), big, old],
  )
  .unwrap();
  let missing = db.messages_bodies_missing("vera@example.com", 500, 5_000_000, 10).unwrap();
  assert_eq!(missing, vec![("m2".to_string(), 2), ("m1".to_string(), 1)]);

  // A body kept, or given up on, is not asked for again.
  db.bodies_put("vera@example.com", "m2", &BodyRow { text: Some("hello".into()), ..Default::default() })
    .unwrap();
  db.messages_body_skipped("vera@example.com", "m1").unwrap();
  assert!(db.messages_bodies_missing("vera@example.com", 500, 5_000_000, 10).unwrap().is_empty());
}

#[test]
fn entities_come_back_as_their_characters_and_unknown_ones_stay() {
  assert_eq!(decode_entities("K&aelig;re Ulrik &#248; &#xE9; &amp; co"), "Kære Ulrik ø é & co");
  // Double-encoded is decoded once, as a browser would.
  assert_eq!(decode_entities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
  assert_eq!(decode_entities("fish &chips; &unknownname; & more"), "fish &chips; &unknownname; & more");
  assert_eq!(decode_entities("no entities"), "no entities");
}

#[test]
fn tags_in_a_plain_part_go_and_other_angle_brackets_stay() {
  assert_eq!(
    strip_stray_tags("Dear <span class=\"personaldata\">Dr Holm</span>, your <b>e-ticket</b><br/>receipt"),
    "Dear Dr Holm, your e-ticket receipt"
  );
  for kept in [
    "Write to Ada <ada@example.org> today",
    "See <https://example.org/a?b=1> for more",
    "if a < b and b > c",
    "Dear <name>, I <3 this",
    "a lone <span with no end",
  ] {
    assert_eq!(strip_stray_tags(kept), kept);
  }
  let stripped = strip_html("<p>K&aelig;re &nbsp;Ulrik</p>");
  let words: Vec<&str> = stripped.split_whitespace().collect();
  assert_eq!(words, vec!["Kære", "Ulrik"]);
}

#[test]
fn the_stripper_skips_comments_and_the_head_and_survives_a_cut_comment() {
  let mso = "<!DOCTYPE html><html><head><title>Hidden</title><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><style>.a{color:red}</style></head><body><p>Hej Ulrik, dit fly er forsinket.</p></body></html>";
  let text = strip_html(mso);
  assert!(!text.contains("96"), "{text:?}");
  assert!(!text.contains("Hidden"), "{text:?}");
  assert!(text.contains("Hej Ulrik, dit fly er forsinket."), "{text:?}");
  // Cut inside the comment, as a two-kilobyte prefix would be.
  let cut = &mso[..mso.find("PixelsPerInch>96").unwrap() + 16];
  assert_eq!(strip_html(cut).trim(), "");
  // And the case that panicked: a character whose lower case is longer.
  assert!(strip_html("aİ<b>x</b>").contains("x"));
}

#[test]
fn a_store_with_poor_snippets_is_repaired_when_opened() {
  let db = db();
  let mut plain = msg("m1", "t1", 1, 1_000, &[INBOX]);
  plain.snippet = "96".into();
  let mut html = msg("m2", "t2", 2, 2_000, &[INBOX]);
  html.snippet = "96 Since launching ShowerSpaah, we have learned a great deal".into();
  // A Latin part read twice: "på" as "pï¿½", in a line long enough to stay.
  let mut latin = msg("m3", "t3", 3, 3_000, &[INBOX]);
  latin.snippet = "Din pakke er pï¿½ vej til pakkeshoppen ved Torvet i morgen".into();
  db.messages_upsert("vera@example.com", &[plain, html, latin]).unwrap();
  {
    let conn = db.conn_mut();
    // Bodies kept by a build whose stripper read the Outlook block as
    // words: the search text it wrote begins with 96 too.
    conn
      .execute(
        "INSERT INTO message_bodies (account_email, message_id, text_body, search_text, fetched_at)
           VALUES ('vera@example.com', 'm1', 'Dit fly er forsinket.', 'Dit fly er forsinket.', 1)",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO message_bodies (account_email, message_id, html_body, search_text, fetched_at)
           VALUES ('vera@example.com', 'm2',
             '<html><head><!--[if gte mso 9]><xml><o:PixelsPerInch>96</o:PixelsPerInch></xml><![endif]--></head><body><p>Since launching ShowerSpaah, we have learned a great deal.</p></body></html>',
             '96 Since launching ShowerSpaah, we have learned a great deal.', 1)",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO message_bodies (account_email, message_id, text_body, search_text, fetched_at)
           VALUES ('vera@example.com', 'm3', 'Din pakke er på vej til pakkeshoppen ved Torvet i morgen.',
             'Din pakke er på vej til pakkeshoppen ved Torvet i morgen.', 1)",
        [],
      )
      .unwrap();
    // The store opened before these rows existed and remembered the
    // repair as done; forget that, as an older store would not have it.
    conn.execute("DELETE FROM settings WHERE key = 'repair.snippets'", []).unwrap();
    migrate(&conn).unwrap();
    let snippet = |id: &str| -> String {
      conn.query_row("SELECT snippet FROM messages WHERE message_id = ?1", [id], |r| r.get(0)).unwrap()
    };
    assert_eq!(snippet("m1"), "Dit fly er forsinket.");
    assert_eq!(snippet("m2"), "Since launching ShowerSpaah, we have learned a great deal.");
    assert_eq!(snippet("m3"), "Din pakke er på vej til pakkeshoppen ved Torvet i morgen.");
    let text: String = conn
      .query_row("SELECT search_text FROM message_bodies WHERE message_id = 'm2'", [], |r| r.get(0))
      .unwrap();
    assert!(!text.starts_with("96"), "{text}");
  }
  // Findable by its words, and not by the number that was never there.
  let hit = db.messages_search(&json!({ "accounts": ["vera@example.com"], "q": "ShowerSpaah", "limit": 5 })).unwrap();
  assert_eq!(hit["threads"].as_array().unwrap().len(), 1);
}

#[test]
fn a_kept_body_replaces_a_poor_snippet() {
  let db = db();
  let mut row = msg("m1", "t1", 1, 1_000, &[INBOX]);
  row.snippet = "96".into();
  db.messages_upsert("vera@example.com", &[row]).unwrap();
  db.bodies_put(
    "vera@example.com",
    "m1",
    &BodyRow { html: Some("<p>Hej Ulrik, dit fly er forsinket med to timer.</p>".into()), ..Default::default() },
  )
  .unwrap();
  let out = db.messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 })).unwrap();
  assert_eq!(out["threads"][0]["latest"]["snippet"], "Hej Ulrik, dit fly er forsinket med to timer.");
}

#[test]
fn a_page_sent_as_plain_text_shows_its_words_not_its_doctype() {
  let page = "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html><head><style>p{color:red}</style></head><body><p>Your flight to Porto is booked.</p></body></html>";
  let db = db();
  let mut row = msg("m1", "t1", 1, 1_000, &[INBOX]);
  row.snippet = page.into();
  db.messages_upsert("vera@example.com", &[row]).unwrap();
  let out = db.messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 })).unwrap();
  assert_eq!(out["threads"][0]["latest"]["snippet"], "Your flight to Porto is booked.");

  // A row whose line came in before this, made good when its body is kept.
  db.conn_mut().execute("UPDATE messages SET snippet = ?1", [&page[..120]]).unwrap();
  db.bodies_put(
    "vera@example.com",
    "m1",
    &BodyRow { text: Some(page.into()), html: Some(page.into()), ..Default::default() },
  )
  .unwrap();
  let out = db.messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 5 })).unwrap();
  assert_eq!(out["threads"][0]["latest"]["snippet"], "Your flight to Porto is booked.");
  assert!(!is_html_page("Hi, the <html> tag starts a page."));
  assert!(is_html_page("  <HTML><body>Hi</body></HTML>"));
}

#[test]
fn inbox_threads_come_newest_first_with_the_latest_message_on_top() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[
      msg("m1", "t1", 1, 1_000, &[INBOX]),
      msg("m2", "t1", 2, 3_000, &[INBOX]),
      msg("m3", "t2", 3, 2_000, &[INBOX]),
      msg("m4", "t3", 4, 4_000, &[SENT]),
    ],
  )
  .unwrap();
  let out = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 10 }))
    .unwrap();
  let threads = out["threads"].as_array().unwrap();
  assert_eq!(threads.len(), 2, "sent-only thread is not in the inbox");
  assert_eq!(threads[0]["threadId"], "t1");
  assert_eq!(threads[0]["latest"]["messageId"], "m2");
  assert_eq!(threads[0]["messageCount"], 2);
  assert_eq!(threads[1]["threadId"], "t2");
  assert!(out["nextBefore"].is_null());
}

#[test]
fn paging_walks_down_by_the_newest_message() {
  let db = db();
  let rows: Vec<MessageRow> = (1..=5)
    .map(|i| msg(&format!("m{i}"), &format!("t{i}"), i, i * 1_000, &[INBOX]))
    .collect();
  db.messages_upsert("vera@example.com", &rows).unwrap();
  let first = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 2 }))
    .unwrap();
  assert_eq!(first["nextBefore"], 4_000);
  let second = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox", "limit": 2, "before": 4_000 }))
    .unwrap();
  let ids: Vec<&str> = second["threads"]
    .as_array()
    .unwrap()
    .iter()
    .map(|t| t["threadId"].as_str().unwrap())
    .collect();
  assert_eq!(ids, vec!["t3", "t2"]);
}

#[test]
fn trash_hides_from_every_view_but_its_own() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[TRASH])],
  )
  .unwrap();
  let inbox = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "inbox" }))
    .unwrap();
  assert_eq!(inbox["threads"].as_array().unwrap().len(), 1);
  let all = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "all" }))
    .unwrap();
  assert_eq!(all["threads"].as_array().unwrap().len(), 1);
  let trash = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "trash" }))
    .unwrap();
  assert_eq!(trash["threads"][0]["threadId"], "t2");
}

#[test]
fn archived_is_what_left_the_inbox_and_was_not_only_sent() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[
      msg("m1", "t1", 1, 1_000, &[]),
      msg("m2", "t2", 2, 2_000, &[INBOX]),
      msg("m3", "t3", 3, 3_000, &[SENT]),
    ],
  )
  .unwrap();
  let out = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "archived" }))
    .unwrap();
  let ids: Vec<&str> = out["threads"]
    .as_array()
    .unwrap()
    .iter()
    .map(|t| t["threadId"].as_str().unwrap())
    .collect();
  assert_eq!(ids, vec!["t1"]);
}

#[test]
fn search_keeps_the_newest_match_among_many_better_ones() {
  // A tester, 2026-10-05: hundreds of mails from one friend, and the newest,
  // a long reply naming him only in its From line, ranked below the 400
  // best matches and never shown, though the list is newest first.
  let db = db();
  let mut rows: Vec<MessageRow> = (0..450)
    .map(|i| {
      let mut m = msg(&format!("old{i}"), &format!("t{i}"), i, 1_000 + i, &[INBOX]);
      m.from_name = "Dennis Dietz".into();
      m.subject = "Dietz".into();
      m.snippet = "Dietz Dietz".into();
      m
    })
    .collect();
  let mut newest = msg("new", "tnew", 9_999, 900_000, &[INBOX]);
  newest.from_name = "Dietz, Dr. Dennis".into();
  newest.subject = "Re: Next steps and the deadline for the application".into();
  newest.snippet = "thanks for the quick answer about the programme the budget the partners and the timeline".into();
  rows.push(newest);
  db.messages_upsert("vera@example.com", &rows).unwrap();
  let out = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "dietz", "limit": 50 }))
    .unwrap();
  let first = out["threads"][0]["threadId"].as_str().unwrap();
  assert_eq!(first, "tnew", "the newest match comes first");
}

#[test]
fn search_finds_subjects_and_then_bodies_once_fetched() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[INBOX])],
  )
  .unwrap();
  let both = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject" }))
    .unwrap();
  assert_eq!(both["threads"].as_array().unwrap().len(), 2, "both subjects say Subject");
  let one = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject t2" }))
    .unwrap();
  assert_eq!(one["threads"].as_array().unwrap().len(), 1, "every word is required");
  let none = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "jetblue" }))
    .unwrap();
  assert_eq!(none["threads"].as_array().unwrap().len(), 0);
  db.bodies_put(
    "vera@example.com",
    "m1",
    &BodyRow {
      html: Some("<p>Your <b>JetBlue</b> booking &amp; receipt</p><style>p{}</style>".into()),
      ..Default::default()
    },
  )
  .unwrap();
  let found = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "jetblue booking" }))
    .unwrap();
  assert_eq!(found["threads"][0]["threadId"], "t1");
  assert_eq!(found["threads"][0]["focusMessageId"], "m1");
  let thread = db
    .messages_thread(&json!({ "account": "vera@example.com", "threadId": "t1" }))
    .unwrap();
  assert!(thread["messages"][0]["body"]["html"].as_str().unwrap().contains("JetBlue"));
}

#[test]
fn flags_follow_the_server_and_a_dropped_uid_leaves_no_trace() {
  let db = db();
  db.messages_upsert("vera@example.com", &[msg("m1", "t1", 7, 1_000, &[INBOX])]).unwrap();
  assert!(db
    .messages_set_flags("vera@example.com", "", 7, Some(false), Some(true), Some(&[INBOX.into(), STARRED.into()]), Some(99))
    .unwrap());
  let out = db
    .messages_list(&json!({ "accounts": ["vera@example.com"], "view": "starred" }))
    .unwrap();
  assert_eq!(out["threads"][0]["unread"], false);
  assert_eq!(out["threads"][0]["starred"], true);
  assert_eq!(db.messages_high_water("vera@example.com", "").unwrap(), (Some(7), Some(99)));
  assert_eq!(db.messages_delete_uids("vera@example.com", "", &[7]).unwrap(), 1);
  assert!(db.messages_known_uids("vera@example.com", "").unwrap().is_empty());
  let gone = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject" }))
    .unwrap();
  assert!(gone["threads"].as_array().unwrap().is_empty());
  // A message in Trash has a UID of its own folder's numbering.
  db.messages_upsert("vera@example.com", &[MessageRow { folder: "trash".into(), ..msg("t1", "tt", 7, 5_000, &[TRASH]) }]).unwrap();
  db.messages_upsert("vera@example.com", &[msg("m9", "t9", 7, 6_000, &[INBOX])]).unwrap();
  assert_eq!(db.messages_known_uids("vera@example.com", "trash").unwrap(), vec![7]);
  assert_eq!(db.messages_known_uids("vera@example.com", "").unwrap(), vec![7]);
  let ids = db.messages_uids_for("vera@example.com", &["t1".into(), "m9".into()]).unwrap();
  assert_eq!(ids[0].2, "trash");
  assert_eq!(ids[1].2, "");
}

#[test]
fn counts_and_sync_state_round_trip() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[
      msg("m1", "t1", 1, 1_000, &[INBOX]),
      MessageRow { unread: false, ..msg("m2", "t2", 2, 2_000, &[INBOX]) },
    ],
  )
  .unwrap();
  let counts = db
    .messages_counts(&json!({ "accounts": ["vera@example.com"], "view": "inbox" }))
    .unwrap();
  assert_eq!(counts["threads"], 2);
  assert_eq!(counts["unread"], 1);
  db.sync_state_set(&SyncState {
    account: "vera@example.com".into(),
    phase: "full".into(),
    uid_validity: Some(5),
    full_sync_total: Some(200),
    full_sync_done: Some(50),
    ..Default::default()
  })
  .unwrap();
  let state = db.sync_state_get("vera@example.com", "").unwrap().unwrap();
  assert_eq!(state.phase, "full");
  assert_eq!(state.full_sync_done, Some(50));
  let listed = db.sync_list().unwrap();
  assert_eq!(listed[0]["account"], "vera@example.com");
}

#[test]
fn recipients_come_from_sent_mail_and_counts_from_labels() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[
      MessageRow {
        from_email: "vera@example.com".into(),
        to: vec![Address { name: "Ann".into(), email: "ann@x.test".into() }],
        cc: vec![Address { name: "".into(), email: "bo@x.test".into() }],
        unread: false,
        ..msg("s1", "t1", 1, 5_000, &[SENT, "Work"])
      },
      MessageRow {
        from_email: "vera@example.com".into(),
        to: vec![Address { name: "Bo Bosen".into(), email: "BO@x.test".into() }],
        unread: false,
        ..msg("s2", "t2", 2, 4_000, &[SENT])
      },
      msg("r1", "t3", 3, 3_000, &[INBOX, "Work"]),
      msg("r2", "t4", 4, 2_000, &[TRASH, "Work"]),
    ],
  )
  .unwrap();
  let who = db.messages_recipients(&json!({ "account": "vera@example.com", "since": 0 })).unwrap();
  let list = who.as_array().unwrap();
  assert_eq!(list.len(), 2);
  assert_eq!(list[0]["email"], "ann@x.test");
  assert_eq!(list[1]["email"], "bo@x.test");
  assert_eq!(list[1]["name"], "Bo Bosen", "a later name fills an empty one");
  assert_eq!(list[1]["lastAt"], 5_000, "the newest mention sets the time");
  let counts = db.messages_label_counts(&json!({ "account": "vera@example.com" })).unwrap();
  assert_eq!(counts[0]["label"], "Work");
  assert_eq!(counts[0]["threads"], 2, "the trashed thread is left out");
  assert_eq!(counts[0]["unread"], 1);
  let within = db
    .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "subject", "view": "label", "label": "Work" }))
    .unwrap();
  let ids: Vec<&str> = within["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap()).collect();
  assert_eq!(ids, vec!["t1", "t3"]);
}

#[test]
fn recipients_count_mail_from_the_readers_other_addresses() {
  let db = db();
  db.messages_upsert(
    "vera@example.com",
    &[
      // Sent from an alias in another client: a copy in the inbox, no Sent label.
      MessageRow {
        from_email: "Vera@Alias.test".into(),
        to: vec![
          Address { name: "Ann".into(), email: "ann@x.test".into() },
          Address { name: "".into(), email: "vera@alias.test".into() },
        ],
        unread: false,
        ..msg("a1", "t1", 1, 5_000, &[INBOX])
      },
      MessageRow {
        from_email: "cy@x.test".into(),
        to: vec![Address { name: "".into(), email: "vera@alias.test".into() }],
        ..msg("r1", "t2", 2, 4_000, &[INBOX])
      },
    ],
  )
  .unwrap();
  let without = db.messages_recipients(&json!({ "account": "vera@example.com", "since": 0 })).unwrap();
  assert_eq!(without.as_array().unwrap().len(), 0, "an alias is not the mailbox unless named");
  let who = db
    .messages_recipients(&json!({ "account": "vera@example.com", "since": 0, "own": ["vera@alias.test"] }))
    .unwrap();
  let list = who.as_array().unwrap();
  assert_eq!(list.len(), 1, "the reader's own alias is not a recipient, and mail to it is not sent mail");
  assert_eq!(list[0]["email"], "ann@x.test");
}

#[test]
fn a_query_becomes_required_prefixes() {
  assert_eq!(fts_query("jet blue"), "\"jet\"* \"blue\"*");
  assert_eq!(fts_query("  ann@sender.test "), "\"ann@sender.test\"*");
  assert_eq!(fts_query("\"quoted words\""), "\"quoted words\"", "a phrase stays whole");
  assert_eq!(fts_query("  "), "");
  assert_eq!(fts_query("https://x.test/a"), "\"https://x.test/a\"*", "a colon in a URL is not a key");
}

#[test]
fn the_words_gmail_reads_become_a_plan() {
  let plan = parse_search("from:ann subject:\"jet blue\" -receipt paris OR london to:vera").unwrap();
  assert_eq!(
    plan.fts,
    "from_text: \"ann\"* subject: \"jet blue\" (\"paris\"* OR \"london\"*) to_text: \"vera\"* NOT \"receipt\"*"
  );
  assert!(plan.after.is_none() && plan.before.is_none() && !plan.attachment);

  let plan = parse_search("has:attachment after:2026-01-10 before:2026/02/01").unwrap();
  assert!(plan.fts.is_empty() && plan.attachment);
  assert_eq!(plan.after, Some(days_from_civil(2026, 1, 10) * 86_400_000));
  assert_eq!(plan.before, Some(days_from_civil(2026, 2, 1) * 86_400_000));
  assert_eq!(days_from_civil(1970, 1, 1), 0);
  assert_eq!(days_from_civil(2000, 3, 1), 11_017);

  let plan = parse_search("newer_than:7d").unwrap();
  let after = plan.after.unwrap();
  assert!(now_ms() - after >= 7 * 86_400_000 && now_ms() - after < 8 * 86_400_000);

  assert!(parse_search("in:anywhere paris").is_none(), "in:anywhere is the provider's");
  assert!(parse_search("is:muted").is_none());
  assert!(parse_search("larger:5M").is_none());
  assert!(parse_search("in:trash in:spam").is_none(), "two hidden places at once");
  assert!(parse_search("has:drive").is_none());
  let plan = parse_search("in:inbox -label:Work/Stuff is:unread -is:starred filename:PDF").unwrap();
  assert_eq!(plan.unread, Some(true));
  assert_eq!(
    plan.labels,
    vec![
      LabelTerm { system: Some(INBOX), key: "inbox".into(), negated: false },
      LabelTerm { system: None, key: "work-stuff".into(), negated: true },
      LabelTerm { system: Some(STARRED), key: "starred".into(), negated: true },
    ]
  );
  assert_eq!(plan.filenames, vec![("pdf".to_string(), false)]);
  assert_eq!(parse_search("in:trash").unwrap().hidden, Some(HiddenPlace::Trash));
  assert_eq!(parse_search("-in:spam").unwrap().hidden, None, "leaving out is not going in");
  assert_eq!(parse_search("is:read").unwrap().unread, Some(false));
  assert!(parse_search("-only").is_none(), "nothing to take away from");
  assert!(parse_search("after:yesterday").is_none(), "a date it cannot read goes out");
  assert!(parse_search("OR paris OR").unwrap().fts == "\"paris\"*", "a stray OR is nothing");
  assert!(parse_search("   ").unwrap().is_empty());
}

#[test]
fn a_fetched_body_settles_whether_there_is_a_file() {
  let db = db();
  let mut guessed = msg("m1", "t1", 1, 1_000, &[INBOX]);
  guessed.has_attachments = true;
  let mut plain = msg("m2", "t2", 2, 2_000, &[INBOX]);
  plain.has_attachments = false;
  db.messages_upsert("vera@example.com", &[guessed, plain]).unwrap();
  let flagged = |db: &MailDb| -> Vec<String> {
    let out = db
      .messages_search(&json!({ "accounts": ["vera@example.com"], "q": "has:attachment" }))
      .unwrap();
    out["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect()
  };
  assert_eq!(flagged(&db), vec!["t1"], "the outer type's guess, before any body is in");

  // A multipart/mixed newsletter with only a picture in it: no file.
  db.bodies_put("vera@example.com", "m1", &BodyRow { html: Some("<p>News</p>".into()), attachments: json!([]), ..Default::default() }).unwrap();
  // A plain-looking mail whose structure turned out to carry a PDF.
  db.bodies_put(
    "vera@example.com",
    "m2",
    &BodyRow { text: Some("See attached".into()), attachments: json!([{ "filename": "a.pdf" }]), ..Default::default() },
  )
  .unwrap();
  assert_eq!(flagged(&db), vec!["t2"], "the body's own list decides");

  // Rows flagged by an older build are put right once, when the store opens.
  {
    let conn = db.conn_mut();
    conn.execute("UPDATE messages SET has_attachments = 1 WHERE message_id = 'm1'", []).unwrap();
    conn.execute("DELETE FROM settings WHERE key = 'repair.attachments'", []).unwrap();
    migrate(&conn).unwrap();
  }
  assert_eq!(flagged(&db), vec!["t2"]);
}

#[test]
fn search_answers_the_operators_from_the_copy() {
  let db = db();
  let jan = days_from_civil(2026, 1, 15) * 86_400_000;
  let mar = days_from_civil(2026, 3, 15) * 86_400_000;
  let mut with_file = msg("m2", "t2", 2, mar, &[INBOX]);
  with_file.has_attachments = true;
  with_file.from_name = "Bo Reader".into();
  with_file.from_email = "bo@reader.test".into();
  db.messages_upsert("vera@example.com", &[msg("m1", "t1", 1, jan, &[INBOX]), with_file]).unwrap();
  let ids = |v: &Value| -> Vec<String> {
    v["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect()
  };
  let search = |q: &str| db.messages_search(&json!({ "accounts": ["vera@example.com"], "q": q })).unwrap();

  assert_eq!(ids(&search("from:ann")), vec!["t1"], "from: reads the sender column only");
  assert_eq!(ids(&search("from:bo@reader.test")), vec!["t2"]);
  assert_eq!(ids(&search("subject:ann")).len(), 0, "the sender is not in the subject");
  assert_eq!(ids(&search("to:vera")).len(), 2);
  assert_eq!(ids(&search("\"subject t1\"")), vec!["t1"], "a phrase, in order");
  assert_eq!(ids(&search("\"t1 subject\"")).len(), 0);
  assert_eq!(ids(&search("subject -t2")), vec!["t1"]);
  assert_eq!(ids(&search("t1 OR t2")).len(), 2);
  assert_eq!(ids(&search("has:attachment")), vec!["t2"], "filters alone, no words");
  assert_eq!(ids(&search("subject has:attachment")), vec!["t2"]);
  assert_eq!(ids(&search("after:2026-02-01")), vec!["t2"]);
  assert_eq!(ids(&search("subject before:2026-02-01")), vec!["t1"]);
  assert_eq!(ids(&search("after:2026-01-01 before:2026-12-31")).len(), 2);
  assert_eq!(search("subject")["handled"], true);

  let out = search("larger:5M subject");
  assert_eq!(out["handled"], false, "the provider's words are handed back");
  assert_eq!(ids(&out).len(), 0);
}

#[test]
fn a_paused_mailbox_is_searched_as_it_was_when_the_pause_began() {
  let db = db();
  // t1: an old letter, and a reply that came in during the pause.
  let mut old = msg("m1", "t1", 1, 1_000, &[INBOX]);
  old.subject = "Budget plan".into();
  old.snippet = "the old letter".into();
  let mut news = msg("m2", "t1", 2, 5_000, &[INBOX]);
  news.subject = "Re: Budget plan".into();
  news.snippet = "the news".into();
  // t2: only new mail, all of it during the pause.
  let mut fresh = msg("m3", "t2", 3, 6_000, &[INBOX]);
  fresh.subject = "Budget news".into();
  // t3: the reader's own reply, sent during the pause.
  let mut mine = msg("m4", "t3", 4, 7_000, &[SENT]);
  mine.subject = "Budget answer".into();
  db.messages_upsert("vera@example.com", &[old, news, fresh, mine]).unwrap();
  let search = |q: &str, as_of: Option<i64>| {
    let mut args = json!({ "accounts": ["vera@example.com"], "q": q });
    if let Some(cut) = as_of {
      args["asOf"] = json!(cut);
    }
    db.messages_search(&args).unwrap()
  };
  let ids = |v: &Value| -> Vec<String> {
    let mut out: Vec<String> =
      v["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect();
    out.sort();
    out
  };

  assert_eq!(ids(&search("budget", None)), vec!["t1", "t2", "t3"], "with no pause, everything");
  let paused = search("budget", Some(3_000));
  assert_eq!(ids(&paused), vec!["t1", "t3"], "mail that came in during the pause is not found");
  let row = paused["threads"].as_array().unwrap().iter().find(|t| t["threadId"] == "t1").unwrap();
  assert_eq!(row["latest"]["snippet"], "the old letter", "the row is the thread as it was: no word of the news");
  assert_eq!(row["lastAt"], json!(1_000));
  assert_eq!(row["messageCount"], json!(1), "and counts only the messages before the pause");
  assert_eq!(ids(&search("news", Some(3_000))).len(), 0, "the new reply's words do not find the thread");
}

#[test]
fn search_answers_folders_labels_read_state_and_file_names_from_the_copy() {
  let db = db();
  let mut unread = msg("m1", "t1", 1, 1_000, &[INBOX, "Clients/Oxford"]);
  unread.unread = true;
  let mut starred = msg("m2", "t2", 2, 2_000, &[STARRED, "Work stuff"]);
  starred.unread = false;
  let binned = msg("m3", "t3", 3, 3_000, &[TRASH]);
  let spam = msg("m4", "t4", 4, 4_000, &[SPAM]);
  db.messages_upsert("vera@example.com", &[unread, starred, binned, spam]).unwrap();
  db.bodies_put(
    "vera@example.com",
    "m2",
    &BodyRow { text: Some("Here".into()), attachments: json!([{ "filename": "Budget 2027.PDF" }]), ..Default::default() },
  )
  .unwrap();
  let ids = |v: &Value| -> Vec<String> {
    let mut out: Vec<String> =
      v["threads"].as_array().unwrap().iter().map(|t| t["threadId"].as_str().unwrap().to_string()).collect();
    out.sort();
    out
  };
  let search = |q: &str| db.messages_search(&json!({ "accounts": ["vera@example.com"], "q": q })).unwrap();

  assert_eq!(ids(&search("in:inbox")), vec!["t1"]);
  assert_eq!(ids(&search("-in:inbox")), vec!["t2"], "trash and spam stay hidden");
  assert_eq!(ids(&search("label:clients-oxford")), vec!["t1"], "Gmail's spelling of a nested label");
  assert_eq!(ids(&search("label:\"Work stuff\"")), vec!["t2"]);
  assert_eq!(ids(&search("in:work-stuff")), vec!["t2"], "in: takes a label too");
  assert_eq!(ids(&search("is:unread")), vec!["t1"]);
  assert_eq!(ids(&search("is:read")), vec!["t2"]);
  assert_eq!(ids(&search("is:starred")), vec!["t2"]);
  assert_eq!(ids(&search("filename:pdf")), vec!["t2"], "case does not matter");
  assert_eq!(ids(&search("filename:budget")), vec!["t2"]);
  assert_eq!(ids(&search("subject -filename:pdf")), vec!["t1"]);
  assert_eq!(ids(&search("in:trash")), vec!["t3"], "the bin shows what it hides elsewhere");
  assert_eq!(ids(&search("in:spam")), vec!["t4"]);
  assert_eq!(ids(&search("in:inbox t1")), vec!["t1"], "words and a folder together");
  assert_eq!(ids(&search("in:inbox t2")).len(), 0);
  assert_eq!(search("is:unread")["handled"], true);
}

#[test]
fn quoted_addresses_already_stored_are_repaired_once() {
  let db = db();
  let mut m = msg("m1", "t1", 1, 1_000, &["INBOX"]);
  m.to = vec![
    Address { name: "Ann Berg".into(), email: "'ann@x.test'".into() },
    Address { name: String::new(), email: "o'neill@w.test".into() },
  ];
  m.cc = vec![Address { name: String::new(), email: "'bo@y.test'".into() }];
  db.messages_upsert("vera@example.com", &[m]).unwrap();
  let conn = db.conn_mut();
  conn.execute_batch(
    "DELETE FROM settings WHERE key = 'repair.quoted-addresses';
       INSERT INTO source_contacts (source, account, email) VALUES
         ('history', 'vera@example.com', '''ann@x.test'''),
         ('history', 'vera@example.com', '''bo@y.test'''),
         ('history', 'vera@example.com', 'bo@y.test');",
  )
  .unwrap();
  repair_quoted_addresses(&conn).unwrap();
  let (to, cc): (String, String) = conn
    .query_row("SELECT to_json, cc_json FROM messages WHERE message_id = 'm1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
    .unwrap();
  let to: Vec<Address> = serde_json::from_str(&to).unwrap();
  let cc: Vec<Address> = serde_json::from_str(&cc).unwrap();
  assert_eq!(to[0], Address { name: "Ann Berg".into(), email: "ann@x.test".into() });
  assert_eq!(to[1].email, "o'neill@w.test");
  assert_eq!(cc[0].email, "bo@y.test");
  let mut stmt = conn.prepare("SELECT email FROM source_contacts ORDER BY email").unwrap();
  let emails: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
  assert_eq!(emails, vec!["ann@x.test", "bo@y.test"]);
}

#[test]
fn an_invite_kept_without_its_text_is_fetched_again_once() {
  let db = db();
  db.messages_upsert("vera@example.com", &[msg("m1", "t1", 1, 1_000, &[INBOX]), msg("m2", "t2", 2, 2_000, &[INBOX])])
    .unwrap();
  let invite = json!([{ "section": "2", "filename": "invite.ics", "mimeType": "text/calendar", "size": 9 }]);
  db.bodies_put("vera@example.com", "m1", &BodyRow { text: Some("Meet".into()), attachments: invite, ..Default::default() })
    .unwrap();
  let with_text = json!([{ "section": "2", "filename": "invite.ics", "mimeType": "text/calendar", "size": 9, "text": "BEGIN:VCALENDAR" }]);
  db.bodies_put("vera@example.com", "m2", &BodyRow { text: Some("Meet".into()), attachments: with_text, ..Default::default() })
    .unwrap();
  let conn = db.conn_mut();
  conn.execute("DELETE FROM settings WHERE key = 'repair.invite-text'", []).unwrap();
  refetch_invites_without_text(&conn).unwrap();
  drop(conn);
  let missing = db.messages_bodies_missing("vera@example.com", 0, i64::MAX, 10).unwrap();
  assert_eq!(missing, vec![("m1".to_string(), 1)]);
}

#[test]
fn the_same_conversation_is_found_in_the_other_mailboxes() {
  let db = db();
  let mut here = msg("g1", "gt", 1, 1_000, &[INBOX]);
  here.rfc_message_id = Some("<a@x.test>".into());
  db.messages_upsert("vera@gmail.test", &[here]).unwrap();
  // The other mailbox has the same mail, and the reply sent from it.
  let mut there = msg("k1", "kt", 1, 1_000, &[INBOX]);
  there.rfc_message_id = Some("<a@x.test>".into());
  let mut reply = msg("k2", "kt", 2, 2_000, &[]);
  reply.rfc_message_id = Some("<b@x.test>".into());
  let mut draft = msg("k3", "kd", 3, 3_000, &[]);
  draft.rfc_message_id = Some("<a@x.test>".into());
  draft.is_draft = true;
  db.messages_upsert("vera@ku.test", &[there, reply, draft]).unwrap();

  let found = db
    .messages_copies(&json!({ "account": "Vera@Gmail.test", "rfcIds": ["<a@x.test>", " ", "<a@x.test>"] }))
    .unwrap();
  assert_eq!(found["copies"], json!([{ "account": "vera@ku.test", "threadId": "kt" }]));
  // Nothing shared, nothing found; its own mailbox is never a copy.
  let none = db.messages_copies(&json!({ "account": "vera@gmail.test", "rfcIds": ["<z@x.test>"] })).unwrap();
  assert_eq!(none["copies"], json!([]));
  let own = db.messages_copies(&json!({ "account": "vera@ku.test", "rfcIds": ["<b@x.test>"] })).unwrap();
  assert_eq!(own["copies"], json!([]));
}

#[test]
fn bodies_read_with_the_wrong_charset_are_fetched_again_once() {
  let db = db();
  let mut misread = msg("m1", "t1", 1, 1_000, &[INBOX]);
  misread.snippet = "Hej \u{fffd}\u{fffd}ster".into();
  db.messages_upsert("vera@example.com", &[misread, msg("m2", "t2", 2, 2_000, &[INBOX])]).unwrap();
  db.bodies_put("vera@example.com", "m1", &BodyRow { text: Some("Hej \u{fffd}\u{fffd}ster".into()), ..Default::default() })
    .unwrap();
  db.bodies_put("vera@example.com", "m2", &BodyRow { text: Some("Hej søster".into()), ..Default::default() })
    .unwrap();
  let conn = db.conn_mut();
  conn.execute("DELETE FROM settings WHERE key = 'repair.charset-bodies'", []).unwrap();
  refetch_misread_bodies(&conn).unwrap();
  drop(conn);

  // The misread one is wanted again, with its snippet cleared; the good one is kept.
  let missing = db.messages_bodies_missing("vera@example.com", 0, i64::MAX, 10).unwrap();
  assert_eq!(missing, vec![("m1".to_string(), 1)]);
  let conn = db.conn_mut();
  let snippet: String =
    conn.query_row("SELECT snippet FROM messages WHERE message_id = 'm1'", [], |r| r.get(0)).unwrap();
  assert_eq!(snippet, "");
  drop(conn);

  // Once: a mark put back after the repair stays.
  db.bodies_put("vera@example.com", "m1", &BodyRow { text: Some("a real \u{fffd}".into()), ..Default::default() })
    .unwrap();
  let conn = db.conn_mut();
  refetch_misread_bodies(&conn).unwrap();
  drop(conn);
  assert!(db.messages_bodies_missing("vera@example.com", 0, i64::MAX, 10).unwrap().is_empty());
}

#[test]
fn a_store_repaired_before_the_latin_letter_decoder_is_repaired_again() {
  let db = db();
  db.messages_upsert("vera@example.com", &[msg("m1", "t1", 1, 1_000, &[INBOX])]).unwrap();
  db.bodies_put("vera@example.com", "m1", &BodyRow { text: Some("Vielen Dank f\u{fffd}r".into()), ..Default::default() })
    .unwrap();
  let conn = db.conn_mut();
  // The store as version 1 left it.
  conn
    .execute("UPDATE settings SET value = '1' WHERE key = 'repair.charset-bodies'", [])
    .unwrap();
  refetch_misread_bodies(&conn).unwrap();
  drop(conn);
  let missing = db.messages_bodies_missing("vera@example.com", 0, i64::MAX, 10).unwrap();
  assert_eq!(missing, vec![("m1".to_string(), 1)]);
}

#[test]
fn html_is_read_as_words() {
  assert_eq!(squash(&strip_html("<div>Hi<br>there &amp; you</div><script>x()</script>")), "Hi there & you");
}
