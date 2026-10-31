//! Reading the local copy: the interface's side.

use super::*;

// ---------------------------------------------------------------------------
// Reading: the interface's side
// ---------------------------------------------------------------------------

/// A view of a mailbox, as the list asks for one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum View {
  Inbox,
  Sent,
  Drafts,
  Starred,
  Trash,
  Junk,
  Archived,
  All,
  Label(String),
}

impl View {
  pub fn parse(view: &str, label: Option<String>) -> DbResult<View> {
    Ok(match view {
      "inbox" => View::Inbox,
      "sent" => View::Sent,
      "drafts" => View::Drafts,
      "starred" => View::Starred,
      "trash" => View::Trash,
      "junk" | "spam" => View::Junk,
      "archived" => View::Archived,
      "all" => View::All,
      "label" => View::Label(
        label
          .filter(|l| !l.trim().is_empty())
          .ok_or_else(|| DbError::BadArgument("label view needs a label".into()))?,
      ),
      other => return Err(DbError::BadArgument(format!("unknown view {other}"))),
    })
  }

  /// The label a message must carry to belong to the view, if one does.
  fn member_label(&self) -> Option<String> {
    match self {
      View::Inbox => Some(INBOX.into()),
      View::Sent => Some(SENT.into()),
      View::Drafts => Some(DRAFT.into()),
      View::Starred => Some(STARRED.into()),
      View::Trash => Some(TRASH.into()),
      View::Junk => Some(SPAM.into()),
      View::Label(l) => Some(l.clone()),
      View::Archived | View::All => None,
    }
  }

  /// Trash and Junk are shown only when asked for by name.
  fn shows_hidden(&self) -> bool {
    matches!(self, View::Trash | View::Junk)
  }
}

/// A thread as the list draws it: its newest message and what the others add.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
  pub account: String,
  pub thread_id: String,
  pub subject: String,
  pub last_at: i64,
  pub message_count: i64,
  pub unread: bool,
  pub has_attachments: bool,
  pub starred: bool,
  pub is_draft: bool,
  pub labels: Vec<String>,
  pub latest: LatestMessage,
  pub participants: Vec<Address>,
  /** Who wrote each visible message, in order. */
  pub senders: Vec<Address>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub focus_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestMessage {
  pub message_id: String,
  pub from_name: String,
  pub from_email: String,
  pub to: Vec<Address>,
  pub snippet: String,
  pub sent_at: i64,
  pub unread: bool,
  pub rfc_message_id: Option<String>,
  pub in_reply_to: Option<String>,
  pub references: Option<String>,
}

const HIDDEN_LABELS: &str = "('TRASH','SPAM')";

impl MailDb {
  /// The threads of a view, newest first, from `before` (exclusive) down.
  pub fn messages_list(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let view = View::parse(
      &opt_str_arg(args, "view").unwrap_or_else(|| "inbox".into()),
      opt_str_arg(args, "label"),
    )?;
    let before = args.get("before").and_then(Value::as_i64).unwrap_or(i64::MAX);
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(50).clamp(1, 500);
    let conn = self.conn_mut();
    let mut rows: Vec<ThreadRow> = Vec::new();
    for account in &accounts {
      let candidates = candidate_threads(&conn, account, &view, before, limit)?;
      let ids: Vec<String> = candidates.iter().map(|(id, _)| id.clone()).collect();
      rows.extend(load_threads(&conn, account, &ids, &view, None)?);
    }
    rows.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    rows.truncate(limit as usize);
    let next_before = if rows.len() as i64 == limit {
      rows.last().map(|r| r.last_at)
    } else {
      None
    };
    Ok(json!({ "threads": rows, "nextBefore": next_before }))
  }

  /// How many threads a view holds, and how many of them are unread.
  pub fn messages_counts(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let view = View::parse(
      &opt_str_arg(args, "view").unwrap_or_else(|| "inbox".into()),
      opt_str_arg(args, "label"),
    )?;
    let conn = self.conn_mut();
    let mut threads = 0i64;
    let mut unread = 0i64;
    // Counted in the database, not by loading every thread: a count on a
    // mailbox of sixty thousand messages read them all, under the lock,
    // for two numbers.
    let (hidden_filter, membership) = view_filters(&view);
    let sql = format!(
      "SELECT COUNT(*), COALESCE(SUM(u), 0) FROM (
         SELECT m.thread_id, MAX(m.unread) AS u FROM messages m
         WHERE m.account_email = ?1 {hidden_filter} {membership}
         GROUP BY m.thread_id)"
    );
    let label = view.member_label().unwrap_or_default();
    for account in &accounts {
      let (t, u): (i64, i64) =
        conn.query_row(&sql, params![account, label], |r| Ok((r.get(0)?, r.get(1)?)))?;
      threads += t;
      unread += u;
    }
    Ok(json!({ "threads": threads, "unread": unread }))
  }

  /// The same conversation in the reader's other mailboxes: every
  /// (mailbox, thread) outside `account` that holds a message with one of
  /// these Message-IDs. Drafts do not count.
  ///
  /// A conversation that reached two mailboxes is one row in the list, and
  /// the thread view read only that row's mailbox. A message only the other
  /// mailbox had, most often the reader's own reply in its Sent folder, was
  /// missing from the conversation (2026-10-19). The view reads these too.
  pub fn messages_copies(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?.to_lowercase();
    let mut ids: Vec<String> = str_list_arg(args, "rfcIds")?
      .into_iter()
      .map(|id| id.trim().to_string())
      .filter(|id| !id.is_empty())
      .collect();
    ids.sort();
    ids.dedup();
    // A long thread asks for a few hundred; SQLite's limit is far above.
    ids.truncate(500);
    if ids.is_empty() {
      return Ok(json!({ "copies": [] }));
    }
    let marks = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!(
      "SELECT DISTINCT account_email, thread_id FROM messages
        WHERE lower(account_email) <> ? AND is_draft = 0 AND rfc_message_id IN ({marks})
        ORDER BY account_email, thread_id"
    );
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&sql)?;
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
    for id in &ids {
      values.push(id);
    }
    let rows = stmt.query_map(values.as_slice(), |r| {
      Ok(json!({ "account": r.get::<_, String>(0)?, "threadId": r.get::<_, String>(1)? }))
    })?;
    let copies = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "copies": copies }))
  }

  /// One thread, every message, bodies where fetched.
  pub fn messages_thread(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn_mut();
    let messages = messages_of_threads(&conn, &account, std::slice::from_ref(&thread_id))?;
    let mut out = Vec::new();
    for m in messages {
      let body: Option<Value> = conn
        .query_row(
          "SELECT text_body, html_body, inline_images_json, attachments_json
             FROM message_bodies WHERE account_email = ?1 AND message_id = ?2",
          params![account, m.row.message_id],
          |r| {
            let inline: String = r.get(2)?;
            let attachments: String = r.get(3)?;
            Ok(json!({
              "text": r.get::<_, Option<String>>(0)?,
              "html": r.get::<_, Option<String>>(1)?,
              "inlineImages": serde_json::from_str::<Value>(&inline).unwrap_or(json!({})),
              "attachments": serde_json::from_str::<Value>(&attachments).unwrap_or(json!([])),
            }))
          },
        )
        .optional()?;
      let mut value = serde_json::to_value(&m.row)?;
      value["body"] = body.unwrap_or(Value::Null);
      out.push(value);
    }
    Ok(json!({ "messages": out }))
  }

  /// Full-text search over the copy. Threads, newest first, each marked with
  /// the message that matched best.
  pub fn messages_search(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    let q = str_arg(args, "q")?;
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(50).clamp(1, 500);
    let include_hidden = args.get("includeDeleted").and_then(Value::as_bool).unwrap_or(false);
    // A paused mailbox's cut-off (ms): mail that came in after it is held
    // back by the pause, from the search as from the list. The reader's own
    // mail is not held back. Searching it again and again for news was what
    // a pause was set to stop (a tester, 2026-10-27).
    let as_of = args.get("asOf").and_then(Value::as_i64);
    // A search inside a folder keeps only threads that belong to it.
    let within = match opt_str_arg(args, "view") {
      Some(view) if view != "all" => Some(View::parse(&view, opt_str_arg(args, "label"))?),
      _ => None,
    };
    let Some(plan) = parse_search(&q) else {
      // The provider's language; the caller asks the provider.
      return Ok(json!({ "threads": [], "handled": false }));
    };
    if plan.is_empty() {
      return Ok(json!({ "threads": [], "handled": true }));
    }
    let conn = self.conn_mut();
    // One statement finds the messages: through the index when there are
    // words, from the table alone when only the filters narrow it.
    let mut sql = String::new();
    let mut binds: Vec<SqlValue> = Vec::new();
    if plan.fts.is_empty() {
      sql.push_str(
        "SELECT 0.0, m.account_email, m.thread_id, m.message_id FROM messages m WHERE 1 = 1",
      );
    } else {
      sql.push_str(
        "SELECT bm25(messages_fts), m.account_email, m.thread_id, m.message_id
           FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH ?",
      );
      binds.push(SqlValue::Text(plan.fts.clone()));
    }
    let marks = std::iter::repeat("?").take(accounts.len()).collect::<Vec<_>>().join(",");
    sql.push_str(&format!(" AND LOWER(m.account_email) IN ({marks})"));
    binds.extend(accounts.iter().map(|a| SqlValue::Text(a.to_lowercase())));
    if let Some(after) = plan.after {
      sql.push_str(" AND m.sent_at >= ?");
      binds.push(SqlValue::Integer(after));
    }
    if let Some(before) = plan.before {
      sql.push_str(" AND m.sent_at < ?");
      binds.push(SqlValue::Integer(before));
    }
    if plan.attachment {
      sql.push_str(" AND m.has_attachments = 1");
    }
    if let Some(cut) = as_of {
      sql.push_str(
        " AND (m.sent_at < ? OR m.is_draft = 1 OR EXISTS (SELECT 1 FROM message_labels l
            WHERE l.account_email = m.account_email AND l.message_id = m.message_id AND l.label = 'SENT'))",
      );
      binds.push(SqlValue::Integer(cut));
    }
    for term in &plan.labels {
      sql.push_str(if term.negated { " AND NOT EXISTS" } else { " AND EXISTS" });
      match term.system {
        Some(system) => {
          sql.push_str(
            " (SELECT 1 FROM message_labels l WHERE l.account_email = m.account_email
                 AND l.message_id = m.message_id AND l.label = ?)",
          );
          binds.push(SqlValue::Text(system.into()));
        }
        None => {
          // Spelled as Gmail's search spells it, on both sides: see label_key.
          sql.push_str(
            " (SELECT 1 FROM message_labels l WHERE l.account_email = m.account_email
                 AND l.message_id = m.message_id
                 AND REPLACE(REPLACE(REPLACE(LOWER(TRIM(l.label)), ' ', '-'), '/', '-'), '_', '-') = ?)",
          );
          binds.push(SqlValue::Text(term.key.clone()));
        }
      }
    }
    if let Some(unread) = plan.unread {
      sql.push_str(" AND m.unread = ?");
      binds.push(SqlValue::Integer(i64::from(unread)));
    }
    for (part, negated) in &plan.filenames {
      sql.push_str(if *negated { " AND NOT EXISTS" } else { " AND EXISTS" });
      sql.push_str(
        " (SELECT 1 FROM message_bodies b, json_each(b.attachments_json) f
            WHERE b.account_email = m.account_email AND b.message_id = m.message_id
              AND INSTR(LOWER(COALESCE(json_extract(f.value, '$.filename'), '')), ?) > 0)",
      );
      binds.push(SqlValue::Text(part.clone()));
    }
    // The newest matches, whether by words or by filters alone: the list is
    // newest first. Cut by relevance, a long new reply that names the
    // sender only in its From line ranked below hundreds of older mails
    // from him and never showed (a tester, 2026-10-05). The relevance still
    // picks which message of a thread is marked. More than the list can
    // hold, because a search inside a folder drops threads after this.
    sql.push_str(" ORDER BY m.sent_at DESC LIMIT 2000");
    let mut stmt = conn.prepare(&sql)?;
    let hits: Vec<(f64, String, String, String)> = stmt
      .query_map(params_from_iter(binds.iter()), |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
      })?
      .collect::<Result<Vec<_>, _>>()?;
    if hits.is_empty() {
      return Ok(json!({ "threads": [], "handled": true }));
    }
    // Best hit per (account, thread).
    let mut best: HashMap<(String, String), (f64, String)> = HashMap::new();
    for (score, account, thread_id, message_id) in hits {
      let entry = best.entry((account, thread_id)).or_insert((f64::MAX, String::new()));
      if score < entry.0 {
        *entry = (score, message_id);
      }
    }
    // `in:trash` and `in:spam` show the rows that are hidden everywhere else.
    let view = match plan.hidden {
      Some(HiddenPlace::Trash) => View::Trash,
      Some(HiddenPlace::Spam) => View::Junk,
      None if include_hidden => View::Trash,
      None => View::All,
    };
    let mut by_account: HashMap<String, Vec<String>> = HashMap::new();
    for ((account, thread_id), _) in &best {
      by_account.entry(account.clone()).or_default().push(thread_id.clone());
    }
    let mut out: Vec<ThreadRow> = Vec::new();
    for (account, ids) in by_account {
      for chunk in ids.chunks(400) {
        let mut rows = load_threads(&conn, &account, chunk, &view, as_of)?;
        for row in rows.iter_mut() {
          if let Some((_, message_id)) = best.get(&(account.clone(), row.thread_id.clone())) {
            row.focus_message_id = Some(message_id.clone());
          }
        }
        out.extend(rows);
      }
    }
    if let Some(view) = &within {
      out.retain(|t| thread_in_view(t, view));
    }
    out.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    out.truncate(limit as usize);
    Ok(json!({ "threads": out, "handled": true }))
  }

  /// Who the mailbox wrote to, newest first, from its sent mail since
  /// `since` (ms). For the contact index; replaces a scan of sent mail.
  ///
  /// Sent mail is mail from the mailbox, mail with the Sent label, or mail
  /// from one of the reader's other addresses (`own`). The last is mail sent
  /// from an alias in another client: its copy lands in this mailbox with no
  /// Sent label, and without `own` nobody written to from there counts.
  pub fn messages_recipients(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let since = args.get("since").and_then(Value::as_i64).unwrap_or(0);
    let mut own: Vec<String> = vec![account.to_lowercase()];
    if let Some(list) = args.get("own").and_then(Value::as_array) {
      for addr in list.iter().filter_map(Value::as_str) {
        let addr = addr.trim().to_lowercase();
        if addr.contains('@') && !own.contains(&addr) {
          own.push(addr);
        }
      }
    }
    let from_own = vec!["?"; own.len()].join(", ");
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(&format!(
      "SELECT m.to_json, m.cc_json, m.sent_at FROM messages m
       WHERE m.account_email = ? AND m.sent_at >= ?
         AND (LOWER(m.from_email) IN ({from_own}) OR EXISTS (
           SELECT 1 FROM message_labels l WHERE l.account_email = m.account_email
             AND l.message_id = m.message_id AND l.label = 'SENT'))
       ORDER BY m.sent_at DESC"
    ))?;
    let mut bind: Vec<SqlValue> = vec![SqlValue::Text(account.clone()), SqlValue::Integer(since)];
    bind.extend(own.iter().cloned().map(SqlValue::Text));
    let rows = stmt.query_map(params_from_iter(bind), |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;
    let mut seen: HashMap<String, (String, i64)> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for row in rows {
      let (to_json, cc_json, at) = row?;
      let to: Vec<Address> = serde_json::from_str(&to_json).unwrap_or_default();
      let cc: Vec<Address> = serde_json::from_str(&cc_json).unwrap_or_default();
      for a in to.into_iter().chain(cc) {
        let key = a.email.trim().to_lowercase();
        if key.is_empty() || !key.contains('@') || own.contains(&key) {
          continue;
        }
        match seen.get_mut(&key) {
          Some(entry) => {
            if entry.0.is_empty() && !a.name.trim().is_empty() {
              entry.0 = a.name.trim().to_string();
            }
          }
          None => {
            seen.insert(key.clone(), (a.name.trim().to_string(), at));
            order.push(key);
          }
        }
      }
    }
    let out: Vec<Value> = order
      .iter()
      .map(|key| {
        let (name, at) = &seen[key];
        json!({ "email": key, "name": name, "lastAt": at })
      })
      .collect();
    Ok(Value::Array(out))
  }

  /// Threads and unread threads per user label, Trash and Junk left out.
  pub fn messages_label_counts(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT l.label, COUNT(DISTINCT m.thread_id),
              COUNT(DISTINCT CASE WHEN m.unread = 1 THEN m.thread_id END)
         FROM message_labels l JOIN messages m
           ON m.account_email = l.account_email AND m.message_id = l.message_id
        WHERE l.account_email = ?1
          AND l.label NOT IN ('INBOX','SENT','DRAFT','TRASH','SPAM','STARRED','IMPORTANT')
          AND NOT EXISTS (SELECT 1 FROM message_labels x WHERE x.account_email = m.account_email
                            AND x.message_id = m.message_id AND x.label IN ('TRASH','SPAM'))
        GROUP BY l.label ORDER BY l.label",
    )?;
    let rows = stmt.query_map(params![account], |r| {
      Ok(json!({ "label": r.get::<_, String>(0)?, "threads": r.get::<_, i64>(1)?, "unread": r.get::<_, i64>(2)? }))
    })?;
    Ok(Value::Array(rows.collect::<Result<Vec<_>, _>>()?))
  }

  /// TypeScript-side writes: the Outlook worker and the tests.
  pub fn messages_upsert_many(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let rows: Vec<MessageRow> = serde_json::from_value(
      args.get("rows").cloned().ok_or_else(|| DbError::BadArgument("rows".into()))?,
    )?;
    let n = self.messages_upsert(&account, &rows)?;
    Ok(json!(n))
  }

  pub fn messages_put_body(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let message_id = str_arg(args, "messageId")?;
    let body: BodyRow = serde_json::from_value(
      args.get("body").cloned().ok_or_else(|| DbError::BadArgument("body".into()))?,
    )?;
    self.bodies_put(&account, &message_id, &body)?;
    Ok(Value::Null)
  }

  /// Every message of a thread read, or the newest unread: the two moves
  /// the interface makes.
  pub fn messages_set_unread(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let unread = args.get("unread").and_then(Value::as_bool).unwrap_or(false);
    let conn = self.conn_mut();
    let changed = if unread {
      conn.execute(
        "UPDATE messages SET unread = 1, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2
           AND sent_at = (SELECT MAX(sent_at) FROM messages m2 WHERE m2.account_email = ?1 AND m2.thread_id = ?2)",
        params![account, thread_id, now_ms()],
      )?
    } else {
      conn.execute(
        "UPDATE messages SET unread = 0, updated_at = ?3 WHERE account_email = ?1 AND thread_id = ?2 AND unread = 1",
        params![account, thread_id, now_ms()],
      )?
    };
    Ok(json!(changed))
  }

  /// These messages, gone, with their labels and bodies. For a provider
  /// whose delta says a message left.
  /// Rows by message id, gone. With `leftFolder`, only the rows the copy still
  /// has in that folder.
  ///
  /// `leftFolder` is for a provider that reports a move in two halves, as
  /// Graph does: the folder a message left says "gone", and the folder it
  /// went to says "here". The halves come in no fixed order, and the first
  /// can come long after the second. Applied as it stood, a late "gone" from
  /// the inbox deleted the row that Deleted Items had already delivered, or
  /// that the reader's own action had already relabelled, and the mail was
  /// then in no folder of the copy until the mailbox was read again.
  ///
  /// So the report is believed only about its own folder. `leftFolder` is the
  /// label that folder gives its rows: a row that wears it goes, and a row
  /// that wears another folder's label has moved on and stays. `""` is a
  /// folder whose rows wear no label, which is Outlook's Archive: there a row
  /// goes only if it wears no folder label. `STARRED` and `DRAFT` are marks
  /// on a message and not folders, so they do not count either way, except
  /// when `DRAFT` is the folder asked about.
  pub fn messages_remove_messages(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let ids = str_list_arg(args, "messageIds")?;
    let left_folder = args.get("leftFolder").and_then(Value::as_str).map(str::to_string);
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    let mut removed = 0;
    for id in ids {
      let found: Option<i64> = tx
        .query_row(
          "SELECT rowid FROM messages WHERE account_email = ?1 AND message_id = ?2",
          params![account, id],
          |r| r.get(0),
        )
        .optional()?;
      let Some(rowid) = found else { continue };
      if let Some(left) = &left_folder {
        let labels: Vec<String> = {
          let mut stmt = tx.prepare("SELECT label FROM message_labels WHERE account_email = ?1 AND message_id = ?2")?;
          let rows = stmt.query_map(params![account, id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
          rows
        };
        let still_there = if left.is_empty() {
          !labels.iter().any(|l| l != STARRED && l != DRAFT)
        } else {
          labels.iter().any(|l| l == left)
        };
        if !still_there {
          continue;
        }
      }
      delete_one(&tx, &account, rowid, &id)?;
      removed += 1;
    }
    tx.commit()?;
    Ok(json!(removed))
  }

  pub fn messages_remove_account(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    self.messages_clear_account(&account, false)?;
    Ok(Value::Null)
  }

  pub fn sync_list(&self) -> DbResult<Value> {
    Ok(serde_json::to_value(self.sync_state_list()?)?)
  }

  pub fn sync_set(&self, args: &Value) -> DbResult<Value> {
    let state: SyncState = serde_json::from_value(
      args.get("state").cloned().ok_or_else(|| DbError::BadArgument("state".into()))?,
    )?;
    self.sync_state_set(&state)?;
    Ok(Value::Null)
  }
}

/// Thread ids of a view with the time of their newest visible message,
/// newest first, older than `before`.
/// The WHERE clauses that make a message row count for a view: the
/// hidden-label filter and the thread-membership filter, as SQL text
/// with `?1` the account and `?2` the view's label.
fn view_filters(view: &View) -> (String, String) {
  let hidden_filter = if view.shows_hidden() {
    String::new()
  } else {
    format!(
      "AND NOT EXISTS (SELECT 1 FROM message_labels x WHERE x.account_email = m.account_email
         AND x.message_id = m.message_id AND x.label IN {HIDDEN_LABELS})"
    )
  };
  let membership = match view {
    View::Archived => format!(
      "AND m.thread_id NOT IN (SELECT m2.thread_id FROM messages m2 JOIN message_labels l
           ON l.account_email = m2.account_email AND l.message_id = m2.message_id
         WHERE m2.account_email = ?1 AND l.label IN ('INBOX','DRAFT'))
       AND m.thread_id IN (SELECT m3.thread_id FROM messages m3 WHERE m3.account_email = ?1
         AND NOT EXISTS (SELECT 1 FROM message_labels y WHERE y.account_email = m3.account_email
           AND y.message_id = m3.message_id AND y.label IN ('SENT','DRAFT','TRASH','SPAM')))"
    ),
    View::All => String::new(),
    _ => "AND m.thread_id IN (SELECT m2.thread_id FROM messages m2 JOIN message_labels l
           ON l.account_email = m2.account_email AND l.message_id = m2.message_id
         WHERE m2.account_email = ?1 AND l.label = ?2)"
      .to_string(),
  };
  (hidden_filter, membership)
}

fn candidate_threads(
  conn: &Connection,
  account: &str,
  view: &View,
  before: i64,
  limit: i64,
) -> DbResult<Vec<(String, i64)>> {
  let (hidden_filter, membership) = view_filters(view);
  let sql = format!(
    "SELECT m.thread_id, MAX(m.sent_at) AS last_at FROM messages m
     WHERE m.account_email = ?1 {hidden_filter} {membership}
     GROUP BY m.thread_id HAVING last_at < ?3 ORDER BY last_at DESC, m.thread_id DESC LIMIT ?4"
  );
  let label = view.member_label().unwrap_or_default();
  let mut stmt = conn.prepare(&sql)?;
  let rows = stmt.query_map(params![account, label, before, limit], |r| {
    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
  })?;
  Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn messages_of_threads(
  conn: &Connection,
  account: &str,
  thread_ids: &[String],
) -> DbResult<Vec<StoredMessage>> {
  if thread_ids.is_empty() {
    return Ok(Vec::new());
  }
  let marks = std::iter::repeat("?").take(thread_ids.len()).collect::<Vec<_>>().join(",");
  let sql = format!(
    "SELECT m.rowid, m.message_id, m.thread_id, m.uid, m.modseq, m.rfc_message_id, m.in_reply_to,
       m.ref_headers, m.from_name, m.from_email, m.to_json, m.cc_json, m.bcc_json, m.subject,
       m.snippet, m.sent_at, m.size_estimate, m.has_attachments, m.unread, m.starred, m.is_draft,
       m.folder,
       (SELECT group_concat(label, char(31)) FROM message_labels l
          WHERE l.account_email = m.account_email AND l.message_id = m.message_id) AS labels
     FROM messages m WHERE m.account_email = ? AND m.thread_id IN ({marks})
     ORDER BY m.thread_id, m.sent_at ASC"
  );
  let mut stmt = conn.prepare(&sql)?;
  let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
  for id in thread_ids {
    values.push(id);
  }
  let rows = stmt.query_map(values.as_slice(), |r| {
    let labels: Option<String> = r.get(22)?;
    Ok(StoredMessage {
      row: MessageRow {
        message_id: r.get(1)?,
        thread_id: r.get(2)?,
        folder: r.get(21)?,
        uid: r.get(3)?,
        modseq: r.get(4)?,
        rfc_message_id: r.get(5)?,
        in_reply_to: r.get(6)?,
        references: r.get(7)?,
        from_name: r.get(8)?,
        from_email: r.get(9)?,
        to: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default(),
        cc: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default(),
        bcc: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
        subject: r.get(13)?,
        snippet: r.get(14)?,
        sent_at: r.get(15)?,
        size_estimate: r.get(16)?,
        has_attachments: r.get::<_, i64>(17)? != 0,
        unread: r.get::<_, i64>(18)? != 0,
        starred: r.get::<_, i64>(19)? != 0,
        is_draft: r.get::<_, i64>(20)? != 0,
        labels: labels
          .map(|s| s.split('\u{1f}').map(str::to_string).collect())
          .unwrap_or_default(),
      },
    })
  })?;
  Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The rows the list draws for these threads, in no particular order.
/// Whether a message counts before a pause's cut-off: sent before it, or
/// sent by the reader (Sent, or a draft). A pause holds back the mail that
/// comes in, not the reader's own.
fn before_cut_off(m: &StoredMessage, as_of: Option<i64>) -> bool {
  match as_of {
    None => true,
    Some(cut) => m.row.sent_at < cut || m.row.labels.iter().any(|l| l == SENT || l == DRAFT),
  }
}

/// `as_of`: a paused mailbox's cut-off. The rows are made from the messages
/// before it only, so a row's date, snippet and unread dot say nothing of
/// mail the pause holds back.
pub(super) fn load_threads(
  conn: &Connection,
  account: &str,
  thread_ids: &[String],
  view: &View,
  as_of: Option<i64>,
) -> DbResult<Vec<ThreadRow>> {
  let messages = messages_of_threads(conn, account, thread_ids)?;
  let mut by_thread: HashMap<String, Vec<StoredMessage>> = HashMap::new();
  for m in messages {
    by_thread.entry(m.row.thread_id.clone()).or_default().push(m);
  }
  let hidden_ok = view.shows_hidden();
  let only_label = if hidden_ok { view.member_label() } else { None };
  let mut out = Vec::new();
  for (thread_id, list) in by_thread {
    let visible: Vec<&StoredMessage> = list
      .iter()
      .filter(|m| before_cut_off(m, as_of))
      .filter(|m| {
        let hidden = m.row.labels.iter().any(|l| l == TRASH || l == SPAM);
        if let Some(only) = &only_label {
          m.row.labels.iter().any(|l| l == only)
        } else {
          !hidden
        }
      })
      .collect();
    let Some(latest) = visible.last() else {
      continue;
    };
    let mut participants: Vec<Address> = Vec::new();
    let senders: Vec<Address> = visible
      .iter()
      .map(|m| Address { name: m.row.from_name.clone(), email: m.row.from_email.clone() })
      .collect();
    let mut seen = HashSet::new();
    let mut labels: Vec<String> = Vec::new();
    let mut label_seen = HashSet::new();
    for m in &visible {
      let mut push = |a: &Address| {
        let key = a.email.trim().to_lowercase();
        if key.is_empty() || !seen.insert(key) {
          return;
        }
        participants.push(Address { name: a.name.clone(), email: a.email.clone() });
      };
      push(&Address { name: m.row.from_name.clone(), email: m.row.from_email.clone() });
      for a in &m.row.to {
        push(a);
      }
      for a in &m.row.cc {
        push(a);
      }
      for l in &m.row.labels {
        if label_seen.insert(l.clone()) {
          labels.push(l.clone());
        }
      }
    }
    let subject = visible
      .iter()
      .rev()
      .map(|m| m.row.subject.trim())
      .find(|s| !s.is_empty())
      .unwrap_or("")
      .to_string();
    out.push(ThreadRow {
      account: account.to_string(),
      thread_id,
      subject,
      last_at: latest.row.sent_at,
      message_count: visible.len() as i64,
      unread: visible.iter().any(|m| m.row.unread),
      has_attachments: visible.iter().any(|m| m.row.has_attachments),
      starred: visible.iter().any(|m| m.row.starred),
      is_draft: latest.row.is_draft,
      labels,
      latest: LatestMessage {
        message_id: latest.row.message_id.clone(),
        from_name: latest.row.from_name.clone(),
        from_email: latest.row.from_email.clone(),
        to: latest.row.to.clone(),
        snippet: latest.row.snippet.clone(),
        sent_at: latest.row.sent_at,
        unread: latest.row.unread,
        rfc_message_id: latest.row.rfc_message_id.clone(),
        in_reply_to: latest.row.in_reply_to.clone(),
        references: latest.row.references.clone(),
      },
      participants,
      senders,
      focus_message_id: None,
    });
  }
  Ok(out)
}

/// Whether a thread the search found belongs to the view searched in.
fn thread_in_view(t: &ThreadRow, view: &View) -> bool {
  let has = |l: &str| t.labels.iter().any(|x| x == l);
  match view {
    View::Inbox => has(INBOX),
    View::Sent => has(SENT),
    View::Drafts => has(DRAFT),
    View::Starred => has(STARRED),
    View::Trash => has(TRASH),
    View::Junk => has(SPAM),
    View::Archived => !has(INBOX) && !has(DRAFT),
    View::All => true,
    View::Label(l) => has(l),
  }
}
