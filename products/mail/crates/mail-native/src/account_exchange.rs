//! Exchange (EWS) account rows in the store.
//!
//! An Exchange account has a row in `accounts` with the provider `exchange`,
//! like a Gmail or an Outlook account. Two columns hold what the interface
//! shows and what the password form fills in: `ews_url` and `ews_username`.
//! They are empty for the other providers.
//!
//! The keychain item `exchange:<email>` has the same name that the token
//! vault would use for this provider. It holds the password, and only the EWS
//! code (`ews.rs`) reads or writes it. So the token operations of the store
//! (`accounts.save`, `accounts.getToken`, `accounts.replaceToken`) refuse the
//! provider `exchange`: without that, the interface could read the password
//! as a "refresh token", or write a token over it. `accounts.remove` removes
//! the password through the EWS code, with the remover that `setup_store`
//! gives the store.
//!
//! Not behind the `exchange` feature: the columns and the refusals cost
//! nothing, and a public build must refuse the provider too.

use rusqlite::{params, Connection};

use crate::db::{now_ms, DbError, DbResult, MailDb};

/// The provider name of an Exchange account.
pub const EXCHANGE: &str = "exchange";

/// Removes the password of an Exchange account. Set by the host when the
/// `exchange` feature is on.
pub type ExchangeRemover = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Add the two columns to a store made before they existed. SQLite has no
/// "add if missing", so the duplicate-column error is the one to swallow.
pub fn migrate(conn: &Connection) {
  let _ = conn.execute("ALTER TABLE accounts ADD COLUMN ews_url TEXT", []);
  let _ = conn.execute("ALTER TABLE accounts ADD COLUMN ews_username TEXT", []);
}

/// Refuse a token operation on an Exchange account. See the module notes.
pub fn refuse_token_operation(provider: &str, operation: &str) -> DbResult<()> {
  if provider == EXCHANGE {
    return Err(DbError::BadArgument(format!(
      "{operation} is not for Exchange accounts: the password stays in the EWS code"
    )));
  }
  Ok(())
}

impl MailDb {
  /// Write the row of an Exchange account after a good sign-in. A second
  /// connect of the same account keeps the row and its place in the list,
  /// and clears the last sync error.
  pub fn accounts_save_exchange(&self, email: &str, owner_id: &str, url: &str, username: &str) -> DbResult<()> {
    let conn = self.conn_mut();
    conn.execute(
      "INSERT INTO accounts (provider, email, owner_id, history_id, last_sync_error, ews_url, ews_username, updated_at)
       VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6)
       ON CONFLICT(provider, email, owner_id) DO UPDATE SET
         last_sync_error = NULL, ews_url = ?4, ews_username = ?5, updated_at = ?6",
      params![EXCHANGE, email, owner_id, url, username, now_ms()],
    )?;
    Ok(())
  }

  /// Give the store the way to remove an Exchange password.
  pub fn set_exchange_remover(&self, remover: ExchangeRemover) {
    *self.exchange_remover.lock().unwrap() = Some(remover);
  }

  /// Remove the secret of a mailbox whose last row went. An Exchange
  /// password goes through the EWS code, never through the token vault.
  pub(crate) fn remove_secret(&self, provider: &str, email: &str) -> DbResult<()> {
    if provider != EXCHANGE {
      return self.vault.remove(provider, email);
    }
    match self.exchange_remover.lock().unwrap().as_ref() {
      Some(remove) => remove(email).map_err(DbError::Vault),
      // A build without Exchange has no password to remove.
      None => Ok(()),
    }
  }
}

#[cfg(test)]
mod tests {
  use std::sync::{Arc, Mutex};

  use serde_json::json;

  use crate::db::MailDb;

  #[test]
  fn an_exchange_row_carries_its_server_and_username() {
    let db = MailDb::open_in_memory().unwrap();
    db.accounts_save_exchange("a@example.com", "local", "https://mail.example.com/EWS/Exchange.asmx", "EXAMPLE\\a")
      .unwrap();
    let rows = db.call("accounts.listForOwner", &json!({"provider": "exchange", "ownerId": "local"})).unwrap();
    assert_eq!(rows[0]["email"], "a@example.com");
    assert_eq!(rows[0]["ewsUrl"], "https://mail.example.com/EWS/Exchange.asmx");
    assert_eq!(rows[0]["ewsUsername"], "EXAMPLE\\a");
    // Other providers have none.
    db.call(
      "accounts.save",
      &json!({"provider": "gmail", "input": {"email": "b@example.com", "ownerId": "local", "refreshToken": "t"}}),
    )
    .unwrap();
    let rows = db.call("accounts.listForOwner", &json!({"provider": "gmail", "ownerId": "local"})).unwrap();
    assert_eq!(rows[0]["ewsUrl"], serde_json::Value::Null);
  }

  #[test]
  fn a_second_connect_keeps_the_row() {
    let db = MailDb::open_in_memory().unwrap();
    db.accounts_save_exchange("a@example.com", "local", "https://one.example.com/EWS/Exchange.asmx", "a").unwrap();
    db.accounts_save_exchange("a@example.com", "local", "https://two.example.com/EWS/Exchange.asmx", "a").unwrap();
    let rows = db.call("accounts.listAll", &json!({"provider": "exchange"})).unwrap();
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["ewsUrl"], "https://two.example.com/EWS/Exchange.asmx");
  }

  #[test]
  fn token_operations_refuse_exchange() {
    let db = MailDb::open_in_memory().unwrap();
    db.accounts_save_exchange("a@example.com", "local", "https://mail.example.com/EWS/Exchange.asmx", "a").unwrap();
    let save = json!({"provider": "exchange", "input": {"email": "a@example.com", "ownerId": "local", "refreshToken": "x"}});
    assert!(db.call("accounts.save", &save).is_err());
    let get = json!({"provider": "exchange", "email": "a@example.com"});
    assert!(db.call("accounts.getToken", &get).is_err());
    let replace = json!({"provider": "exchange", "email": "a@example.com", "ownerId": "local", "refreshToken": "x"});
    assert!(db.call("accounts.replaceToken", &replace).is_err());
  }

  #[test]
  fn remove_takes_the_password_through_the_ews_code() {
    let db = MailDb::open_in_memory().unwrap();
    let removed = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = removed.clone();
    db.set_exchange_remover(Box::new(move |email| {
      seen.lock().unwrap().push(email.to_string());
      Ok(())
    }));
    db.accounts_save_exchange("a@example.com", "local", "https://mail.example.com/EWS/Exchange.asmx", "a").unwrap();
    let args = json!({"provider": "exchange", "ownerId": "local", "email": "a@example.com"});
    assert_eq!(db.call("accounts.remove", &args).unwrap(), json!(true));
    assert_eq!(*removed.lock().unwrap(), vec!["a@example.com".to_string()]);
  }
}
