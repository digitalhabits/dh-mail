//! "Older mail": a search on Gmail's server for the mail whose words the
//! copy does not hold.
//!
//! The copy keeps the headers of every message, but the body only for the
//! last year (`BODY_WINDOW_MS` in sync.rs). A word deep in an older mail is
//! not in the index, so the local search cannot find it. After the local
//! search, the interface asks Gmail too: `X-GM-RAW` on All Mail, with the
//! reader's words and a `before:` date at the edge of the window. The UIDs
//! that come back are mapped to rows the copy already has, so the results
//! show with no message read again. See docs/mail-local-store.md, section 6.
//!
//! IMAP, not the Gmail API: the API's budget is why the copy exists. The
//! search runs on an on-demand connection from the pool, never on the
//! worker's own, so the sync does not wait for it.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::db::{now_ms, MailDb};
use crate::imap::{Client, MailboxName};
use crate::sync::{select_logical, with_on_demand, BODY_WINDOW_MS};

const DAY_MS: i64 = 86_400_000;
/// The most UIDs mapped for one search. UIDs grow with time, so these are
/// the newest matches.
const MAX_UIDS: usize = 500;
/// Threads in one answer, when the caller does not say.
const DEFAULT_LIMIT: usize = 50;

/// The text for `X-GM-RAW`: the words as typed, and a `before:` date.
///
/// The date is the day after the window's edge. Gmail reads a date as
/// midnight in its own time zone, and the day of overlap makes sure that
/// no mail falls between the local search and this one. The interface
/// drops a thread the local search found already.
///
/// The words go in parentheses, so an `OR` in them does not take the date
/// as its other side. A quote with no partner is closed, or it would take
/// the date into the phrase. Parentheses that do not pair are dropped.
pub fn gm_raw_text(q: &str, before_ms: i64) -> String {
  let mut words = q.replace(['\r', '\n'], " ").trim().to_string();
  if words.matches('(').count() != words.matches(')').count() {
    words = words.replace(['(', ')'], "");
  }
  if words.matches('"').count() % 2 == 1 {
    words.push('"');
  }
  let (y, m, d) = civil_from_days(before_ms.div_euclid(DAY_MS) + 1);
  format!("({}) before:{y:04}/{m:02}/{d:02}", words.trim())
}

/// The calendar date of a day number counted from 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
  let z = days + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
  (y, m, d)
}

/// The newest `MAX_UIDS` of a search answer.
fn newest_uids(mut uids: Vec<u32>) -> Vec<u32> {
  uids.sort_unstable();
  let skip = uids.len().saturating_sub(MAX_UIDS);
  uids.split_off(skip)
}

/// Select All Mail and run the search on it.
///
/// `None` when the folder's UIDVALIDITY is not the one the copy holds:
/// the server's UIDs then name other messages than the copy's, and the
/// worker is about to read the folder again.
fn search_all_mail(
  client: &mut Client,
  boxes: &[MailboxName],
  text: &str,
  stored_validity: Option<i64>,
) -> Result<Option<Vec<u32>>, String> {
  let info = select_logical(client, boxes, "")?;
  if info.uid_validity.map(i64::from) != stored_validity {
    return Ok(None);
  }
  let uids = client.uid_search_text("X-GM-RAW", text).map_err(|e| e.to_string())?;
  Ok(Some(uids))
}

// ---------------------------------------------------------------------------
// A changed or cancelled search
// ---------------------------------------------------------------------------

/// The newest search for each mailbox. A search that is no longer the
/// newest does not ask the server, and its answer is not used.
fn tickets() -> &'static Mutex<HashMap<String, u64>> {
  static TICKETS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
  TICKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_ticket(email: &str) -> u64 {
  let mut all = tickets().lock().unwrap();
  let ticket = all.entry(email.to_string()).or_insert(0);
  *ticket += 1;
  *ticket
}

fn is_newest(email: &str, ticket: u64) -> bool {
  tickets().lock().unwrap().get(email).copied() == Some(ticket)
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/// Search Gmail for mail older than the body window, as threads from the
/// copy, newest first.
///
/// The answer is `{ threads, handled }`, with `superseded` when a newer
/// search for the mailbox started meanwhile. `handled` is false for a
/// query with a word only the provider knows (`in:`, `is:`): the list asked
/// the provider for that one, across all of the mail. A mailbox whose
/// copy is not live has no connection to search on, and the call fails.
#[tauri::command]
pub async fn mail_sync_search_older(
  app: AppHandle,
  account: String,
  query: String,
  limit: Option<usize>,
) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let email = account.trim().to_lowercase();
    let ticket = next_ticket(&email);
    match crate::messages::parse_search(&query) {
      None => return Ok(json!({ "threads": [], "handled": false })),
      Some(plan) if plan.is_empty() => return Ok(json!({ "threads": [], "handled": true })),
      Some(_) => {}
    }
    let db = app.state::<MailDb>();
    let state = db.sync_state_get(&email, "").map_err(|e| e.to_string())?;
    let Some(state) = state.filter(|s| s.phase == "live") else {
      return Err("the mailbox is not connected".into());
    };
    let text = gm_raw_text(&query, now_ms() - BODY_WINDOW_MS);
    let found = with_on_demand(&app, &email, |client, boxes| {
      if !is_newest(&email, ticket) {
        return Ok(None);
      }
      search_all_mail(client, boxes, &text, state.uid_validity)
    })?;
    if !is_newest(&email, ticket) {
      return Ok(json!({ "threads": [], "handled": true, "superseded": true }));
    }
    let uids = newest_uids(found.unwrap_or_default());
    let threads = db
      .messages_threads_for_uids(&email, "", &uids, limit.unwrap_or(DEFAULT_LIMIT))
      .map_err(|e| e.to_string())?;
    log::info!("[mail-sync] {email}: older mail search found {} threads", threads.len());
    Ok(json!({ "threads": threads, "handled": true }))
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The reader typed on or left the search: a search still waiting for a
/// connection does not ask the server, and one under way is not used.
#[tauri::command]
pub fn mail_sync_search_older_cancel(account: String) {
  next_ticket(&account.trim().to_lowercase());
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::imap::fake_server;
  use crate::messages::{Address, MessageRow, INBOX, TRASH};

  /// 2025-10-07 09:30 UTC.
  const EDGE: i64 = 1_759_829_400_000;

  #[test]
  fn the_query_carries_the_words_and_the_day_after_the_edge() {
    assert_eq!(gm_raw_text("rooftop garden", EDGE), "(rooftop garden) before:2025/10/08");
    // Midnight is still the day before the edge's next day.
    assert_eq!(gm_raw_text("rooftop", 1_759_795_200_000), "(rooftop) before:2025/10/08");
    // A new year, and a leap day.
    assert_eq!(gm_raw_text("rota", 1_735_686_000_000), "(rota) before:2025/01/01");
    assert_eq!(gm_raw_text("rota", 1_709_121_600_000), "(rota) before:2024/02/29");
  }

  #[test]
  fn the_words_cannot_swallow_the_date() {
    // OR keeps to the words.
    assert_eq!(gm_raw_text("plums OR pears", EDGE), "(plums OR pears) before:2025/10/08");
    // A quote left open is closed before the date.
    assert_eq!(gm_raw_text("\"rooftop garden", EDGE), "(\"rooftop garden\") before:2025/10/08");
    // A stray parenthesis goes; a pair stays.
    assert_eq!(gm_raw_text("(plums pears", EDGE), "(plums pears) before:2025/10/08");
    assert_eq!(gm_raw_text("(plums OR pears) jam", EDGE), "((plums OR pears) jam) before:2025/10/08");
    // A line break is a space.
    assert_eq!(gm_raw_text("plums\r\njam", EDGE), "(plums  jam) before:2025/10/08");
  }

  #[test]
  fn only_the_newest_uids_are_mapped() {
    let many: Vec<u32> = (1..=1_200).rev().collect();
    let kept = newest_uids(many);
    assert_eq!(kept.len(), MAX_UIDS);
    assert_eq!(kept.first(), Some(&701));
    assert_eq!(kept.last(), Some(&1_200));
  }

  fn all_mail() -> Vec<MailboxName> {
    vec![MailboxName {
      name: "[Gmail]/All Mail".into(),
      raw: "[Gmail]/All Mail".into(),
      attributes: vec!["\\All".into(), "\\HasNoChildren".into()],
    }]
  }

  #[test]
  fn a_plain_query_goes_as_a_quoted_string() {
    let stream = fake_server(vec![
      ("SELECT \"[Gmail]/All Mail\"", "* 40 EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n{tag} OK [READ-WRITE] done\r\n"),
      (
        "UID SEARCH X-GM-RAW \"(\\\"rooftop garden\\\" -draft) before:2025/10/08\"",
        "* SEARCH 12 30 4\r\n{tag} OK done\r\n",
      ),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    let text = gm_raw_text("\"rooftop garden\" -draft", EDGE);
    let uids = search_all_mail(&mut client, &all_mail(), &text, Some(7)).unwrap();
    assert_eq!(uids, Some(vec![4, 12, 30]));
  }

  #[test]
  fn other_letters_go_as_a_literal_in_utf8() {
    let text = gm_raw_text("blåbær", EDGE);
    let size = text.len();
    let announce: &'static str = Box::leak(format!("CHARSET UTF-8 X-GM-RAW {{{size}}}").into_boxed_str());
    let stream = fake_server(vec![
      ("SELECT", "* OK [UIDVALIDITY 7] ok\r\n{tag} OK done\r\n"),
      (announce, "+ go ahead\r\n"),
      ("(blåbær) before:2025/10/08", "* SEARCH 9\r\n{tag} OK done\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    assert_eq!(search_all_mail(&mut client, &all_mail(), &text, Some(7)).unwrap(), Some(vec![9]));
  }

  #[test]
  fn a_folder_read_again_since_is_not_searched() {
    // UIDVALIDITY changed: the copy's UIDs name other messages now.
    let stream = fake_server(vec![("SELECT", "* OK [UIDVALIDITY 8] ok\r\n{tag} OK done\r\n")]);
    let mut client = Client::connect_plain(stream).unwrap();
    assert_eq!(search_all_mail(&mut client, &all_mail(), "(plums) before:2025/10/08", Some(7)).unwrap(), None);
  }

  fn row(id: &str, thread: &str, uid: i64, at: i64, labels: &[&str]) -> MessageRow {
    MessageRow {
      message_id: id.into(),
      thread_id: thread.into(),
      uid: Some(uid),
      from_name: "Tove Tang".into(),
      from_email: "tove@example.net".into(),
      to: vec![Address { name: "Ivo".into(), email: "ivo@example.com".into() }],
      subject: format!("Allotment {thread}"),
      snippet: format!("Notes on the allotment, {id}"),
      sent_at: at,
      labels: labels.iter().map(|s| s.to_string()).collect(),
      ..Default::default()
    }
  }

  #[test]
  fn uids_map_to_the_stored_threads_newest_first() {
    let db = MailDb::open_in_memory().unwrap();
    let account = "ivo@example.com";
    db.messages_upsert(
      account,
      &[
        row("a1", "ta", 10, 1_000, &[INBOX]),
        row("a2", "ta", 11, 2_000, &[INBOX]),
        row("b1", "tb", 20, 5_000, &[]),
        row("c1", "tc", 30, 9_000, &[TRASH]),
      ],
    )
    .unwrap();
    // 99 is not in the copy; 30 is in Trash, which a search leaves out.
    let threads = db.messages_threads_for_uids(account, "", &[10, 11, 20, 30, 99], 50).unwrap();
    let ids: Vec<&str> = threads.iter().map(|t| t.thread_id.as_str()).collect();
    assert_eq!(ids, vec!["tb", "ta"]);
    // The newest hit of a thread is the one the reader is taken to.
    assert_eq!(threads[1].focus_message_id.as_deref(), Some("a2"));
    assert_eq!(threads[1].message_count, 2);
    // A UID of another folder's numbering is not one of All Mail's.
    assert!(db.messages_threads_for_uids(account, "trash", &[10], 50).unwrap().is_empty());
    // The limit keeps the newest.
    let one = db.messages_threads_for_uids(account, "", &[10, 20], 1).unwrap();
    assert_eq!(one[0].thread_id, "tb");
  }

  #[test]
  fn a_newer_search_supersedes_the_one_before() {
    let email = "supersede@example.com";
    let first = next_ticket(email);
    assert!(is_newest(email, first));
    let second = next_ticket(email);
    assert!(!is_newest(email, first));
    assert!(is_newest(email, second));
    mail_sync_search_older_cancel(" Supersede@example.com ".into());
    assert!(!is_newest(email, second), "a cancel ends the search under way");
  }
}
