//! Where refresh tokens are kept: the keychain, behind a cache.

use super::*;

/// Where refresh tokens are kept.
///
/// Not in the SQLite file. The contract hands tokens over in plaintext exactly
/// so each host can protect them its own way, and this host's way is the
/// operating system keychain. A copy of the database is then worth nothing to
/// anyone without the keychain too.
pub trait TokenVault: Send + Sync {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()>;
  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>>;
  fn remove(&self, provider: &str, email: &str) -> DbResult<()>;
}

/// The OS keychain, through `Secrets`. One item per mailbox.
pub struct KeychainVault {
  secrets: Secrets,
}

impl KeychainVault {
  pub fn new(secrets: Secrets) -> Self {
    KeychainVault { secrets }
  }
}

impl TokenVault for KeychainVault {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()> {
    self
      .secrets
      .set(&vault_key(provider, email), token)
      .map_err(DbError::Vault)
  }

  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    let held = self.secrets.get(&vault_key(provider, email)).map_err(DbError::Vault)?;
    if held.is_some() || vault_key(provider, email) == shared_vault_key(provider, email) {
      return Ok(held);
    }
    // A build with keys of its own, reading one for the first time: take the
    // shared item over once, so a mailbox connected before the split needs
    // no new sign-in. If that grant was another client's, the refresh says
    // so and the reader reconnects, which writes the build's own item.
    let shared = self.secrets.get(&shared_vault_key(provider, email)).map_err(DbError::Vault)?;
    if let Some(token) = &shared {
      self.secrets.set(&vault_key(provider, email), token).map_err(DbError::Vault)?;
    }
    Ok(shared)
  }

  fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
    self.secrets.delete(&vault_key(provider, email)).map_err(DbError::Vault)
  }
}

/// A vault that reads each token once per launch.
///
/// **The keychain asks the operating system, and the operating system asks the
/// user.** Every read is a chance for macOS to put a password prompt on screen,
/// and the mail core asks for a token whenever its own cache expires — which,
/// in development, is every time the webview reloads, because that cache lives
/// in the page. One save became one prompt.
///
/// So the token is held for the life of the process. It is already in memory
/// whenever it is used; this only widens that to the session, on a
/// single-user desktop app whose whole database sits in the same process.
///
/// A write of a new value goes straight through and updates what is held, so a
/// rotated Microsoft token is never served stale. A write of the value already
/// held is skipped. The keychain asks the operating system, and the operating
/// system asks the reader, so the cheapest prompt is the one never requested.
pub struct CachedVault {
  inner: Box<dyn TokenVault>,
  seen: Mutex<HashMap<String, Option<String>>>,
}

impl CachedVault {
  pub fn new(inner: Box<dyn TokenVault>) -> Self {
    CachedVault { inner, seen: Mutex::new(HashMap::new()) }
  }
}

/// The keychain item for a mailbox's sign-in.
///
/// The public app and the team build share the keychain, so a mailbox
/// connected in one is connected in the other. A Google grant cannot be
/// shared that way: the two builds sign in to Google with different
/// clients, a grant made by one is refused when the other renews it
/// (`unauthorized_client`), and each build wrote its grant over the other's
/// (2026-10-11). So the team build keeps its Gmail grants in items of its
/// own. Outlook and Exchange stay shared: both builds use the same Microsoft
/// client, and an Exchange password belongs to no client.
pub(super) fn vault_key(provider: &str, email: &str) -> String {
  #[cfg(feature = "team")]
  if provider == "gmail" {
    return format!("gmail-team:{email}");
  }
  shared_vault_key(provider, email)
}

/// The item both builds read: every provider, and the public app's Gmail.
pub(super) fn shared_vault_key(provider: &str, email: &str) -> String {
  format!("{provider}:{email}")
}

impl TokenVault for CachedVault {
  fn store(&self, provider: &str, email: &str, token: &str) -> DbResult<()> {
    let key = vault_key(provider, email);
    // Compare what is held. A read of the keychain to decide this would put
    // the prompt back on screen, which is the thing this skip removes.
    if let Some(Some(held)) = self.seen.locked().get(&key) {
      if held == token {
        return Ok(());
      }
    }
    self.inner.store(provider, email, token)?;
    self.seen.locked().insert(key, Some(token.to_string()));
    Ok(())
  }

  fn read(&self, provider: &str, email: &str) -> DbResult<Option<String>> {
    let key = vault_key(provider, email);
    if let Some(held) = self.seen.locked().get(&key) {
      return Ok(held.clone());
    }
    let token = self.inner.read(provider, email)?;
    // A missing token is remembered too, or every read of a mailbox that has
    // none goes back to the keychain.
    self.seen.locked().insert(key, token.clone());
    Ok(token)
  }

  fn remove(&self, provider: &str, email: &str) -> DbResult<()> {
    self.inner.remove(provider, email)?;
    // The token is held for the life of the process. A disconnect ends that,
    // so the copy here goes too, not only the keychain item.
    if let Some(Some(mut held)) = self.seen.locked().insert(vault_key(provider, email), None) {
      zeroize::Zeroize::zeroize(&mut held);
    }
    Ok(())
  }
}
