//! Who answers a thread in a shared mailbox, and whether somebody did.
//!
//! A mailbox that a team reads together holds two kinds of mark, both as
//! Gmail labels, so every copy of the mailbox reads the same marks after its
//! next sync:
//!
//! - `Assigned/<name>` on the messages of a thread: that person answers it.
//!   A message that comes in later does not carry the label. The thread
//!   counts as assigned when any of its messages carries one.
//! - `Answered` on the messages of a thread, put there by hand. It counts
//!   only while it is on the newest message from outside the team. When the
//!   sender writes again, the new message does not carry it, and the thread
//!   is open again.
//!
//! The team often answers from another address, with the shared mailbox in
//! CC. That copy comes back here, but not always in the same thread: a new
//! subject, or a reply to a copy that a forwarding rule made, gives it a
//! thread of its own. So a thread is answered by the first of these that
//! holds, after the newest message from outside the team:
//!
//! 1. `reply`: a message from the team in the same thread.
//! 2. `marked`: the `Answered` label, as above.
//! 3. `linked`: a message from the team in another thread whose In-Reply-To
//!    or References names a message of this thread. The subject does not
//!    matter.
//! 4. `matched`: a message from the team that names a message no mailbox
//!    here has (the forwarded copy), sent to the last sender at most 14 days
//!    later, when exactly one open thread fits it. A thread with the same
//!    subject fits first. When none has the same subject, a thread with any
//!    subject fits, but again only when it is the only one. Two that fit
//!    match neither, and the thread stays open.
//!
//! Nothing here writes. The labels are put on and taken off with the
//! "label" and "unlabel" actions (actions.rs).

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::answer_links::{base_subject, emails, named_ids};
use crate::db::{opt_str_arg, str_arg, str_list_arg, DbResult, MailDb};

/// How much later than the message it answers a matched reply may be.
const WINDOW_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const LIVE: &str = "is_draft = 0 AND folder NOT IN ('trash', 'spam')";
const COLUMNS: &str = "message_id, thread_id, from_name, from_email, subject, sent_at,
  COALESCE(rfc_message_id, ''), COALESCE(in_reply_to, ''), COALESCE(ref_headers, ''), to_json, cc_json";

pub const ASSIGNED_PREFIX: &str = "Assigned/";
pub const ANSWERED_LABEL: &str = "Answered";

#[derive(Debug, Clone)]
struct Msg {
  message_id: String,
  thread_id: String,
  from_name: String,
  from_email: String,
  subject: String,
  sent_at: i64,
  rfc_id: String,
  named: Vec<String>,
  recipients: Vec<String>,
}

fn read(r: &rusqlite::Row) -> rusqlite::Result<Msg> {
  let mut recipients = emails(&r.get::<_, String>(9)?);
  recipients.extend(emails(&r.get::<_, String>(10)?));
  let in_reply_to: String = r.get(7)?;
  let references: String = r.get(8)?;
  Ok(Msg {
    message_id: r.get(0)?,
    thread_id: r.get(1)?,
    from_name: r.get(2)?,
    from_email: r.get::<_, String>(3)?.trim().to_lowercase(),
    subject: r.get(4)?,
    sent_at: r.get(5)?,
    rfc_id: r.get::<_, String>(6)?.trim().to_string(),
    named: named_ids(&in_reply_to, &references),
    recipients,
  })
}

fn answer(how: &str, m: &Msg) -> Value {
  json!({
    "how": how,
    "threadId": m.thread_id,
    "fromName": m.from_name,
    "fromEmail": m.from_email,
    "sentAt": m.sent_at,
  })
}

/// The labels of each message of a thread.
fn labels_by_message(conn: &Connection, account: &str, thread_id: &str) -> DbResult<HashMap<String, Vec<String>>> {
  let mut stmt = conn.prepare_cached(
    "SELECT l.message_id, l.label FROM message_labels l
       JOIN messages m ON m.account_email = l.account_email AND m.message_id = l.message_id
      WHERE l.account_email = ?1 AND m.thread_id = ?2",
  )?;
  let mut out: HashMap<String, Vec<String>> = HashMap::new();
  for row in stmt.query_map(params![account, thread_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
    let (id, label) = row?;
    out.entry(id).or_default().push(label);
  }
  Ok(out)
}

/// A team message that names only messages no mailbox here has.
fn is_lost(conn: &Connection, m: &Msg) -> DbResult<bool> {
  if m.named.is_empty() {
    return Ok(false);
  }
  let mut stmt = conn.prepare_cached("SELECT 1 FROM messages WHERE rfc_message_id = ?1 LIMIT 1")?;
  for id in &m.named {
    if stmt.exists(params![id])? {
      return Ok(false);
    }
  }
  Ok(true)
}

/// The one open thread a lost team reply answers, by its recipients and its
/// time. None when no thread fits, or more than one does.
fn matched_thread(conn: &Connection, account: &str, reply: &Msg, team: &HashSet<String>) -> DbResult<Option<String>> {
  let sql = format!(
    "SELECT {COLUMNS} FROM messages
      WHERE account_email = ?1 AND thread_id <> ?2 AND sent_at < ?3 AND sent_at >= ?4 AND {LIVE}
      ORDER BY thread_id, sent_at"
  );
  let rows = conn
    .prepare_cached(&sql)?
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
  let fits: Vec<&Msg> = newest
    .iter()
    .filter(|m| !team.contains(&m.from_email) && reply.recipients.contains(&m.from_email))
    .collect();
  let base = base_subject(&reply.subject);
  let same: Vec<&&Msg> = fits.iter().filter(|m| !base.is_empty() && base_subject(&m.subject) == base).collect();
  let pick = match (same.len(), fits.len()) {
    (1, _) => Some(same[0].thread_id.clone()),
    (0, 1) => Some(fits[0].thread_id.clone()),
    _ => None,
  };
  Ok(pick)
}

impl MailDb {
  /// `messages.teamStates`: for each of `threadIds` in `account`, who is
  /// assigned and whether the team answered. `team` is every address of the
  /// team, the shared mailbox's own included.
  pub fn messages_team_states(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_ids = str_list_arg(args, "threadIds")?;
    let team: HashSet<String> = str_list_arg(args, "team")?.iter().map(|e| e.trim().to_lowercase()).collect();
    let prefix = opt_str_arg(args, "assignedPrefix").unwrap_or_else(|| ASSIGNED_PREFIX.to_string());
    let answered_label = opt_str_arg(args, "answeredLabel").unwrap_or_else(|| ANSWERED_LABEL.to_string());
    let conn = self.conn_mut();

    struct Open {
      thread_id: String,
      last_in: Msg,
      rfc_ids: HashSet<String>,
    }
    let mut states: Vec<Value> = Vec::new();
    let mut open: Vec<Open> = Vec::new();
    let thread_sql = format!("SELECT {COLUMNS} FROM messages WHERE account_email = ?1 AND thread_id = ?2 AND {LIVE} ORDER BY sent_at");
    for thread_id in &thread_ids {
      let here = conn
        .prepare_cached(&thread_sql)?
        .query_map(params![account, thread_id], read)?
        .collect::<Result<Vec<_>, _>>()?;
      if here.is_empty() {
        continue;
      }
      let labels = labels_by_message(&conn, &account, thread_id)?;
      let mut assigned: Vec<String> = labels
        .values()
        .flatten()
        .filter_map(|l| l.strip_prefix(prefix.as_str()))
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
      assigned.sort();
      assigned.dedup();
      let mut state = json!({ "threadId": thread_id, "assigned": assigned });
      let Some(last_in) = here.iter().rev().find(|m| !team.contains(&m.from_email)) else {
        // Only the team wrote here: there is nothing to answer.
        state["state"] = json!("none");
        states.push(state);
        continue;
      };
      state["lastInboundAt"] = json!(last_in.sent_at);
      if let Some(reply) = here.iter().find(|m| m.sent_at > last_in.sent_at && team.contains(&m.from_email)) {
        state["state"] = json!("answered");
        state["answeredBy"] = answer("reply", reply);
      } else if labels.get(&last_in.message_id).is_some_and(|l| l.iter().any(|l| *l == answered_label)) {
        state["state"] = json!("answered");
        state["answeredBy"] = json!({ "how": "marked" });
      } else {
        state["state"] = json!("open");
        open.push(Open {
          thread_id: thread_id.clone(),
          last_in: last_in.clone(),
          rfc_ids: here.iter().map(|m| m.rfc_id.clone()).filter(|id| !id.is_empty()).collect(),
        });
      }
      states.push(state);
    }

    // Team mail in other threads, sent after the oldest open question.
    if let Some(since) = open.iter().map(|o| o.last_in.sent_at).min() {
      if !team.is_empty() {
        let marks = std::iter::repeat("?").take(team.len()).collect::<Vec<_>>().join(",");
        let sql = format!(
          "SELECT {COLUMNS} FROM messages
            WHERE account_email = ? AND sent_at > ? AND {LIVE} AND lower(trim(from_email)) IN ({marks})
            ORDER BY sent_at"
        );
        let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account, &since];
        let team_list: Vec<&String> = team.iter().collect();
        for e in &team_list {
          values.push(*e);
        }
        let replies = conn.prepare(&sql)?.query_map(values.as_slice(), read)?.collect::<Result<Vec<_>, _>>()?;
        let mut matched: HashMap<String, Option<String>> = HashMap::new();
        for o in &open {
          let later = replies.iter().filter(|r| r.thread_id != o.thread_id && r.sent_at > o.last_in.sent_at);
          let mut found: Option<(&str, &Msg)> = None;
          for r in later {
            if r.named.iter().any(|id| o.rfc_ids.contains(id)) {
              found = Some(("linked", r));
              break;
            }
            if r.sent_at - o.last_in.sent_at > WINDOW_MS || !r.recipients.contains(&o.last_in.from_email) {
              continue;
            }
            if !matched.contains_key(&r.message_id) {
              let pick = if is_lost(&conn, r)? { matched_thread(&conn, &account, r, &team)? } else { None };
              matched.insert(r.message_id.clone(), pick);
            }
            if matched.get(&r.message_id).and_then(|p| p.as_deref()) == Some(o.thread_id.as_str()) {
              found = Some(("matched", r));
              break;
            }
          }
          if let Some((how, r)) = found {
            if let Some(state) = states.iter_mut().find(|s| s["threadId"] == json!(o.thread_id)) {
              state["state"] = json!("answered");
              state["answeredBy"] = answer(how, r);
            }
          }
        }
      }
    }
    Ok(json!({ "states": states }))
  }
}

#[cfg(test)]
#[path = "team_mailbox_tests.rs"]
mod tests;
