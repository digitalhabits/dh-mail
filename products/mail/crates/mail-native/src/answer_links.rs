//! A reply and the thread it answers, when the provider keeps them apart.
//!
//! The reader can answer from a mailbox that is not connected: Outlook, with
//! the college address. Their reply comes back in a CC to a connected
//! mailbox, and it names the message it answers by that mailbox's copy. The
//! connected mailbox has the mail only as a copy that a redirect rule made,
//! under a new Message-ID. So the reply points at a message that no mailbox
//! here has, and Gmail gives it a thread of its own (2026-10-22).
//!
//! This finds the pair, so each thread can link to the other. It joins
//! nothing: the threads stay as the provider has them, and every action acts
//! on the thread it is given. A wrong link is only a wrong link.
//!
//! A reply is linked only when all of these hold:
//!
//! - it is from one of the reader's own addresses, connected or not;
//! - it names the message it answers (In-Reply-To or References), and no
//!   mailbox here has a message with any of those ids;
//! - another thread in the same mailbox has the same subject, once "Re:" and
//!   the like are taken off;
//! - that thread's newest message before the reply is not the reader's, its
//!   sender is in the reply's To or Cc, and it is at most 14 days older;
//! - exactly one thread fits. Two that fit link to neither.

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::db::{str_arg, str_list_arg, DbResult, MailDb};

/// How much older than the reply the message it answers may be.
const WINDOW_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// Prefixes a mail client puts before a subject, in the languages we see.
const PREFIXES: &[&str] = &["re", "fw", "fwd", "aw", "sv", "vs", "wg", "tr", "rv", "antw", "res", "ref"];

/// The subject without its "Re:", "Fwd:", "SV:" or "Re[2]:" prefixes, lower
/// case, single spaces. Empty when nothing is left.
pub fn base_subject(subject: &str) -> String {
  let mut rest = subject.trim().to_lowercase();
  loop {
    let Some(colon) = rest.find(':') else { break };
    let head = rest[..colon].trim_end();
    // "re", "re[2]", "re (2)"
    let word = head.split(|c: char| c == '[' || c == '(').next().unwrap_or("").trim_end();
    let tail = &head[word.len()..];
    let counter = tail.is_empty()
      || tail
        .trim_matches(|c: char| c == '[' || c == ']' || c == '(' || c == ')' || c.is_whitespace())
        .chars()
        .all(|c| c.is_ascii_digit());
    if !PREFIXES.contains(&word) || !counter {
      break;
    }
    rest = rest[colon + 1..].trim_start().to_string();
  }
  rest.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Every Message-ID named in In-Reply-To and References.
fn named_ids(in_reply_to: &str, references: &str) -> Vec<String> {
  let mut ids = Vec::new();
  for text in [in_reply_to, references] {
    let mut rest = text;
    while let Some(start) = rest.find('<') {
      let Some(len) = rest[start..].find('>') else { break };
      ids.push(rest[start..start + len + 1].to_string());
      rest = &rest[start + len + 1..];
    }
  }
  ids.sort();
  ids.dedup();
  ids
}

fn emails(json_list: &str) -> Vec<String> {
  serde_json::from_str::<Vec<Value>>(json_list)
    .unwrap_or_default()
    .iter()
    .filter_map(|a| a.get("email").and_then(Value::as_str))
    .map(|e| e.trim().to_lowercase())
    .collect()
}

#[derive(Debug, Clone)]
struct Msg {
  thread_id: String,
  from_name: String,
  from_email: String,
  subject: String,
  sent_at: i64,
  in_reply_to: String,
  references: String,
  recipients: Vec<String>,
}

const COLUMNS: &str = "thread_id, from_name, from_email, subject, sent_at, COALESCE(in_reply_to, ''),
  COALESCE(ref_headers, ''), to_json, cc_json";
const LIVE: &str = "is_draft = 0 AND folder NOT IN ('trash', 'spam')";

fn read(r: &rusqlite::Row) -> rusqlite::Result<Msg> {
  let mut recipients = emails(&r.get::<_, String>(7)?);
  recipients.extend(emails(&r.get::<_, String>(8)?));
  Ok(Msg {
    thread_id: r.get(0)?,
    from_name: r.get(1)?,
    from_email: r.get::<_, String>(2)?.trim().to_lowercase(),
    subject: r.get(3)?,
    sent_at: r.get(4)?,
    in_reply_to: r.get(5)?,
    references: r.get(6)?,
    recipients,
  })
}

/// The reply's own address and a named message no mailbox here has.
fn is_lost_reply(conn: &Connection, m: &Msg, own: &HashSet<String>) -> DbResult<bool> {
  if !own.contains(&m.from_email) {
    return Ok(false);
  }
  let ids = named_ids(&m.in_reply_to, &m.references);
  if ids.is_empty() {
    return Ok(false);
  }
  let mut stmt = conn.prepare_cached("SELECT 1 FROM messages WHERE rfc_message_id = ?1 LIMIT 1")?;
  for id in &ids {
    if stmt.exists(params![id])? {
      return Ok(false);
    }
  }
  Ok(true)
}

/// The one thread this lost reply answers, and the message in it that it
/// answers. None when no thread fits, or more than one does.
fn answered(conn: &Connection, account: &str, reply: &Msg, own: &HashSet<String>) -> DbResult<Option<Msg>> {
  let base = base_subject(&reply.subject);
  if base.is_empty() {
    return Ok(None);
  }
  let sql = format!(
    "SELECT {COLUMNS} FROM messages
      WHERE account_email = ?1 AND thread_id <> ?2 AND sent_at < ?3 AND sent_at >= ?4 AND {LIVE}
      ORDER BY thread_id, sent_at"
  );
  let mut stmt = conn.prepare(&sql)?;
  let rows = stmt
    .query_map(params![account, reply.thread_id, reply.sent_at, reply.sent_at - WINDOW_MS], read)?
    .collect::<Result<Vec<_>, _>>()?;
  // Each thread's newest message before the reply: rows come oldest first.
  let mut newest: Vec<Msg> = Vec::new();
  for row in rows {
    match newest.last_mut() {
      Some(last) if last.thread_id == row.thread_id => *last = row,
      _ => newest.push(row),
    }
  }
  let fits: Vec<Msg> = newest
    .into_iter()
    .filter(|m| {
      !own.contains(&m.from_email) && reply.recipients.contains(&m.from_email) && base_subject(&m.subject) == base
    })
    .collect();
  // The newest message before the reply may be older than the window: that
  // thread then has no row here, and does not fit.
  Ok(if fits.len() == 1 { fits.into_iter().next() } else { None })
}

fn link(direction: &str, m: &Msg) -> Value {
  json!({
    "direction": direction,
    "threadId": m.thread_id,
    "subject": m.subject,
    "fromName": m.from_name,
    "fromEmail": m.from_email,
    "sentAt": m.sent_at,
  })
}

impl MailDb {
  /// The threads linked to this one: the thread a lost reply here answers
  /// ("answers"), and the lost replies elsewhere that answer this thread
  /// ("answeredBy"). `own` is every address of the reader's.
  pub fn messages_answer_links(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let own: HashSet<String> = str_list_arg(args, "own")?.iter().map(|e| e.trim().to_lowercase()).collect();
    let conn = self.conn_mut();
    let sql = format!("SELECT {COLUMNS} FROM messages WHERE account_email = ?1 AND thread_id = ?2 AND {LIVE} ORDER BY sent_at");
    let here = conn
      .prepare(&sql)?
      .query_map(params![account, thread_id], read)?
      .collect::<Result<Vec<_>, _>>()?;
    let (Some(first), Some(last)) = (here.first(), here.last()) else {
      return Ok(json!({ "links": [] }));
    };
    let mut links = Vec::new();
    let mut seen = HashSet::new();

    for reply in &here {
      if !is_lost_reply(&conn, reply, &own)? {
        continue;
      }
      if let Some(m) = answered(&conn, &account, reply, &own)? {
        if seen.insert(m.thread_id.clone()) {
          links.push(link("answers", &m));
        }
      }
    }

    // Lost replies in other threads that answer this one: own mail sent after
    // this thread began and at most the window after its newest message.
    let base = base_subject(&first.subject);
    if !base.is_empty() && !own.is_empty() {
      let marks = std::iter::repeat("?").take(own.len()).collect::<Vec<_>>().join(",");
      let sql = format!(
        "SELECT {COLUMNS} FROM messages
          WHERE account_email = ? AND thread_id <> ? AND sent_at > ? AND sent_at <= ? AND {LIVE}
            AND lower(trim(from_email)) IN ({marks})
          ORDER BY sent_at"
      );
      let (start, end) = (first.sent_at, last.sent_at + WINDOW_MS);
      let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account, &thread_id, &start, &end];
      let own_list: Vec<&String> = own.iter().collect();
      for e in &own_list {
        values.push(*e);
      }
      let replies = conn
        .prepare(&sql)?
        .query_map(values.as_slice(), read)?
        .collect::<Result<Vec<_>, _>>()?;
      for reply in replies {
        if base_subject(&reply.subject) != base || seen.contains(&reply.thread_id) || !is_lost_reply(&conn, &reply, &own)? {
          continue;
        }
        if answered(&conn, &account, &reply, &own)?.is_some_and(|m| m.thread_id == thread_id) {
          seen.insert(reply.thread_id.clone());
          links.push(link("answeredBy", &reply));
        }
      }
    }
    Ok(json!({ "links": links }))
  }
}

#[cfg(test)]
#[path = "answer_links_tests.rs"]
mod tests;
