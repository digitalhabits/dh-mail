//! Tests for team_mailbox.rs. Every address and message is invented.

use super::*;
use crate::messages::{Address, MessageRow};

const SHARED: &str = "team@crew.test";
const VERA: &str = "vera@crew.test";
const VERA_COLLEGE: &str = "vera@college.test";
const OSKAR: &str = "oskar@crew.test";
const ASKER: &str = "asker@outside.test";
const OTHER: &str = "someone@elsewhere.test";
const DAY: i64 = 24 * 60 * 60 * 1000;

fn db() -> MailDb {
  MailDb::open_in_memory().expect("open")
}

fn team() -> Vec<&'static str> {
  vec![SHARED, VERA, VERA_COLLEGE, OSKAR]
}

/// A message from `from` to `to`, in `thread`, sent on day `day`.
fn msg(id: &str, thread: &str, day: i64, from: &str, to: &[&str], subject: &str) -> MessageRow {
  MessageRow {
    message_id: id.into(),
    thread_id: thread.into(),
    rfc_message_id: Some(format!("<{id}@crew.test>")),
    from_name: from.split('@').next().unwrap_or_default().into(),
    from_email: from.into(),
    to: to.iter().map(|e| Address { name: String::new(), email: (*e).into() }).collect(),
    subject: subject.into(),
    sent_at: 1_000 * DAY + day * DAY,
    labels: vec!["INBOX".into()],
    ..Default::default()
  }
}

/// A team member's answer from another mailbox, with the shared mailbox in
/// CC, naming `answers` as the message it answers.
fn reply(id: &str, thread: &str, day: i64, from: &str, to: &str, subject: &str, answers: &str) -> MessageRow {
  let mut m = msg(id, thread, day, from, &[to], subject);
  m.cc = vec![Address { name: String::new(), email: SHARED.into() }];
  m.in_reply_to = Some(answers.into());
  m.references = Some(answers.into());
  m
}

fn states(db: &MailDb, threads: &[&str]) -> Vec<Value> {
  db.messages_team_states(&json!({ "account": SHARED, "threadIds": threads, "team": team() }))
    .unwrap()["states"]
    .as_array()
    .unwrap()
    .clone()
}

fn state_of(db: &MailDb, thread: &str) -> (String, Option<String>) {
  let all = states(db, &[thread]);
  let s = &all[0];
  (
    s["state"].as_str().unwrap().to_string(),
    s["answeredBy"]["how"].as_str().map(str::to_string),
  )
}

fn put(db: &MailDb, rows: &[MessageRow]) {
  db.messages_upsert(SHARED, rows).unwrap();
}

#[test]
fn a_question_with_no_answer_is_open() {
  let db = db();
  put(&db, &[msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates")]);
  assert_eq!(state_of(&db, "t1"), ("open".into(), None));
}

#[test]
fn a_reply_in_the_same_thread_answers_it_and_a_new_question_opens_it_again() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      reply("a1", "t1", 2, VERA_COLLEGE, ASKER, "Re: Workshop dates", "<q1@crew.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("answered".into(), Some("reply".into())));
  put(&db, &[msg("q2", "t1", 3, ASKER, &[SHARED], "Re: Workshop dates")]);
  assert_eq!(state_of(&db, "t1"), ("open".into(), None));
}

#[test]
fn a_reply_with_a_new_subject_in_its_own_thread_links_by_its_headers() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      reply("a1", "t2", 2, VERA_COLLEGE, ASKER, "Two dates in May", "<q1@crew.test>"),
    ],
  );
  let all = states(&db, &["t1"]);
  assert_eq!(all[0]["state"], "answered");
  assert_eq!(all[0]["answeredBy"]["how"], "linked");
  assert_eq!(all[0]["answeredBy"]["threadId"], "t2");
  assert_eq!(all[0]["answeredBy"]["fromEmail"], VERA_COLLEGE);
}

#[test]
fn a_reply_to_a_forwarded_copy_with_a_new_subject_matches_the_only_open_thread() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      reply("a1", "t2", 2, VERA_COLLEGE, ASKER, "Two dates in May", "<forwarded-copy@college.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("answered".into(), Some("matched".into())));
}

#[test]
fn two_open_threads_from_the_same_sender_match_neither() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      msg("q2", "t3", 1, ASKER, &[SHARED], "An invoice"),
      reply("a1", "t2", 2, VERA_COLLEGE, ASKER, "Two dates in May", "<forwarded-copy@college.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("open".into(), None));
  assert_eq!(state_of(&db, "t3"), ("open".into(), None));
}

#[test]
fn of_two_open_threads_the_one_with_the_same_subject_is_matched() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      msg("q2", "t3", 1, ASKER, &[SHARED], "An invoice"),
      reply("a1", "t2", 2, VERA_COLLEGE, ASKER, "SV: Workshop dates", "<forwarded-copy@college.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("answered".into(), Some("matched".into())));
  assert_eq!(state_of(&db, "t3"), ("open".into(), None));
}

#[test]
fn a_forwarded_reply_more_than_two_weeks_later_or_to_someone_else_does_not_match() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      reply("a1", "t2", 20, VERA_COLLEGE, ASKER, "Two dates in May", "<forwarded-copy@college.test>"),
      reply("a2", "t4", 2, VERA_COLLEGE, OTHER, "Two dates in May", "<forwarded-copy@college.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("open".into(), None));
}

#[test]
fn mail_from_outside_the_team_never_answers() {
  let db = db();
  put(
    &db,
    &[
      msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates"),
      reply("a1", "t2", 2, OTHER, ASKER, "Re: Workshop dates", "<q1@crew.test>"),
    ],
  );
  assert_eq!(state_of(&db, "t1"), ("open".into(), None));
}

#[test]
fn only_the_team_wrote_so_there_is_nothing_to_answer() {
  let db = db();
  put(&db, &[msg("s1", "t1", 1, OSKAR, &[ASKER], "Our news")]);
  assert_eq!(state_of(&db, "t1"), ("none".into(), None));
}

#[test]
fn assigned_labels_and_the_answered_mark_come_from_the_labels() {
  let db = db();
  put(&db, &[msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates")]);
  db.actions_apply_and_enqueue(SHARED, "t1", "label", &json!({ "label": "Assigned/Vera" })).unwrap();
  let all = states(&db, &["t1"]);
  assert_eq!(all[0]["assigned"], json!(["Vera"]));
  assert_eq!(all[0]["state"], "open");

  db.actions_apply_and_enqueue(SHARED, "t1", "label", &json!({ "label": "Answered" })).unwrap();
  assert_eq!(state_of(&db, "t1"), ("answered".into(), Some("marked".into())));

  // The sender writes again: the new message has no mark, so it is open.
  put(&db, &[msg("q2", "t1", 3, ASKER, &[SHARED], "Re: Workshop dates")]);
  let all = states(&db, &["t1"]);
  assert_eq!(all[0]["state"], "open");
  assert_eq!(all[0]["assigned"], json!(["Vera"]), "the assignment stays");

  db.actions_apply_and_enqueue(SHARED, "t1", "unlabel", &json!({ "label": "Assigned/Vera" })).unwrap();
  assert_eq!(states(&db, &["t1"])[0]["assigned"], json!([]));
}

#[test]
fn the_label_actions_keep_the_thread_in_the_inbox_and_queue_for_the_server() {
  let db = db();
  put(&db, &[msg("q1", "t1", 1, ASKER, &[SHARED], "Workshop dates")]);
  db.actions_apply_and_enqueue(SHARED, "t1", "label", &json!({ "label": "Assigned/Oskar", "create": true })).unwrap();
  let labels: Vec<String> = {
    let conn = db.conn_mut();
    let mut stmt = conn.prepare("SELECT label FROM message_labels WHERE message_id = 'q1' ORDER BY label").unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
  };
  assert_eq!(labels, vec!["Assigned/Oskar".to_string(), "INBOX".to_string()]);
  let kinds: Vec<String> = db.actions_pending(SHARED).unwrap().into_iter().map(|a| a.kind).collect();
  assert_eq!(kinds, vec!["label"]);
  assert!(db.actions_apply_and_enqueue(SHARED, "t1", "label", &json!({})).is_err(), "a label is needed");
}
