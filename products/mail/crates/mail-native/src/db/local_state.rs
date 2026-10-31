//! The `settings.*`, `listSync.*` and `snoozes.*` operations.

use super::*;

impl MailDb {
  // --- settings ---------------------------------------------------------

  pub(super) fn settings_get(&self, args: &Value) -> DbResult<Value> {
    let key = str_arg(args, "key")?;
    let conn = self.conn_mut();
    let value: Option<String> = conn
      .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
        r.get(0)
      })
      .optional()?;
    Ok(value.map(Value::String).unwrap_or(Value::Null))
  }

  pub(super) fn settings_set(&self, args: &Value) -> DbResult<Value> {
    let key = str_arg(args, "key")?;
    let value = str_arg(args, "value")?;
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
      params![key, value, now_ms()],
    )?;
    Ok(Value::Null)
  }

  // --- list sync --------------------------------------------------------

  pub(super) fn list_sync_load(&self, args: &Value) -> DbResult<Value> {
    let owner_id = str_arg(args, "ownerId")?;
    let folder = str_arg(args, "folder")?;
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!({}));
    }
    // Gmail drops history ids after about a week, so an old page is unusable.
    let cutoff = now_ms() - 2 * 24 * 60 * 60 * 1000;
    let conn = self.conn_mut();
    let mut out = serde_json::Map::new();
    let mut stmt = conn.prepare(
      "SELECT account_email, history_id, next_page_token, rows
         FROM list_sync_state
        WHERE owner_id = ?1 AND folder = ?2 AND updated_at > ?3",
    )?;
    let rows = stmt.query_map(params![owner_id, folder, cutoff], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, Option<String>>(1)?,
        r.get::<_, Option<String>>(2)?,
        r.get::<_, String>(3)?,
      ))
    })?;
    for row in rows {
      let (account, history_id, next_page_token, rows_json) = row?;
      if !accounts.contains(&account) {
        continue;
      }
      // Stored as empty means empty, not missing — see `list_sync_save`.
      // Only rows we cannot read at all are passed over.
      let Ok(parsed) = serde_json::from_str::<Value>(&rows_json) else {
        continue;
      };
      if !parsed.is_array() {
        continue;
      }
      out.insert(
        account,
        json!({
          "rows": parsed,
          "historyId": history_id,
          "nextPageToken": next_page_token,
        }),
      );
    }
    Ok(Value::Object(out))
  }

  pub(super) fn list_sync_save(&self, args: &Value) -> DbResult<Value> {
    let owner_id = str_arg(args, "ownerId")?;
    let folder = str_arg(args, "folder")?;
    let account = str_arg(args, "account")?;
    let entry = args
      .get("entry")
      .ok_or_else(|| DbError::BadArgument("entry".into()))?;
    /*
      An empty page is a page, and inbox zero is how it looks.

      This returned early on an empty list, so the last row of a mailbox
      could never be taken out of the stored page: deleting the one mail
      in an inbox filtered the rows to none, the save did nothing, and
      the page still held the mail that had just been trashed. Quitting
      and reopening served that stored page, and the mail was back —
      with the provider having deleted it perfectly well.

      A call carrying no rows at all is still refused. That is a
      malformed call, not an empty mailbox.
    */
    let rows = entry
      .get("rows")
      .filter(|value| value.is_array())
      .cloned()
      .ok_or_else(|| DbError::BadArgument("entry.rows".into()))?;
    let history_id = entry.get("historyId").and_then(Value::as_str);
    let next_page_token = entry.get("nextPageToken").and_then(Value::as_str);
    let conn = self.conn_mut();
    // COALESCE keeps the stored position when this poll learned nothing new.
    conn.execute(
      "INSERT INTO list_sync_state
         (owner_id, folder, account_email, history_id, next_page_token, rows,
          rows_fingerprint, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)
       ON CONFLICT(owner_id, folder, account_email) DO UPDATE SET
         history_id = COALESCE(?4, list_sync_state.history_id),
         next_page_token = ?5,
         rows = ?6,
         updated_at = ?7",
      params![
        owner_id,
        folder,
        account,
        history_id,
        next_page_token,
        rows.to_string(),
        now_ms()
      ],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn list_sync_clear(&self) -> DbResult<Value> {
    let conn = self.conn_mut();
    conn.execute("DELETE FROM list_sync_state", [])?;
    Ok(Value::Null)
  }

  // --- snoozes ----------------------------------------------------------

  pub(super) fn snoozes_list_active(&self, args: &Value) -> DbResult<Value> {
    let limit = args.get("limit").and_then(Value::as_i64).unwrap_or(0);
    let now = current_iso(args)?;
    let conn = self.conn_mut();
    let sql = String::from(
      "SELECT account_email, thread_id, snoozed_until, tip_message_id
         FROM snoozes WHERE snoozed_until > ?1 ORDER BY snoozed_until ASC",
    );
    let sql = if limit > 0 {
      format!("{sql} LIMIT {limit}")
    } else {
      sql
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![now], |r| {
      Ok(json!({
        "accountEmail": r.get::<_, String>(0)?,
        "threadId": r.get::<_, String>(1)?,
        "snoozedUntil": r.get::<_, String>(2)?,
        "tipMessageId": r.get::<_, Option<String>>(3)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  pub(super) fn snoozes_count_active(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!(0));
    }
    let now = current_iso(args)?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT account_email FROM snoozes WHERE snoozed_until > ?1",
    )?;
    let rows = stmt.query_map(params![now], |r| r.get::<_, String>(0))?;
    let mut n = 0i64;
    for row in rows {
      if accounts.contains(&row?) {
        n += 1;
      }
    }
    Ok(json!(n))
  }

  pub(super) fn snoozes_set(&self, args: &Value) -> DbResult<Value> {
    let record = args
      .get("record")
      .ok_or_else(|| DbError::BadArgument("record".into()))?;
    let account = str_arg(record, "accountEmail")?;
    let thread_id = str_arg(record, "threadId")?;
    let until = str_arg(record, "snoozedUntil")?;
    let tip = opt_str_arg(record, "tipMessageId");
    let conn = self.conn_mut();
    // A null tip keeps the stored one.
    conn.execute(
      "INSERT INTO snoozes
         (account_email, thread_id, snoozed_until, tip_message_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_email, thread_id) DO UPDATE SET
         snoozed_until = ?3,
         tip_message_id = COALESCE(?4, snoozes.tip_message_id),
         created_at = ?5",
      params![account, thread_id, until, tip, now_ms()],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn snoozes_remove(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "accountEmail")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn_mut();
    conn.execute(
      "DELETE FROM snoozes WHERE account_email = ?1 AND thread_id = ?2",
      params![account, thread_id],
    )?;
    Ok(Value::Null)
  }
}

/// "Now" for wake-time comparisons, as an ISO-8601 string.
///
/// Postgres compares against its own clock. This host has no server, so the
/// caller passes its clock in. There is deliberately no fallback: wake times
/// are stored as text and compared as text, so a second format here would make
/// every comparison wrong in a way that looks like it works.
fn current_iso(args: &Value) -> DbResult<String> {
  opt_str_arg(args, "now").ok_or_else(|| DbError::BadArgument("now".into()))
}
