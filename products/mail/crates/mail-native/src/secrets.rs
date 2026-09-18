//! Where secrets are kept: the refresh token of each mailbox, and the planner
//! session. Never in the SQLite file.
//!
//! On macOS there are two keychains, and which one matters.
//!
//! The **login keychain** is the old one. It decides access per item and per
//! app signature, and when the app that reads an item is not the app that
//! made it, macOS asks the user with a password dialog. Two different signed
//! apps (the Planner and the standalone Mail app) reading one set of tokens
//! means dialogs, and an item made by an earlier signature means dialogs that
//! on recent macOS often come back even after "Always Allow".
//!
//! The **data-protection keychain** is the new one. Access is decided by the
//! `keychain-access-groups` entitlement, and that dialog does not exist. Both
//! apps carry the same group, so a mailbox connected in one is connected in
//! the other, in silence. This is what Apple asks for (TN3137).
//!
//! The entitlement is restricted: a Developer ID build needs an embedded
//! provisioning profile, or macOS will not let it launch. A build without the
//! profile — a dev build, or a release before the profiles exist — gets
//! `errSecMissingEntitlement` from the data-protection keychain. `Secrets::open`
//! tries once, and such a build uses the login keychain as before. Nothing
//! else in the crate knows which one it got.
//!
//! An item the data-protection keychain does not have is looked for in the
//! login keychain, moved across if found, and removed there. One read — which
//! may ask the user one last time — and the item is silent from then on.
//!
//! On Windows the Credential Manager has no such dialog; `keyring` is used as
//! it was. On iOS `keyring` reaches the same keychain the app's own data
//! protection covers, so it is used there too.
//!
//! Android has no keychain that `keyring` can reach. There the secrets go to
//! a file in the app's private data directory, which no other app can read:
//! Android encrypts that directory at rest with the device credentials, and
//! the file is written with owner-only permissions. The same fallback stands
//! on Linux, where nothing else is wired up yet. See the `file` module.

use std::sync::Arc;

/// One handle, chosen at startup. Cheap to clone; the clones share it.
#[derive(Clone)]
pub struct Secrets {
  inner: Arc<Backend>,
}

enum Backend {
  /// The data-protection keychain, with the login keychain to migrate from.
  #[cfg(target_os = "macos")]
  Protected { service: String, group: String },
  /// The OS store `keyring` picks: the login keychain, Credential Manager,
  /// or the iOS keychain.
  #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
  Native { service: String },
  /// A file in the app's private data directory. Android, and any platform
  /// with no keyring.
  #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
  File { service: String, path: std::path::PathBuf },
}

impl Secrets {
  /// Choose the store. `group` is the keychain access group both apps share;
  /// it is used on macOS and ignored elsewhere.
  ///
  /// Only where `keyring` has a store: on a platform that keeps secrets in a
  /// file, the directory has to be named — see [`Secrets::open_in`].
  #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
  pub fn open(service: &str, group: &str) -> Secrets {
    Self::open_in(service, group, std::path::Path::new(""))
  }

  /// Choose the store, with the app's data directory for the platforms
  /// that keep secrets in a file there. Where the OS has a keychain the
  /// directory is not used.
  pub fn open_in(service: &str, group: &str, data_dir: &std::path::Path) -> Secrets {
    #[cfg(target_os = "macos")]
    {
      match protected::available(service, group) {
        Ok(()) => {
          log::info!("secrets: data-protection keychain, group {group}");
          return Secrets {
            inner: Arc::new(Backend::Protected {
              service: service.to_string(),
              group: group.to_string(),
            }),
          };
        }
        Err(reason) => {
          log::info!("secrets: login keychain ({reason})");
        }
      }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = group;
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
    {
      let _ = data_dir;
      Secrets {
        inner: Arc::new(Backend::Native {
          service: service.to_string(),
        }),
      }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
    {
      let path = file::path_in(data_dir);
      log::info!("secrets: file store at {}", path.display());
      Secrets {
        inner: Arc::new(Backend::File {
          service: service.to_string(),
          path,
        }),
      }
    }
  }

  /// A name for logs and diagnostics.
  pub fn kind(&self) -> &'static str {
    match &*self.inner {
      #[cfg(target_os = "macos")]
      Backend::Protected { .. } => "data-protection keychain",
      #[cfg(target_os = "macos")]
      Backend::Native { .. } => "login keychain",
      #[cfg(target_os = "windows")]
      Backend::Native { .. } => "credential manager",
      #[cfg(target_os = "ios")]
      Backend::Native { .. } => "ios keychain",
      #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
      Backend::File { .. } => "file store",
    }
  }

  pub fn get(&self, account: &str) -> Result<Option<String>, String> {
    match &*self.inner {
      #[cfg(target_os = "macos")]
      Backend::Protected { service, group } => {
        if let Some(value) = protected::get(service, group, account)? {
          return Ok(Some(value));
        }
        // Not there yet. The login keychain may still hold it from before.
        let Some(value) = native::get(service, account)? else {
          return Ok(None);
        };
        protected::set(service, group, account, &value)?;
        match native::delete(service, account) {
          Ok(()) => {
            log::info!("secrets: moved {account} to the data-protection keychain")
          }
          Err(err) => log::warn!("secrets: moved {account}, old item not removed: {err}"),
        }
        Ok(Some(value))
      }
      #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
      Backend::Native { service } => native::get(service, account),
      #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
      Backend::File { service, path } => file::get(path, service, account),
    }
  }

  pub fn set(&self, account: &str, value: &str) -> Result<(), String> {
    match &*self.inner {
      #[cfg(target_os = "macos")]
      Backend::Protected { service, group } => protected::set(service, group, account, value),
      #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
      Backend::Native { service } => native::set(service, account, value),
      #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
      Backend::File { service, path } => file::set(path, service, account, value),
    }
  }

  pub fn delete(&self, account: &str) -> Result<(), String> {
    match &*self.inner {
      #[cfg(target_os = "macos")]
      Backend::Protected { service, group } => {
        protected::delete(service, group, account)?;
        // Whatever an older build left behind goes too, so a removed mailbox
        // does not come back through migration.
        native::delete(service, account)
      }
      #[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
      Backend::Native { service } => native::delete(service, account),
      #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
      Backend::File { service, path } => file::delete(path, service, account),
    }
  }
}

/// A file of secrets, for a platform with no keychain `keyring` can reach.
///
/// One JSON object, keyed by service and account, in the app's private data
/// directory. Written whole on every change, to a temporary file first and
/// then moved into place, so a write that dies halfway leaves the last good
/// file. Owner-only permissions where the OS has them. One lock for the
/// whole process, so two threads cannot read, change and write over each
/// other.
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "ios")))]
mod file {
  use std::collections::BTreeMap;
  use std::path::{Path, PathBuf};
  use std::sync::Mutex;

  const FILE_NAME: &str = "secrets.json";
  static LOCK: Mutex<()> = Mutex::new(());

  pub fn path_in(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
  }

  fn key(service: &str, account: &str) -> String {
    format!("{service}\t{account}")
  }

  fn read(path: &Path) -> Result<BTreeMap<String, String>, String> {
    let bytes = match std::fs::read(path) {
      Ok(bytes) => bytes,
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
      Err(err) => return Err(format!("secrets: read {}: {err}", path.display())),
    };
    serde_json::from_slice(&bytes).map_err(|err| format!("secrets: parse {}: {err}", path.display()))
  }

  fn write(path: &Path, map: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
      std::fs::create_dir_all(dir).map_err(|err| format!("secrets: {}: {err}", dir.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(map).map_err(|err| err.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|err| format!("secrets: write {}: {err}", tmp.display()))?;
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path).map_err(|err| format!("secrets: move {}: {err}", path.display()))
  }

  pub fn get(path: &Path, service: &str, account: &str) -> Result<Option<String>, String> {
    let _held = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(read(path)?.get(&key(service, account)).cloned())
  }

  pub fn set(path: &Path, service: &str, account: &str, value: &str) -> Result<(), String> {
    let _held = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read(path)?;
    map.insert(key(service, account), value.to_string());
    write(path, &map)
  }

  pub fn delete(path: &Path, service: &str, account: &str) -> Result<(), String> {
    let _held = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read(path)?;
    if map.remove(&key(service, account)).is_none() {
      return Ok(());
    }
    write(path, &map)
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    #[test]
    fn a_secret_survives_a_round_trip_and_a_delete() {
      let dir = std::env::temp_dir().join(format!("dh-mail-secrets-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&dir);
      let path = path_in(&dir);
      assert_eq!(get(&path, "svc", "a@example.com").unwrap(), None);
      set(&path, "svc", "a@example.com", "token-1").unwrap();
      set(&path, "svc", "b@example.com", "token-2").unwrap();
      assert_eq!(get(&path, "svc", "a@example.com").unwrap().as_deref(), Some("token-1"));
      delete(&path, "svc", "a@example.com").unwrap();
      assert_eq!(get(&path, "svc", "a@example.com").unwrap(), None);
      assert_eq!(get(&path, "svc", "b@example.com").unwrap().as_deref(), Some("token-2"));
      // Twice is not an error.
      delete(&path, "svc", "a@example.com").unwrap();
      let _ = std::fs::remove_dir_all(&dir);
    }
  }
}

/// The store `keyring` chooses for the platform.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
mod native {
  fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
  }

  pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
    match entry(service, account)?.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(e) => Err(e.to_string()),
    }
  }

  pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
    entry(service, account)?
      .set_password(value)
      .map_err(|e| e.to_string())
  }

  pub fn delete(service: &str, account: &str) -> Result<(), String> {
    match entry(service, account)?.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(e) => Err(e.to_string()),
    }
  }
}

/// The macOS data-protection keychain, through `SecItem*` directly.
/// `security-framework`'s search API cannot name this keychain, so the
/// dictionaries are built here.
#[cfg(target_os = "macos")]
mod protected {
  use core_foundation::base::{CFType, TCFType};
  use core_foundation::boolean::CFBoolean;
  use core_foundation::data::CFData;
  use core_foundation::dictionary::CFDictionary;
  use core_foundation::string::CFString;
  use core_foundation_sys::base::{CFTypeRef, OSStatus};
  use core_foundation_sys::string::CFStringRef;
  use security_framework_sys::access_control::kSecAttrAccessibleAfterFirstUnlock;
  use security_framework_sys::item::{
    kSecAttrAccessGroup, kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword,
    kSecMatchLimit, kSecReturnData, kSecValueData,
  };
  use security_framework_sys::keychain_item::{
    SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate,
  };

  // Three keys `security-framework-sys` does not declare for macOS.
  #[link(name = "Security", kind = "framework")]
  extern "C" {
    static kSecAttrAccessible: CFStringRef;
    static kSecMatchLimitOne: CFStringRef;
    static kSecUseDataProtectionKeychain: CFStringRef;
  }

  const ERR_SEC_DUPLICATE_ITEM: OSStatus = security_framework_sys::base::errSecDuplicateItem;
  const ERR_SEC_ITEM_NOT_FOUND: OSStatus = security_framework_sys::base::errSecItemNotFound;
  /// The app is not signed with the entitlement this keychain needs.
  const ERR_SEC_MISSING_ENTITLEMENT: OSStatus = -34018;

  /// An account name no real item uses, for the probe.
  const PROBE_ACCOUNT: &str = "\u{1}probe";

  fn key(k: CFStringRef) -> CFString {
    unsafe { CFString::wrap_under_get_rule(k) }
  }

  fn status_error(what: &str, status: OSStatus) -> String {
    format!("{what}: OSStatus {status}")
  }

  /// The query every call starts from: this keychain, this group, one item.
  fn query(service: &str, group: &str, account: &str) -> Vec<(CFString, CFType)> {
    unsafe {
      vec![
        (key(kSecClass), key(kSecClassGenericPassword).as_CFType()),
        (
          key(kSecUseDataProtectionKeychain),
          CFBoolean::true_value().as_CFType(),
        ),
        (key(kSecAttrAccessGroup), CFString::new(group).as_CFType()),
        (key(kSecAttrService), CFString::new(service).as_CFType()),
        (key(kSecAttrAccount), CFString::new(account).as_CFType()),
      ]
    }
  }

  fn dict(pairs: Vec<(CFString, CFType)>) -> CFDictionary<CFString, CFType> {
    CFDictionary::from_CFType_pairs(&pairs)
  }

  /// Can this build use the data-protection keychain? A search for an item
  /// that does not exist answers: not-found means yes, missing-entitlement
  /// means no. Anything else is reported as well, and the caller falls back.
  pub fn available(service: &str, group: &str) -> Result<(), String> {
    let mut q = query(service, group, PROBE_ACCOUNT);
    q.push((
      key(unsafe { kSecMatchLimit }),
      key(unsafe { kSecMatchLimitOne }).as_CFType(),
    ));
    let q = dict(q);
    let mut out: CFTypeRef = std::ptr::null();
    let status = unsafe { SecItemCopyMatching(q.as_concrete_TypeRef(), &mut out) };
    if !out.is_null() {
      unsafe { core_foundation_sys::base::CFRelease(out) };
    }
    match status {
      0 | ERR_SEC_ITEM_NOT_FOUND => Ok(()),
      ERR_SEC_MISSING_ENTITLEMENT => Err("no keychain-access-groups entitlement".into()),
      other => Err(status_error("probe", other)),
    }
  }

  pub fn get(service: &str, group: &str, account: &str) -> Result<Option<String>, String> {
    let mut q = query(service, group, account);
    unsafe {
      q.push((key(kSecMatchLimit), key(kSecMatchLimitOne).as_CFType()));
      q.push((key(kSecReturnData), CFBoolean::true_value().as_CFType()));
    }
    let q = dict(q);
    let mut out: CFTypeRef = std::ptr::null();
    let status = unsafe { SecItemCopyMatching(q.as_concrete_TypeRef(), &mut out) };
    match status {
      0 => {
        if out.is_null() {
          return Ok(None);
        }
        let data = unsafe { CFData::wrap_under_create_rule(out as _) };
        Ok(Some(String::from_utf8_lossy(data.bytes()).into_owned()))
      }
      ERR_SEC_ITEM_NOT_FOUND => Ok(None),
      other => Err(status_error("read", other)),
    }
  }

  pub fn set(service: &str, group: &str, account: &str, value: &str) -> Result<(), String> {
    let data = CFData::from_buffer(value.as_bytes()).as_CFType();
    let update = dict(vec![(key(unsafe { kSecValueData }), data.clone())]);
    let q = dict(query(service, group, account));
    let status = unsafe { SecItemUpdate(q.as_concrete_TypeRef(), update.as_concrete_TypeRef()) };
    if status == 0 {
      return Ok(());
    }
    if status != ERR_SEC_ITEM_NOT_FOUND {
      return Err(status_error("update", status));
    }
    let mut add = query(service, group, account);
    unsafe {
      add.push((key(kSecValueData), data));
      add.push((
        key(kSecAttrAccessible),
        key(kSecAttrAccessibleAfterFirstUnlock).as_CFType(),
      ));
    }
    let add = dict(add);
    let status = unsafe { SecItemAdd(add.as_concrete_TypeRef(), std::ptr::null_mut()) };
    match status {
      0 => Ok(()),
      // Written by another process between the two calls. It has a value
      // now; a second update would be the same race again.
      ERR_SEC_DUPLICATE_ITEM => Ok(()),
      other => Err(status_error("add", other)),
    }
  }

  pub fn delete(service: &str, group: &str, account: &str) -> Result<(), String> {
    let q = dict(query(service, group, account));
    match unsafe { SecItemDelete(q.as_concrete_TypeRef()) } {
      0 | ERR_SEC_ITEM_NOT_FOUND => Ok(()),
      other => Err(status_error("delete", other)),
    }
  }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
  use super::*;

  /// The probe runs for real. A test binary carries no entitlement, so the
  /// answer is the login keychain — reached by the missing-entitlement
  /// status, not by a crash or a stray error. Should a build ever carry the
  /// entitlement, the other answer is right too; both are printed.
  #[test]
  fn the_store_is_chosen_without_crashing() {
    let probe = protected::available(
      "org.digitalhabits.mail.test",
      "JD647S9RT6.org.digitalhabits.mail",
    );
    let secrets = Secrets::open(
      "org.digitalhabits.mail.test",
      "JD647S9RT6.org.digitalhabits.mail",
    );
    println!("probe: {probe:?}; chose: {}", secrets.kind());
    match probe {
      Ok(()) => assert_eq!(secrets.kind(), "data-protection keychain"),
      Err(reason) => {
        assert_eq!(reason, "no keychain-access-groups entitlement");
        assert_eq!(secrets.kind(), "login keychain");
      }
    }
  }
}
