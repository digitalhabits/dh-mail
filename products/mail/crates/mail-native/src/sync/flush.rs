//! The outbox: send each message whose time has come, over SMTP.

use super::*;

/// Every message in the outbox whose time has come, over SMTP. Returns how
/// many went. A connection that fails is tried again next pass; a refusal
/// gives the message back to the reader with the server's words.
pub(super) fn flush_outbox(app: &AppHandle, db: &MailDb, email: &str) -> usize {
  let now = crate::db::now_ms();
  let due = match db.outbox_due(email, now) {
    Ok(rows) => rows,
    Err(e) => {
      log::warn!("[mail-sync] {email}: could not read the outbox: {e}");
      return 0;
    }
  };
  if due.is_empty() {
    return 0;
  }
  let credential = match credential(app, email) {
    Ok(c) => c,
    Err(_) => return 0,
  };
  let mut smtp = match Smtp::connect(SMTP_HOST, SMTP_PORT, CONNECT_TIMEOUT)
    .and_then(|mut s| s.sign_in(email, &credential).map(|_| s))
  {
    Ok(s) => s,
    Err(e) => {
      log::warn!("[mail-sync] {email}: could not reach the mail server to send: {}", e.for_log());
      if e.is_auth() {
        forget_token(app, email);
        set_paused(app, email, "needs reconnect: the mail server refused the grant");
      }
      return 0;
    }
  };
  let mut sent = 0;
  for (row, raw) in due {
    /*
      Taken before it is sent, and only by one.

      Two workers can be looking at one store: a second copy of the app,
      or the same copy started again over a first that is still running.
      Both then found this row due, opened a connection of their own, and
      sent it — and the message went twice, to everybody on it. The claim
      is the one write they cannot both win.
    */
    match db.outbox_claim(row.id, crate::db::now_ms()) {
      Ok(true) => {}
      Ok(false) => {
        log::info!("[mail-sync] {email}: outbox message {} is already being sent by another worker; leaving it", row.id);
        continue;
      }
      Err(e) => {
        log::warn!("[mail-sync] {email}: could not take the message on: {e}");
        continue;
      }
    }
    match smtp.send(email, &row.recipients, raw.as_bytes()) {
      Ok(_) => {
        db.outbox_record_sent(row.id).unwrap_or_else(|e| log::error!("[mail-sync] outbox message {} went out, but the store did not record it: {e}", row.id));
        sent += 1;
        // The draft it was written from goes now, not when the send was
        // queued: a message refused for good used to take its only copy
        // with it.
        if let Some(draft) = &row.draft_message_id {
          let thread = row.thread_id.clone().unwrap_or_default();
          if let Err(e) = db.actions_apply(email, &thread, "discardDraft", &json!({ "messageId": draft }), true) {
            log::warn!("[mail-sync] {email}: could not discard the sent draft: {e}");
          }
        }
        // By the outbox row, never the subject or the addresses: the log is a
        // file on disk, and no one's mail belongs in it (CASA, 2026-10-19).
        log::info!("[mail-sync] {email}: sent outbox message {} to {} recipient(s)", row.id, row.recipients.len());
        let _ = app.emit(SENT_EVENT, json!({ "account": email, "id": row.id, "threadId": row.thread_id }));
      }
      Err(e) => {
        let permanent = e.is_permanent();
        log::warn!("[mail-sync] {email}: send of outbox message {} failed: {}", row.id, e.for_log());
        match db.outbox_failed(row.id, &e.to_string(), permanent) {
          Ok(true) => {
            let _ = app.emit(
              SEND_FAILED_EVENT,
              json!({ "account": email, "id": row.id, "subject": row.subject, "error": e.to_string() }),
            );
          }
          Ok(false) => {}
          Err(err) => log::warn!("[mail-sync] {email}: could not record a failed send: {err}"),
        }
        if matches!(e, SmtpError::Io(_) | SmtpError::Protocol(_) | SmtpError::Unconfirmed(_)) {
          break; // the connection is gone; the rest wait for the next pass
        }
      }
    }
  }
  smtp.quit();
  sent
}
