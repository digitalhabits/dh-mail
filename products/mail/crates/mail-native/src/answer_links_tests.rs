//! Tests for answer_links.rs. Every address and message is invented.

use super::*;
use crate::messages::{Address, MessageRow};

const ME: &str = "vera@mail.test";
const COLLEGE: &str = "vera@college.test";
const DAY: i64 = 24 * 60 * 60 * 1000;

fn db() -> MailDb {
  MailDb::open_in_memory().expect("open")
}

fn own() -> Vec<&'static str> {
  vec![ME, COLLEGE]
}

/// A message from `from` to `to`, in `thread`, sent on day `day`.
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
    ..Default::default()
  }
}

/// The reader's answer from the college mailbox, CC'd here, naming the
/// college's copy of the message it answers. No mailbox here has that copy.
fn lost_reply(id: &str, thread: &str, day: i64, to: &str, subject: &str) -> MessageRow {
  let mut m = msg(id, thread, day, COLLEGE, &[to], subject);
  m.cc = vec![Address { name: String::new(), email: ME.into() }];
  m.in_reply_to = Some("<college-copy@college.test>".into());
  m.references = Some("<college-copy@college.test>".into());
  m
}

fn links(db: &MailDb, thread: &str) -> Value {
  db.messages_answer_links(&json!({ "account": ME, "threadId": thread, "own": own() }))
    .unwrap()["links"]
    .clone()
}

fn threads(links: &Value) -> Vec<(String, String)> {
  links
    .as_array()
    .unwrap()
    .iter()
    .map(|l| (l["direction"].as_str().unwrap().to_string(), l["threadId"].as_str().unwrap().to_string()))
    .collect()
}

#[test]
fn a_reply_from_another_mailbox_links_both_ways() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit"),
    ],
  )
  .unwrap();
  assert_eq!(threads(&links(&db, "answer")), vec![("answers".into(), "asked".into())]);
  let back = links(&db, "asked");
  assert_eq!(threads(&back), vec![("answeredBy".into(), "answer".into())]);
  assert_eq!(back[0]["fromEmail"], COLLEGE);
}

#[test]
fn a_reply_threaded_by_its_headers_is_not_linked() {
  let db = db();
  let mut reply = lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit");
  // The message it names is here: the provider threads it already.
  reply.in_reply_to = Some("<a1@mail.test>".into());
  reply.references = Some("<a1@mail.test>".into());
  db.messages_upsert(ME, &[msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"), reply]).unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
  assert_eq!(links(&db, "asked"), json!([]));
}

#[test]
fn a_reply_that_names_nothing_is_not_linked() {
  let db = db();
  let mut reply = lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit");
  reply.in_reply_to = None;
  reply.references = None;
  db.messages_upsert(ME, &[msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"), reply]).unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
}

#[test]
fn only_the_readers_own_reply_is_linked() {
  let db = db();
  let mut reply = lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit");
  reply.from_email = "someone@else.test".into();
  db.messages_upsert(ME, &[msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"), reply]).unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
  assert_eq!(links(&db, "asked"), json!([]));
}

#[test]
fn the_reply_must_go_to_the_last_sender() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      lost_reply("r1", "answer", 1, "other@school.test", "Re: A visit"),
    ],
  )
  .unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
}

#[test]
fn a_thread_whose_last_word_is_the_readers_is_not_answered() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      msg("a2", "asked", 1, ME, &["fran@school.test"], "Re: A visit"),
      lost_reply("r1", "answer", 2, "fran@school.test", "Re: A visit"),
    ],
  )
  .unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
}

#[test]
fn a_different_subject_is_not_linked() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      lost_reply("r1", "answer", 1, "fran@school.test", "Re: The invoice"),
    ],
  )
  .unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
}

#[test]
fn more_than_fourteen_days_is_too_long() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      lost_reply("r1", "answer", 15, "fran@school.test", "Re: A visit"),
    ],
  )
  .unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
  assert_eq!(links(&db, "asked"), json!([]));
}

#[test]
fn two_threads_that_fit_link_to_neither() {
  let db = db();
  db.messages_upsert(
    ME,
    &[
      msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"),
      msg("b1", "also", 1, "fran@school.test", &[ME], "Re: A visit"),
      lost_reply("r1", "answer", 2, "fran@school.test", "Re: A visit"),
    ],
  )
  .unwrap();
  assert_eq!(links(&db, "answer"), json!([]));
  assert_eq!(links(&db, "asked"), json!([]));
  assert_eq!(links(&db, "also"), json!([]));
}

#[test]
fn a_reply_in_trash_is_not_linked() {
  let db = db();
  let mut reply = lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit");
  reply.folder = "trash".into();
  db.messages_upsert(ME, &[msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit"), reply]).unwrap();
  assert_eq!(links(&db, "asked"), json!([]));
}

#[test]
fn another_mailbox_is_not_searched() {
  let db = db();
  db.messages_upsert(ME, &[msg("a1", "asked", 0, "fran@school.test", &[ME], "A visit")]).unwrap();
  db.messages_upsert("vera@other.test", &[lost_reply("r1", "answer", 1, "fran@school.test", "Re: A visit")])
    .unwrap();
  assert_eq!(links(&db, "asked"), json!([]));
}

#[test]
fn subjects_lose_their_prefixes() {
  assert_eq!(base_subject("Re: A  visit"), "a visit");
  assert_eq!(base_subject("RE: Fwd: SV: a visit"), "a visit");
  assert_eq!(base_subject("Re[2]: A visit"), "a visit");
  assert_eq!(base_subject("AW (3): A visit"), "a visit");
  assert_eq!(base_subject("Agenda: A visit"), "agenda: a visit");
  assert_eq!(base_subject("Re: "), "");
}
