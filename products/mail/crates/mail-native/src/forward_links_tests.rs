//! Tests for forward_links.rs. Every address and message is invented.

use super::*;
use crate::messages::{Address, MessageRow};

const ME: &str = "vera@mail.test";
const DAY: i64 = 24 * 60 * 60 * 1000;

fn db() -> MailDb {
  MailDb::open_in_memory().expect("open")
}

/// A message in `thread`, sent on day `day`. Ours when `from` is ME.
fn msg(id: &str, thread: &str, day: i64, from: &str, to: &[&str], subject: &str) -> MessageRow {
  MessageRow {
    message_id: id.into(),
    thread_id: thread.into(),
    rfc_message_id: Some(format!("<{id}@mail.test>")),
    from_name: from.split('@').next().unwrap_or_default().into(),
    from_email: from.into(),
    to: to.iter().map(|e| Address { name: String::new(), email: (*e).into() }).collect(),
    subject: subject.into(),
    sent_at: 1_000 * DAY + day * DAY,
    labels: vec![if from == ME { "SENT".to_string() } else { "INBOX".to_string() }],
    ..Default::default()
  }
}

fn links(db: &MailDb, thread: &str) -> Vec<Value> {
  db.messages_forward_links(&json!({ "account": ME, "threadId": thread })).unwrap()["links"].as_array().unwrap().clone()
}

#[test]
fn a_subject_begins_as_a_forward_only_with_the_mark_first() {
  assert!(begins_as_forward("Fwd: Boat plans"));
  assert!(begins_as_forward("FW: Re: Boat plans"));
  assert!(begins_as_forward("VS: Bådplaner"));
  assert!(!begins_as_forward("Re: Fwd: Boat plans"), "an answer to a forward is an answer");
  assert!(!begins_as_forward("Forward planning: the boats"));
  assert!(!begins_as_forward("Boat plans"));
}

#[test]
fn a_mail_sent_on_is_linked_to_its_forward_with_who_and_when() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "t-source", 0, "olaf@yard.test", &[ME], "Boat plans"),
      msg("f1", "t-forward", 2, ME, &["sigrid@workshop.test"], "Fwd: Boat plans"),
    ],
  )
  .unwrap();
  let found = links(&db, "t-source");
  assert_eq!(found.len(), 1);
  assert_eq!(found[0]["threadId"], "t-forward", "Show forward opens the forward's own thread");
  assert_eq!(found[0]["subject"], "Fwd: Boat plans", "under the forward's own subject");
  assert_eq!(found[0]["sentAt"], json!(1_000 * DAY + 2 * DAY));
  assert_eq!(found[0]["to"][0]["email"], "sigrid@workshop.test");
  assert!(links(&db, "t-forward").is_empty(), "the forward itself is not a mail that was forwarded");
}

#[test]
fn the_newest_forward_comes_first_and_a_reply_is_not_a_forward() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "t-source", 0, "olaf@yard.test", &[ME], "Re: Boat plans"),
      msg("r1", "t-source", 1, ME, &["olaf@yard.test"], "Re: Boat plans"),
      msg("f1", "t-one", 2, ME, &["sigrid@workshop.test"], "FW: Re: Boat plans"),
      msg("f2", "t-two", 5, ME, &["tove@harbour.test"], "Fwd: Boat plans"),
      msg("x1", "t-other", 3, ME, &["tove@harbour.test"], "Re: Boat plans and more"),
    ],
  )
  .unwrap();
  let found = links(&db, "t-source");
  let threads: Vec<&str> = found.iter().map(|l| l["threadId"].as_str().unwrap()).collect();
  assert_eq!(threads, vec!["t-two", "t-one"]);
}

#[test]
fn a_forward_sent_before_the_mail_came_is_not_of_it() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("f1", "t-forward", 0, ME, &["sigrid@workshop.test"], "Fwd: Boat plans"),
      msg("a1", "t-source", 3, "olaf@yard.test", &[ME], "Boat plans"),
    ],
  )
  .unwrap();
  assert!(links(&db, "t-source").is_empty());
}

#[test]
fn two_threads_with_one_subject_are_not_guessed_between_unless_a_header_says() {
  let db = db();
  let mut named = msg("f1", "t-forward", 4, ME, &["sigrid@workshop.test"], "Fwd: Invoice");
  db.messages_upsert(
    ME,
    &[
      msg("a1", "t-first", 0, "olaf@yard.test", &[ME], "Invoice"),
      msg("b1", "t-second", 1, "tove@harbour.test", &[ME], "Invoice"),
      named.clone(),
    ],
  )
  .unwrap();
  assert!(links(&db, "t-first").is_empty(), "either could be the one sent on");
  assert!(links(&db, "t-second").is_empty());

  // The forward names the second mail: now it is known.
  named.references = Some("<b1@mail.test>".into());
  db.messages_upsert(ME, &[named]).unwrap();
  assert_eq!(links(&db, "t-second").len(), 1);
  assert!(links(&db, "t-first").is_empty());
}

#[test]
fn a_list_row_carries_the_time_of_its_newest_forward() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "t-source", 0, "olaf@yard.test", &[ME], "Boat plans"),
      msg("f1", "t-forward", 2, ME, &["sigrid@workshop.test"], "Fwd: Boat plans"),
      msg("c1", "t-plain", 1, "tove@harbour.test", &[ME], "Harbour dues"),
    ],
  )
  .unwrap();
  let page = db.messages_list(&json!({ "accounts": [ME], "view": "inbox" })).unwrap();
  let row = |id: &str| page["threads"].as_array().unwrap().iter().find(|t| t["threadId"] == id).unwrap().clone();
  assert_eq!(row("t-source")["forwardedAt"], json!(1_000 * DAY + 2 * DAY));
  assert!(row("t-plain").get("forwardedAt").is_none(), "a mail not sent on has no mark");
}

#[test]
fn a_reply_under_a_new_subject_is_linked_once_the_page_notes_it() {
  let db = db();
  db.messages_upsert(ME, &[msg("a1", "t-source", 0, "olaf@yard.test", &[ME], "Boat plans")]).unwrap();
  let noted = 1_000 * DAY + 3 * DAY;
  db.messages_note_reply_apart(&json!({
    "account": ME, "threadId": "t-source", "fromAccount": ME, "subject": "A signature for the boat plans",
    "to": [{ "name": "Sigrid Sten", "email": "sigrid@workshop.test" }], "at": noted,
  }))
  .unwrap();

  // Before the sent copy is in: the link says what was sent, with no thread to open.
  let early = links(&db, "t-source");
  assert_eq!(early.len(), 1);
  assert_eq!(early[0]["kind"], "reply");
  assert!(early[0].get("threadId").is_none());
  assert_eq!(early[0]["to"][0]["name"], "Sigrid Sten");

  // The sent copy lands a minute later, under its own thread.
  let mut sent = msg("r1", "t-reply", 3, ME, &["sigrid@workshop.test"], "A signature for the boat plans");
  sent.sent_at = noted + 60_000;
  db.messages_upsert(ME, &[sent]).unwrap();
  let found = links(&db, "t-source");
  assert_eq!(found[0]["threadId"], "t-reply", "Show reply opens the reply's own thread");
  assert_eq!(found[0]["sentAt"], json!(noted + 60_000));

  let page = db.messages_list(&json!({ "accounts": [ME], "view": "inbox" })).unwrap();
  let row = page["threads"].as_array().unwrap().iter().find(|t| t["threadId"] == "t-source").unwrap().clone();
  assert_eq!(row["repliedApartAt"], json!(noted), "and the row has its arrow");
}

#[test]
fn a_forward_and_a_reply_of_one_mail_come_newest_first() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "t-source", 0, "olaf@yard.test", &[ME], "Boat plans"),
      msg("f1", "t-forward", 2, ME, &["tove@harbour.test"], "Fwd: Boat plans"),
    ],
  )
  .unwrap();
  db.messages_note_reply_apart(&json!({
    "account": ME, "threadId": "t-source", "fromAccount": ME, "subject": "New name", "to": [], "at": 1_000 * DAY + 4 * DAY,
  }))
  .unwrap();
  let kinds: Vec<String> = links(&db, "t-source").iter().map(|l| l["kind"].as_str().unwrap().to_string()).collect();
  assert_eq!(kinds, vec!["reply", "forward"]);
}
