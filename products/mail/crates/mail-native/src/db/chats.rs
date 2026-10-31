//! The `chats.*` operations: conversations and their parts.

use super::*;

impl MailDb {
  // --- conversations ----------------------------------------------------

  /// Columns every binding read returns, joined across the three tables.
  const BINDING_SQL: &'static str = "
    SELECT c.id, c.title, p.part_index, p.subject, p.status, c.rotate_at,
           p.message_count, c.participant_emails, c.no_quote,
           (SELECT COUNT(*) FROM chat_parts p2 WHERE p2.chat_id = c.id),
           b.account_email, b.provider_thread_id
      FROM chat_part_bindings b
      JOIN chat_parts p ON p.id = b.part_id
      JOIN chats c ON c.id = p.chat_id";

  fn binding_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Value)> {
    let participants: String = r.get(7)?;
    let key = format!("{}|{}", r.get::<_, String>(10)?, r.get::<_, String>(11)?);
    Ok((
      key,
      json!({
        "chatId": r.get::<_, String>(0)?,
        "title": r.get::<_, String>(1)?,
        "partIndex": r.get::<_, i64>(2)?,
        "subject": r.get::<_, String>(3)?,
        "partStatus": r.get::<_, String>(4)?,
        "rotateAt": r.get::<_, i64>(5)?,
        "messageCount": r.get::<_, i64>(6)?,
        "participantEmails": serde_json::from_str::<Value>(&participants).unwrap_or(json!([])),
        "noQuote": r.get::<_, i64>(8)? != 0,
        "partCount": r.get::<_, i64>(9)?,
      }),
    ))
  }

  pub(super) fn chats_find_binding(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let thread_id = str_arg(args, "threadId")?;
    let conn = self.conn_mut();
    let sql = format!(
      "{} WHERE b.account_email = ?1 AND b.provider_thread_id = ?2 LIMIT 1",
      Self::BINDING_SQL
    );
    let found = conn
      .query_row(&sql, params![account, thread_id], Self::binding_row)
      .optional()?;
    Ok(found.map(|(_, v)| v).unwrap_or(Value::Null))
  }

  pub(super) fn chats_find_bindings(&self, args: &Value) -> DbResult<Value> {
    let keys = args
      .get("keys")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("keys".into()))?;
    let wanted: Vec<String> = keys
      .iter()
      .filter_map(|k| {
        let a = k.get("account").and_then(Value::as_str)?;
        let t = k.get("threadId").and_then(Value::as_str)?;
        Some(format!("{a}|{t}"))
      })
      .collect();
    if wanted.is_empty() {
      return Ok(json!({}));
    }
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(Self::BINDING_SQL)?;
    let rows = stmt.query_map([], Self::binding_row)?;
    let mut out = serde_json::Map::new();
    for row in rows {
      let (key, value) = row?;
      if wanted.contains(&key) {
        out.insert(key, value);
      }
    }
    Ok(Value::Object(out))
  }

  /// The conversation, its first part, and the binding must land together.
  /// A half-created conversation has no open part, and every send then fails.
  pub(super) fn chats_create(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let chat_id = str_arg(input, "chatId")?;
    let part_id = str_arg(input, "partId")?;
    let now = opt_str_arg(args, "now");
    let participants = input
      .get("participantEmails")
      .cloned()
      .unwrap_or(json!([]))
      .to_string();
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    tx.execute(
      "INSERT INTO chats (id, title, created_by_account, participant_fingerprint,
                          participant_emails, status, rotate_at, no_quote, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)",
      params![
        chat_id,
        str_arg(input, "title")?,
        str_arg(input, "createdByAccount")?,
        str_arg(input, "participantFingerprint")?,
        participants,
        input.get("rotateAt").and_then(Value::as_i64).unwrap_or(1000),
        input.get("noQuote").and_then(Value::as_bool).unwrap_or(false) as i64,
        now_ms()
      ],
    )?;
    tx.execute(
      "INSERT INTO chat_parts (id, chat_id, part_index, subject, status, message_count, opened_at)
       VALUES (?1, ?2, 1, ?3, 'open', ?4, ?5)",
      params![
        part_id,
        chat_id,
        str_arg(input, "subject")?,
        input.get("messageCount").and_then(Value::as_i64).unwrap_or(0),
        now
      ],
    )?;
    tx.execute(
      "INSERT INTO chat_part_bindings (part_id, account_email, provider, provider_thread_id)
       VALUES (?1, ?2, ?3, ?4)",
      params![
        part_id,
        str_arg(input, "createdByAccount")?,
        str_arg(input, "provider")?,
        str_arg(input, "threadId")?
      ],
    )?;
    tx.commit()?;
    Ok(Value::Null)
  }

  pub(super) fn chats_set_no_quote(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let no_quote = args
      .get("noQuote")
      .and_then(Value::as_bool)
      .ok_or_else(|| DbError::BadArgument("noQuote".into()))?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE chats SET no_quote = ?2, updated_at = ?3 WHERE id = ?1",
      params![chat_id, no_quote as i64, now_ms()],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn chats_find_open_part(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn_mut();
    let found = conn
      .query_row(
        "SELECT id, part_index, subject, message_count FROM chat_parts
          WHERE chat_id = ?1 AND status = 'open' ORDER BY part_index DESC LIMIT 1",
        params![chat_id],
        |r| {
          Ok(json!({
            "partId": r.get::<_, String>(0)?,
            "partIndex": r.get::<_, i64>(1)?,
            "subject": r.get::<_, String>(2)?,
            "messageCount": r.get::<_, i64>(3)?,
          }))
        },
      )
      .optional()?;
    Ok(found.unwrap_or(Value::Null))
  }

  pub(super) fn chats_find_part_thread(&self, args: &Value) -> DbResult<Value> {
    let part_id = str_arg(args, "partId")?;
    let account = str_arg(args, "account")?;
    let conn = self.conn_mut();
    let found: Option<String> = conn
      .query_row(
        "SELECT provider_thread_id FROM chat_part_bindings
          WHERE part_id = ?1 AND account_email = ?2",
        params![part_id, account],
        |r| r.get(0),
      )
      .optional()?;
    Ok(found.map(Value::String).unwrap_or(Value::Null))
  }

  /// Close the current part and open the next. Both must land together.
  pub(super) fn chats_rotate_part(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    tx.execute(
      "UPDATE chat_parts SET status = 'closed', closed_at = ?2 WHERE id = ?1",
      params![str_arg(input, "closePartId")?, now],
    )?;
    tx.execute(
      "INSERT INTO chat_parts (id, chat_id, part_index, subject, status, message_count, opened_at)
       VALUES (?1, ?2, ?3, ?4, 'open', 0, ?5)",
      params![
        str_arg(input, "nextPartId")?,
        str_arg(input, "chatId")?,
        input.get("nextIndex").and_then(Value::as_i64).unwrap_or(0),
        str_arg(input, "nextSubject")?,
        now
      ],
    )?;
    tx.execute(
      "UPDATE chats SET updated_at = ?2 WHERE id = ?1",
      params![str_arg(input, "chatId")?, now_ms()],
    )?;
    tx.commit()?;
    Ok(Value::Null)
  }

  pub(super) fn chats_add_message(&self, args: &Value) -> DbResult<Value> {
    let part_id = str_arg(args, "partId")?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE chat_parts SET message_count = message_count + 1 WHERE id = ?1",
      params![part_id],
    )?;
    Ok(Value::Null)
  }

  /// Set a part's count to what the provider's thread holds.
  ///
  /// `chats_add_message` counts our sends and nobody else's, so a part where
  /// the other person writes too undercounts until a read corrects it here.
  /// An unbound thread updates nothing, and that is the right answer.
  pub(super) fn chats_reconcile_count(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let count = input
      .get("messageCount")
      .and_then(Value::as_i64)
      .ok_or_else(|| DbError::BadArgument("messageCount".into()))?
      .max(0);
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE chat_parts SET message_count = ?3
        WHERE id = (SELECT part_id FROM chat_part_bindings
                     WHERE account_email = ?1 AND provider_thread_id = ?2)
          AND message_count <> ?3",
      params![str_arg(input, "account")?, str_arg(input, "threadId")?, count],
    )?;
    Ok(Value::Null)
  }

  /// Remember which RFC Message-IDs a bound thread holds.
  pub(super) fn chats_remember_message_ids(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let account = str_arg(input, "account")?;
    let thread_id = str_arg(input, "threadId")?;
    let ids: Vec<String> = input
      .get("messageIds")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("messageIds".into()))?
      .iter()
      .filter_map(|v| v.as_str())
      .filter(|v| !v.is_empty())
      .map(str::to_owned)
      .collect();
    let conn = self.conn_mut();
    // The binding names the part. An unbound thread remembers nothing.
    let Some((chat_id, part_id)) = conn
      .query_row(
        "SELECT p.chat_id, p.id FROM chat_part_bindings b
           JOIN chat_parts p ON p.id = b.part_id
          WHERE b.account_email = ?1 AND b.provider_thread_id = ?2",
        params![account, thread_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
      )
      .optional()?
    else {
      return Ok(Value::Null);
    };
    for id in ids {
      conn.execute(
        "INSERT OR IGNORE INTO chat_message_ids
           (account_email, rfc_message_id, chat_id, part_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![account, id, chat_id, part_id],
      )?;
    }
    Ok(Value::Null)
  }

  /// The conversation that holds any of these Message-IDs, or null.
  pub(super) fn chats_find_by_message_ids(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let ids: Vec<String> = args
      .get("messageIds")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("messageIds".into()))?
      .iter()
      .filter_map(|v| v.as_str())
      .filter(|v| !v.is_empty())
      .map(str::to_owned)
      .collect();
    let conn = self.conn_mut();
    for id in ids {
      let hit = conn
        .query_row(
          "SELECT c.id, c.title, c.participant_emails, c.no_quote
             FROM chat_message_ids m JOIN chats c ON c.id = m.chat_id
            WHERE m.account_email = ?1 AND m.rfc_message_id = ?2",
          params![account, id],
          |r| {
            Ok((
              r.get::<_, String>(0)?,
              r.get::<_, String>(1)?,
              r.get::<_, String>(2)?,
              r.get::<_, i64>(3)?,
            ))
          },
        )
        .optional()?;
      if let Some((chat_id, title, participants, no_quote)) = hit {
        let emails: Value =
          serde_json::from_str(&participants).unwrap_or_else(|_| json!([]));
        return Ok(json!({
          "chatId": chat_id,
          "title": title,
          "participantEmails": emails,
          "noQuote": no_quote != 0,
        }));
      }
    }
    Ok(Value::Null)
  }

  pub(super) fn chats_bind_thread(&self, args: &Value) -> DbResult<Value> {
    let input = args
      .get("input")
      .ok_or_else(|| DbError::BadArgument("input".into()))?;
    let tip = opt_str_arg(input, "tipMessageId");
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO chat_part_bindings
         (part_id, account_email, provider, provider_thread_id, provider_tip_message_id)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_email, provider_thread_id) DO UPDATE SET
         provider_tip_message_id =
           COALESCE(?5, chat_part_bindings.provider_tip_message_id),
         part_id = ?1",
      params![
        str_arg(input, "partId")?,
        str_arg(input, "account")?,
        str_arg(input, "provider")?,
        str_arg(input, "threadId")?,
        tip
      ],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn chats_touch(&self, args: &Value) -> DbResult<Value> {
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE chats SET updated_at = ?2 WHERE id = ?1",
      params![chat_id, now_ms()],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn chats_list_parts(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let chat_id = str_arg(args, "chatId")?;
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT p.part_index, p.subject, p.status, b.provider_thread_id,
              p.opened_at, p.closed_at, p.message_count
         FROM chat_parts p
         JOIN chat_part_bindings b ON b.part_id = p.id AND b.account_email = ?1
        WHERE p.chat_id = ?2
        ORDER BY p.part_index ASC",
    )?;
    let rows = stmt.query_map(params![account, chat_id], |r| {
      Ok(json!({
        "partIndex": r.get::<_, i64>(0)?,
        "subject": r.get::<_, String>(1)?,
        "status": r.get::<_, String>(2)?,
        "providerThreadId": r.get::<_, String>(3)?,
        "openedAt": r.get::<_, Option<String>>(4)?,
        "closedAt": r.get::<_, Option<String>>(5)?,
        "messageCount": r.get::<_, i64>(6)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

}
