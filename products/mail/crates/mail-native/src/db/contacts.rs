//! The `sources.*` operations and the known contacts.

use super::*;

impl MailDb {
  // --- contact sources --------------------------------------------------

  pub(super) fn sources_list_state(&self) -> DbResult<Value> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT source, account, synced_at, item_count, last_error FROM contact_source_state",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok(json!({
        "source": r.get::<_, String>(0)?,
        "account": r.get::<_, String>(1)?,
        "syncedAt": r.get::<_, Option<String>>(2)?,
        "itemCount": r.get::<_, i64>(3)?,
        "lastError": r.get::<_, Option<String>>(4)?,
      }))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(Value::Array(out))
  }

  pub(super) fn sources_save_state(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let update = args
      .get("update")
      .ok_or_else(|| DbError::BadArgument("update".into()))?;
    let count = update.get("count").and_then(Value::as_i64);
    let error = update.get("error").and_then(Value::as_str);
    let synced = update.get("synced").and_then(Value::as_bool).unwrap_or(false);
    let synced_at = if synced { opt_str_arg(args, "now") } else { None };
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO contact_source_state (source, account, synced_at, item_count, last_error)
       VALUES (?1, ?2, ?3, COALESCE(?4, 0), ?5)
       ON CONFLICT(source, account) DO UPDATE SET
         synced_at = COALESCE(?3, contact_source_state.synced_at),
         item_count = COALESCE(?4, contact_source_state.item_count),
         last_error = ?5",
      params![source, account, synced_at, count, error],
    )?;
    Ok(Value::Null)
  }

  pub(super) fn sources_clear_error(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE contact_source_state SET last_error = NULL WHERE source = ?1 AND account = ?2",
      params![source, account],
    )?;
    Ok(Value::Null)
  }

  /// Replace an address book whole. A reader must never see the gap.
  pub(super) fn sources_replace_contacts(&self, args: &Value) -> DbResult<Value> {
    let source = str_arg(args, "source")?;
    let account = str_arg(args, "account")?;
    let contacts = args
      .get("contacts")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("contacts".into()))?
      .clone();
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    tx.execute(
      "DELETE FROM source_contacts WHERE source = ?1 AND account = ?2",
      params![source, account],
    )?;
    for contact in &contacts {
      let email = contact.get("email").and_then(Value::as_str).unwrap_or("");
      if email.is_empty() {
        continue;
      }
      let name = contact.get("name").and_then(Value::as_str).unwrap_or("");
      let card = contact.get("card").and_then(Value::as_str).filter(|c| !c.is_empty());
      tx.execute(
        "INSERT INTO source_contacts (source, account, email, name, synced_at, card)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source, account, email)
         DO UPDATE SET name = ?4, synced_at = ?5, card = ?6",
        params![source, account, email, name, now, card],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  /// A stored name wins over an empty one, and the latest send time wins.
  pub(super) fn sources_merge_history(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let contacts = args
      .get("contacts")
      .and_then(Value::as_array)
      .ok_or_else(|| DbError::BadArgument("contacts".into()))?
      .clone();
    let now = opt_str_arg(args, "now");
    let mut conn = self.conn_mut();
    let tx = conn.transaction()?;
    for contact in &contacts {
      let email = contact.get("email").and_then(Value::as_str).unwrap_or("");
      if email.is_empty() {
        continue;
      }
      let name = contact.get("name").and_then(Value::as_str).unwrap_or("");
      let last = contact.get("lastEmailedAt").and_then(Value::as_str);
      tx.execute(
        "INSERT INTO source_contacts
           (source, account, email, name, last_emailed_at, synced_at)
         VALUES ('history', ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source, account, email) DO UPDATE SET
           name = CASE WHEN source_contacts.name = '' THEN ?3 ELSE source_contacts.name END,
           last_emailed_at = CASE
             WHEN ?4 IS NULL THEN source_contacts.last_emailed_at
             WHEN source_contacts.last_emailed_at IS NULL THEN ?4
             WHEN ?4 > source_contacts.last_emailed_at THEN ?4
             ELSE source_contacts.last_emailed_at END,
           synced_at = ?5",
        params![account, email, name, last, now],
      )?;
    }
    tx.commit()?;
    Ok(Value::Null)
  }

  pub(super) fn sources_count_history(&self, args: &Value) -> DbResult<Value> {
    let account = str_arg(args, "account")?;
    let conn = self.conn_mut();
    let n: i64 = conn.query_row(
      "SELECT COUNT(*) FROM source_contacts
        WHERE source = 'history' AND account = ?1 AND hidden = 0",
      params![account],
      |r| r.get(0),
    )?;
    Ok(json!(n))
  }

  /// Address books before history, so the caller keeps the first row it sees.
  pub(super) fn sources_list_visible(&self, args: &Value) -> DbResult<Value> {
    let accounts = str_list_arg(args, "accounts")?;
    if accounts.is_empty() {
      return Ok(json!([]));
    }
    let conn = self.conn_mut();
    // 'mac' sorts first: the book the reader keeps by hand, so its spelling of
    // a name wins over one a provider saved automatically.
    let mut stmt = conn.prepare(
      "SELECT source, account, email, name, last_emailed_at, card
         FROM source_contacts WHERE hidden = 0
        ORDER BY CASE source WHEN 'mac' THEN 0 WHEN 'google' THEN 1
                             WHEN 'outlook' THEN 2 ELSE 3 END",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?,
        r.get::<_, Option<String>>(5)?,
      ))
    })?;
    let mut out = Vec::new();
    for row in rows {
      let (source, account, email, name, last, card) = row?;
      // The Mac book belongs to the machine and carries no account, so the
      // mailbox filter would drop every row of it.
      if source != "mac" && !accounts.iter().any(|a| a.eq_ignore_ascii_case(&account)) {
        continue;
      }
      out.push(json!({
        "source": source, "account": account, "email": email,
        "name": name, "lastEmailedAt": last, "card": card,
      }));
    }
    Ok(Value::Array(out))
  }

  /// The contacts Mail knows, for another app's pickers: a name and an
  /// address each, once per address.
  ///
  /// Not a store operation. Another app's window may not call
  /// `mail_store_call`, which reaches the whole mailbox; it gets this one
  /// read instead, through its own command. The rows are those the compose field suggests: the Mac
  /// book, and the address books and sent history of the mailboxes still
  /// connected. Hidden history rows stay hidden. An address met twice keeps
  /// the first name found (Mac, Google, Outlook, history, as in
  /// `sources_list_visible`) and its latest send time.
  pub fn known_contacts(&self) -> DbResult<Value> {
    let conn = self.conn_mut();
    let mut stmt = conn.prepare(
      "SELECT sc.email, sc.name, sc.last_emailed_at
         FROM source_contacts sc
        WHERE sc.hidden = 0
          AND (sc.source = 'mac'
               OR EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(sc.account)))
        ORDER BY CASE sc.source WHEN 'mac' THEN 0 WHEN 'google' THEN 1
                                WHEN 'outlook' THEN 2 ELSE 3 END",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, Option<String>>(2)?,
      ))
    })?;
    let mut order: Vec<String> = Vec::new();
    let mut by_email: std::collections::HashMap<String, (String, String, Option<String>)> =
      std::collections::HashMap::new();
    for row in rows {
      let (email, name, last) = row?;
      let key = email.trim().to_lowercase();
      if key.is_empty() {
        continue;
      }
      match by_email.get_mut(&key) {
        Some(entry) => {
          if entry.1.trim().is_empty() && !name.trim().is_empty() {
            entry.1 = name;
          }
          if last.is_some() && (entry.2.is_none() || last > entry.2) {
            entry.2 = last;
          }
        }
        None => {
          order.push(key.clone());
          by_email.insert(key, (email.trim().to_string(), name, last));
        }
      }
    }
    let out = order
      .into_iter()
      .filter_map(|key| by_email.remove(&key))
      .map(|(email, name, last)| {
        json!({ "email": email, "name": name.trim(), "lastEmailedAt": last })
      })
      .collect();
    Ok(Value::Array(out))
  }

  pub(super) fn sources_hide_history(&self, args: &Value) -> DbResult<Value> {
    let email = str_arg(args, "email")?;
    let conn = self.conn_mut();
    conn.execute(
      "UPDATE source_contacts SET hidden = 1 WHERE source = 'history' AND email = ?1",
      params![email],
    )?;
    Ok(Value::Null)
  }

}
