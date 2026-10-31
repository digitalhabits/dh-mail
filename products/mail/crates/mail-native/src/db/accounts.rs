//! The `accounts.*` operations.

use super::*;

impl MailDb {
  // --- accounts ---------------------------------------------------------

  fn account_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "email": r.get::<_, String>(0)?,
      "ownerId": r.get::<_, String>(1)?,
      "historyId": r.get::<_, Option<String>>(2)?,
      "lastSyncedAt": r.get::<_, Option<String>>(3)?,
      "lastSyncError": r.get::<_, Option<String>>(4)?,
      "inMailTab": r.get::<_, i64>(5)? != 0,
      "ewsUrl": r.get::<_, Option<String>>(6)?,
      "ewsUsername": r.get::<_, Option<String>>(7)?,
    }))
  }

  pub(super) fn accounts_list_for_owner(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT email, owner_id, history_id, last_synced_at, last_sync_error, in_mail_tab, ews_url, ews_username
         FROM accounts WHERE provider = ?1 AND owner_id = ?2
        ORDER BY sort_order, email",
    )?;
    let rows = stmt.query_map(params![provider, owner_id], Self::account_row)?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  /// One record per mailbox across owners. A row with a checkpoint wins, so
  /// sync does not restart when several owners connected the same mailbox.
  pub(super) fn accounts_list_all(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT email, owner_id, history_id, last_synced_at, last_sync_error, in_mail_tab, ews_url, ews_username
         FROM accounts WHERE provider = ?1
        GROUP BY email
        HAVING history_id IS NOT NULL OR MAX(updated_at) = updated_at
        ORDER BY email",
    )?;
    let rows = stmt.query_map(params![provider], Self::account_row)?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  pub(super) fn accounts_list_owned_emails(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let wanted = str_list_arg(args, "emails")?;
    if wanted.is_empty() {
      return Ok(json!([]));
    }
    let conn = self.conn_mut();
    let mut stmt =
      conn.prepare("SELECT email FROM accounts WHERE provider = ?1 AND owner_id = ?2")?;
    let rows = stmt.query_map(params![provider, owner_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
      let email = row?;
      if wanted.contains(&email) {
        out.push(Value::String(email));
      }
    }
    Ok(Value::Array(out))
  }

  pub(super) fn accounts_exists(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let conn = self.conn_mut();
    let n: i64 = conn.query_row(
      "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
      params![provider, email],
      |r| r.get(0),
    )?;
    Ok(json!(n > 0))
  }

  pub(super) fn accounts_set_in_mail_tab(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let email = str_arg(args, "email")?;
    let in_tab = args
      .get("inMailTab")
      .and_then(Value::as_bool)
      .ok_or_else(|| DbError::BadArgument("inMailTab".into()))?;
    let conn = self.conn_mut();
    let n = conn.execute(
      "UPDATE accounts SET in_mail_tab = ?4, updated_at = ?5
        WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
      params![provider, owner_id, email, in_tab as i64, now_ms()],
    )?;
    Ok(json!(n > 0))
  }

  pub(super) fn accounts_set_sort_order(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let emails = str_list_arg(args, "emails")?;
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    for (index, email) in emails.iter().enumerate() {
      tx.execute(
        "UPDATE accounts SET sort_order = ?4, updated_at = ?5
          WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
        params![provider, owner_id, email, index as i64, now_ms()],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  pub(super) fn accounts_remove(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let owner_id = str_arg(args, "ownerId")?;
    let email = str_arg(args, "email")?;
    let conn = self.conn_mut();
    let n = conn.execute(
      "DELETE FROM accounts WHERE provider = ?1 AND owner_id = ?2 AND email = ?3",
      params![provider, owner_id, email],
    )?;
    if n > 0 {
      // The token goes when the last owner does, and not before.
      let left: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
        params![provider, email],
        |r| r.get(0),
      )?;
      drop(conn);
      if left == 0 && !self.listed_elsewhere(&provider, &email) {
        self.remove_secret(&provider, &email)?;
      }
    }
    Ok(json!(n > 0))
  }

  /// Whether another Digital Habits app on this computer still lists the
  /// mailbox.
  ///
  /// The apps keep separate account lists but share one keychain entry per
  /// mailbox, so a mailbox connected in one works in the others. Removing it
  /// from one app must not delete the token the others still use: they
  /// would show the mailbox and fail to read it.
  ///
  /// Read-only, and a database that cannot be read counts as a yes. A
  /// token left behind is less harm than a mailbox broken in another app.
  fn listed_elsewhere(&self, provider: &str, email: &str) -> bool {
    self.siblings.iter().any(|path| {
      let found = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
      )
      .and_then(|conn| {
        conn.busy_timeout(std::time::Duration::from_millis(500))?;
        conn.query_row(
          "SELECT COUNT(*) FROM accounts WHERE provider = ?1 AND email = ?2",
          params![provider, email],
          |r| r.get::<_, i64>(0),
        )
      });
      match found {
        Ok(n) => n > 0,
        Err(err) => {
          log::warn!(
            "[mail] couldn't read {}; keeping the shared token: {err}",
            path.display()
          );
          true
        }
      }
    })
  }

  /// The checkpoint is mailbox state, not owner state, so every row for the
  /// address moves together.
  pub(super) fn accounts_set_sync_state(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    let email = str_arg(args, "email")?;
    let update = args
      .get("update")
      .ok_or_else(|| DbError::BadArgument("update".into()))?;
    let history_id = update.get("historyId").and_then(Value::as_str);
    let error = update.get("error").and_then(Value::as_str);
    let synced_at = if error.is_none() {
      opt_str_arg(args, "now")
    } else {
      None
    };
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE accounts
          SET history_id = COALESCE(?3, history_id),
              last_synced_at = COALESCE(?4, last_synced_at),
              last_sync_error = ?5,
              updated_at = ?6
        WHERE provider = ?1 AND email = ?2",
      params![provider, email, history_id, synced_at, error, now_ms()],
    )?;
    Ok(Value::Null)
  }

  /// Store the mailbox and hand its token to the keychain.
  ///
  /// A fresh token means the old checkpoint no longer applies, so it clears.
  pub(super) fn accounts_save(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    crate::account_exchange::refuse_token_operation(&provider, "accounts.save")?;
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let email = str_arg(input, "email")?;
    let owner_id = str_arg(input, "ownerId")?;
    let token = str_arg(input, "refreshToken")?;
    {
      let conn = self.conn_mut();
      conn.execute(
        "INSERT INTO accounts (provider, email, owner_id, history_id, last_sync_error, updated_at)
         VALUES (?1, ?2, ?3, NULL, NULL, ?4)
         ON CONFLICT(provider, email, owner_id) DO UPDATE SET
           history_id = NULL, last_sync_error = NULL, updated_at = ?4",
        params![provider, email, owner_id, now_ms()],
      )?;
    }
    // The row is worthless without the token, so a keychain refusal reaches the
    // caller rather than leaving a mailbox that silently cannot sign in.
    self.vault.store(&provider, &email, &token)?;
    Ok(Value::Null)
  }

  /// The freshest stored token for a mailbox, with the owner row it came from.
  pub(super) fn accounts_get_token(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    crate::account_exchange::refuse_token_operation(&provider, "accounts.getToken")?;
    let email = str_arg(args, "email")?;
    let owner: Option<String> = {
      let conn = self.conn_mut();
      conn
        .query_row(
          "SELECT owner_id FROM accounts WHERE provider = ?1 AND email = ?2
            ORDER BY updated_at DESC LIMIT 1",
          params![provider, email],
          |r| r.get(0),
        )
        .optional()?
    };
    let Some(owner_id) = owner else {
      return Ok(Value::Null);
    };
    match self.vault.read(&provider, &email)? {
      Some(refresh_token) => Ok(json!({
        "refreshToken": refresh_token,
        "ownerId": owner_id,
      })),
      None => Ok(Value::Null),
    }
  }

  /// Write a rotated token back. Microsoft rotates on refresh.
  pub(super) fn accounts_replace_token(&self, args: &Value) -> DbResult<Value> {
    let provider = str_arg(args, "provider")?;
    crate::account_exchange::refuse_token_operation(&provider, "accounts.replaceToken")?;
    let email = str_arg(args, "email")?;
    let token = str_arg(args, "refreshToken")?;
    self.vault.store(&provider, &email, &token)?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE accounts SET updated_at = ?3 WHERE provider = ?1 AND email = ?2",
      params![provider, email, now_ms()],
    )?;
    Ok(Value::Null)
  }

}
