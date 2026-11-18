//! A mail the reader forwarded, and the forward.
//!
//! A forward is a new message to new people, and every provider files it as
//! a thread of its own. So the mail it was made from says nothing of it:
//! the reader cannot see that they sent it on, to whom, or when
//! (2026-11-17). This finds the forwards of a thread, so the thread can say
//! so and open them. It joins nothing, as answer_links.rs joins nothing.
//!
//! A forward that this app sends from a Gmail or Outlook mailbox names no
//! message in its headers, and the Outlook and Exchange copies keep no such
//! headers at all. (From an Exchange mailbox it does name the mail, so that
//! the server files it with that mail: `forwardLinkHeaders` in
//! forwarded-message.ts. Such a forward is then in the thread itself, as a
//! message of it, and needs no mark.) So a forward is found by what it is:
//!
//! - it is the reader's own sent mail, in another thread of the same mailbox;
//! - its subject begins with a forward mark ("Fwd:", "FW:", "VS:", …) and is
//!   the thread's subject once the marks are taken off;
//! - it was sent after the thread began.
//!
//! Two threads with the same subject cannot both be the one that was
//! forwarded. Then none is marked, unless the forward names a message of
//! this thread in its headers (a forward that another mail app made in a
//! Gmail mailbox does). A wrong mark is only a wrong mark: nothing acts on it.

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::answer_links::{base_subject, named_ids};
use crate::db::{str_arg, DbResult, MailDb};

/// The marks a mail app puts before the subject of a forward.
const FORWARD_MARKS: &[&str] = &["fw", "fwd", "vs", "wg", "tr", "rv"];
const LIVE: &str = "is_draft = 0 AND folder NOT IN ('trash', 'spam')";

/// Does the subject begin with a forward mark? "Fwd: Re: x" does, "Re: Fwd: x" does not.
pub fn begins_as_forward(subject: &str) -> bool {
  let lower = subject.trim().to_lowercase();
  let Some(colon) = lower.find(':') else { return false };
  FORWARD_MARKS.contains(&lower[..colon].trim())
}

/// One forward of a thread.
#[derive(Debug, Clone)]
pub struct Forward {
  pub thread_id: String,
  pub message_id: String,
  /// The forward's own subject, for the title of the window it opens in.
  pub subject: String,
  pub sent_at: i64,
  /// The To list, as the store keeps it: `[{ name, email }]`.
  pub to: Value,
}

/// The longest run of plain letters, digits and spaces in a base subject, for
/// a first cut in SQL (`LIKE` folds only these). None when it is too short
/// to cut anything.
fn plain_run(base: &str) -> Option<String> {
  let mut best = "";
  let mut start = None;
  for (i, c) in base.char_indices().chain(std::iter::once((base.len(), '\u{0}'))) {
    let plain = c.is_ascii_alphanumeric() || c == ' ';
    match (plain, start) {
      (true, None) => start = Some(i),
      (false, Some(s)) => {
        if base[s..i].trim().len() > best.len() {
          best = base[s..i].trim();
        }
        start = None;
      }
      _ => {}
    }
  }
  (best.len() >= 4).then(|| best.to_string())
}

/// The forwards of a thread, newest first. Empty when there is none, when
/// the thread is itself a forward the reader sent, or when another thread
/// has the same subject and no header settles which one was forwarded.
pub fn forwards_of(conn: &Connection, account: &str, thread_id: &str) -> DbResult<Vec<Forward>> {
  let sql = format!(
    "SELECT subject, sent_at, COALESCE(rfc_message_id, ''),
            EXISTS (SELECT 1 FROM message_labels l WHERE l.account_email = m.account_email AND l.message_id = m.message_id AND l.label = 'SENT')
     FROM messages m WHERE account_email = ?1 AND thread_id = ?2 AND {LIVE} ORDER BY sent_at"
  );
  let here: Vec<(String, i64, String, bool)> = conn
    .prepare_cached(&sql)?
    .query_map(params![account, thread_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
    .collect::<Result<_, _>>()?;
  let Some((first_subject, began, _, first_is_ours)) = here.first().cloned() else {
    return Ok(Vec::new());
  };
  // A forward the reader sent is not a mail they then forwarded.
  if first_is_ours && begins_as_forward(&first_subject) {
    return Ok(Vec::new());
  }
  let base = base_subject(&first_subject);
  if base.is_empty() {
    return Ok(Vec::new());
  }
  let cut = plain_run(&base).map(|run| format!("%{run}%")).unwrap_or_else(|| "%".into());

  let sql = format!(
    "SELECT m.thread_id, m.message_id, m.subject, m.sent_at, m.to_json, COALESCE(m.in_reply_to, ''), COALESCE(m.ref_headers, '')
     FROM messages m
     JOIN message_labels l ON l.account_email = m.account_email AND l.message_id = m.message_id AND l.label = 'SENT'
     WHERE m.account_email = ?1 AND m.thread_id != ?2 AND m.sent_at >= ?3 AND m.subject LIKE ?4 AND m.{LIVE}
     ORDER BY m.sent_at DESC"
  );
  let sent: Vec<(Forward, String, String, String)> = conn
    .prepare_cached(&sql.replace("m.is_draft = 0 AND folder", "m.is_draft = 0 AND m.folder"))?
    .query_map(params![account, thread_id, began, cut], |r| {
      Ok((
        Forward {
          thread_id: r.get(0)?,
          message_id: r.get(1)?,
          subject: r.get(2)?,
          sent_at: r.get(3)?,
          to: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_else(|_| json!([])),
        },
        r.get::<_, String>(2)?,
        r.get::<_, String>(5)?,
        r.get::<_, String>(6)?,
      ))
    })?
    .collect::<Result<_, _>>()?;
  let ids_here: HashSet<&str> = here.iter().map(|m| m.2.as_str()).filter(|id| !id.is_empty()).collect();
  let mut forwards = Vec::new();
  let mut named = false;
  for (forward, subject, in_reply_to, references) in sent {
    if !begins_as_forward(&subject) || base_subject(&subject) != base {
      continue;
    }
    if named_ids(&in_reply_to, &references).iter().any(|id| ids_here.contains(id.as_str())) {
      named = true;
    }
    forwards.push(forward);
  }
  if forwards.is_empty() || named {
    return Ok(forwards);
  }

  // Is this the only thread the forward can be of? Another thread with the
  // same subject, begun before the newest forward, makes it a guess.
  let newest = forwards.iter().map(|f| f.sent_at).max().unwrap_or(began);
  let forward_threads: HashSet<&str> = forwards.iter().map(|f| f.thread_id.as_str()).collect();
  let sql = format!(
    "SELECT thread_id, subject FROM messages
     WHERE account_email = ?1 AND thread_id != ?2 AND sent_at <= ?3 AND subject LIKE ?4 AND {LIVE}"
  );
  let others: Vec<(String, String)> = conn
    .prepare_cached(&sql)?
    .query_map(params![account, thread_id, newest, cut], |r| Ok((r.get(0)?, r.get(1)?)))?
    .collect::<Result<_, _>>()?;
  let same_subject_elsewhere = others
    .iter()
    .any(|(other, subject)| !forward_threads.contains(other.as_str()) && base_subject(subject) == base);
  Ok(if same_subject_elsewhere { Vec::new() } else { forwards })
}

/// When each of these threads was last forwarded: `thread_id` → time, for the
/// threads that were. One cheap question first, so a page of threads costs
/// one query when the mailbox has sent no forward with any of their subjects.
pub fn forwarded_times(
  conn: &Connection,
  account: &str,
  threads: &[(String, String)],
) -> DbResult<std::collections::HashMap<String, i64>> {
  let mut out = std::collections::HashMap::new();
  if threads.is_empty() {
    return Ok(out);
  }
  let sql = format!(
    "SELECT m.subject FROM messages m
     JOIN message_labels l ON l.account_email = m.account_email AND l.message_id = m.message_id AND l.label = 'SENT'
     WHERE m.account_email = ?1 AND m.is_draft = 0 AND m.folder NOT IN ('trash', 'spam')
       AND ({})",
    FORWARD_MARKS.iter().map(|mark| format!("m.subject LIKE '{mark}:%' OR m.subject LIKE '{mark} :%'")).collect::<Vec<_>>().join(" OR ")
  );
  let bases: HashSet<String> = conn
    .prepare_cached(&sql)?
    .query_map(params![account], |r| r.get::<_, String>(0))?
    .collect::<Result<Vec<_>, _>>()?
    .iter()
    .filter(|subject| begins_as_forward(subject))
    .map(|subject| base_subject(subject))
    .collect();
  if bases.is_empty() {
    return Ok(out);
  }
  for (thread_id, subject) in threads {
    if !bases.contains(&base_subject(subject)) {
      continue;
    }
    if let Some(newest) = forwards_of(conn, account, thread_id)?.first() {
      out.insert(thread_id.clone(), newest.sent_at);
    }
  }
  Ok(out)
}

/*
  A reply under a new subject.

  The reader answers a mail and changes the subject. That reply is a new
  conversation, to the provider and to this app, so the mail it answers
  says nothing of it, as with a forward (2026-11-17). Its subject is new,
  so it cannot be found by its subject, and the Outlook and Exchange copies
  keep no reply headers. So the page writes the link down when it sends
  such a reply: which thread it answers, from which mailbox, under which
  subject, to whom. The sent copy is then found by that subject, in that
  mailbox, sent within a quarter of an hour of the note.

  Only a reply sent from this app is known this way.
*/
pub const REPLY_LINKS_SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS reply_links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email TEXT NOT NULL,
    thread_id     TEXT NOT NULL,
    from_account  TEXT NOT NULL,
    subject       TEXT NOT NULL,
    to_json       TEXT NOT NULL DEFAULT '[]',
    noted_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reply_links_thread_idx ON reply_links (account_email, thread_id);
"#;

/// How long after the note the sent copy may be dated, and how long before:
/// a clock that is a little off, an Undo wait, a slow server.
const SENT_AFTER_NOTE_MS: i64 = 15 * 60 * 1000;
const SENT_BEFORE_NOTE_MS: i64 = 2 * 60 * 1000;

/// The replies under a new subject that answer this thread, newest first, as
/// the links the page reads. `threadId` is there once the sent copy is in.
fn replies_apart(conn: &Connection, account: &str, thread_id: &str) -> DbResult<Vec<Value>> {
  let notes: Vec<(String, String, String, i64)> = conn
    .prepare_cached(
      "SELECT from_account, subject, to_json, noted_at FROM reply_links
       WHERE account_email = ?1 AND thread_id = ?2 ORDER BY noted_at DESC",
    )?
    .query_map(params![account, thread_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
    .collect::<Result<_, _>>()?;
  let mut out = Vec::new();
  for (from_account, subject, to_json, noted_at) in notes {
    let sent: Option<(String, String, i64)> = conn
      .prepare_cached(
        "SELECT m.thread_id, m.message_id, m.sent_at FROM messages m
         JOIN message_labels l ON l.account_email = m.account_email AND l.message_id = m.message_id AND l.label = 'SENT'
         WHERE m.account_email = ?1 AND m.subject = ?2 AND m.sent_at BETWEEN ?3 AND ?4
           AND m.is_draft = 0 AND m.folder NOT IN ('trash', 'spam')
         ORDER BY ABS(m.sent_at - ?5) LIMIT 1",
      )?
      .query_row(
        params![from_account, subject, noted_at - SENT_BEFORE_NOTE_MS, noted_at + SENT_AFTER_NOTE_MS, noted_at],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
      )
      .ok();
    let to: Value = serde_json::from_str(&to_json).unwrap_or_else(|_| json!([]));
    out.push(match sent {
      Some((thread, message, sent_at)) => json!({
        "kind": "reply", "account": from_account, "threadId": thread, "messageId": message,
        "subject": subject, "sentAt": sent_at, "to": to,
      }),
      None => json!({ "kind": "reply", "account": from_account, "subject": subject, "sentAt": noted_at, "to": to }),
    });
  }
  Ok(out)
}

/// When the reader last answered each of these threads under a new subject:
/// `thread_id` → time of the note. For the arrow of a list row.
pub fn replied_apart_times(
  conn: &Connection,
  account: &str,
  thread_ids: &[String],
) -> DbResult<std::collections::HashMap<String, i64>> {
  let mut out = std::collections::HashMap::new();
  if thread_ids.is_empty() {
    return Ok(out);
  }
  let wanted: HashSet<&str> = thread_ids.iter().map(String::as_str).collect();
  let mut stmt =
    conn.prepare_cached("SELECT thread_id, MAX(noted_at) FROM reply_links WHERE account_email = ?1 GROUP BY thread_id")?;
  let rows = stmt.query_map(params![account], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
  for row in rows {
    let (thread_id, at) = row?;
    if wanted.contains(thread_id.as_str()) {
      out.insert(thread_id, at);
    }
  }
  Ok(out)
}

impl MailDb {
  /// What the reader sent on from a thread, newest first: its forwards, and
  /// the replies under a new subject. `{ links: [{ kind, threadId?, … }] }`.
  pub fn messages_forward_links(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn_mut();
    let mut links: Vec<Value> = forwards_of(&conn, &account, &thread_id)?
      .into_iter()
      .map(|f| {
        json!({
          "kind": "forward", "account": account, "threadId": f.thread_id, "messageId": f.message_id,
          "subject": f.subject, "sentAt": f.sent_at, "to": f.to,
        })
      })
      .collect();
    links.extend(replies_apart(&conn, &account, &thread_id)?);
    links.sort_by_key(|link| std::cmp::Reverse(link["sentAt"].as_i64().unwrap_or(0)));
    Ok(json!({ "links": links }))
  }

  /// The page sent a reply under a new subject: keep which thread it answers.
  /// `{ account, threadId, fromAccount, subject, to: [{ name, email }], at? }`.
  pub fn messages_note_reply_apart(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let from_account = str_arg(args, "fromAccount")?;
    let subject = str_arg(args, "subject")?;
    let to = args.get("to").cloned().unwrap_or_else(|| json!([]));
    let at = args.get("at").and_then(Value::as_i64).unwrap_or_else(crate::db::now_ms);
    self.conn_mut().execute(
      "INSERT INTO reply_links (account_email, thread_id, from_account, subject, to_json, noted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![account, thread_id, from_account, subject.trim(), to.to_string(), at],
    )?;
    Ok(json!({ "ok": true }))
  }
}

#[cfg(test)]
#[path = "forward_links_tests.rs"]
mod tests;
