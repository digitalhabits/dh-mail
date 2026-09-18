//! The Mac address book, as a read-only contact source.
//!
//! Mail mirrors this the way it mirrors Google and Outlook: a sync reads every
//! address once, and the compose field reads the mirror. Nothing here writes to
//! Contacts. Editing happens in Contacts.app.
//!
//! macOS asks the reader for permission the first time the app reads the book.
//! The prompt needs `NSContactsUsageDescription`, which build.rs puts in the
//! binary and Tauri puts in the bundle. Without it macOS ends the process
//! instead of asking.

#![cfg(target_os = "macos")]

use std::cell::RefCell;
use std::ptr::NonNull;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::AnyThread;
use objc2_contacts::{
  CNAuthorizationStatus, CNContact, CNContactEmailAddressesKey, CNContactFamilyNameKey,
  CNContactFetchRequest, CNContactGivenNameKey, CNContactOrganizationNameKey, CNContactStore,
  CNEntityType,
};
use objc2_foundation::{NSArray, NSError};
use serde::Serialize;

/// One address, in the shape every contact source stores. `card` is the
/// book's own id for the contact the address is on, so two addresses on one
/// card can be read as one person.
#[derive(Serialize)]
pub struct MacContact {
  pub email: String,
  pub name: String,
  pub card: String,
}

/// The reader's standing answer, in the words the panel uses.
fn status_label(status: CNAuthorizationStatus) -> &'static str {
  if status == CNAuthorizationStatus::Authorized {
    "authorized"
  } else if status == CNAuthorizationStatus::Limited {
    // The reader chose some contacts rather than all of them. Mail reads what
    // it is given and does not treat this as a failure.
    "limited"
  } else if status == CNAuthorizationStatus::Denied {
    "denied"
  } else if status == CNAuthorizationStatus::Restricted {
    // Parental controls or an MDM profile. The reader cannot change it.
    "restricted"
  } else {
    "notDetermined"
  }
}

fn authorization() -> CNAuthorizationStatus {
  // Safety: a class method Apple documents as safe on any thread.
  unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) }
}

fn readable(status: CNAuthorizationStatus) -> bool {
  status == CNAuthorizationStatus::Authorized || status == CNAuthorizationStatus::Limited
}

/// What macOS currently allows. Asks the reader nothing.
#[tauri::command]
pub fn mac_contacts_authorization() -> String {
  status_label(authorization()).to_string()
}

/// Ask for access, and answer with the status that resulted.
///
/// macOS shows the prompt once for the life of the install. Every later call
/// returns the standing answer and shows nothing, so a reader who said no must
/// change it in System Settings.
#[tauri::command]
pub async fn mac_contacts_request_access() -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(|| {
    let (tx, rx) = mpsc::channel::<bool>();
    // Safety: creating the store has no thread requirement.
    let store = unsafe { CNContactStore::new() };
    // Apple calls this handler on a queue of its own choosing, so the answer
    // comes back over a channel rather than through shared state.
    let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
      let _ = tx.send(granted.as_bool());
    });
    // Safety: the handler outlives the call, and both arguments are the
    // documented ones.
    unsafe {
      store.requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &handler);
    }
    // The prompt can sit on screen for as long as the reader ignores it. Give
    // up rather than hold this thread for the life of the app.
    match rx.recv_timeout(Duration::from_secs(120)) {
      Ok(_) => Ok(status_label(authorization()).to_string()),
      Err(_) => Err("Contacts did not answer the permission request".to_string()),
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Open System Settings at Privacy & Security › Contacts.
///
/// macOS answers its Contacts prompt once. After a refusal nothing in the app
/// can ask again, and this pane is the only way back. Taking the reader there
/// beats describing where it is.
#[tauri::command]
pub fn open_contacts_privacy_settings() -> Result<(), String> {
  // A fixed address, so nothing a message or a contact contains reaches it.
  const PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts";
  match std::process::Command::new("open").arg(PANE).status() {
    Ok(status) if status.success() => Ok(()),
    Ok(status) => Err(format!("open exited with {status}")),
    Err(err) => Err(format!("Couldn't open System Settings: {err}")),
  }
}

/// The name to file an address under.
///
/// A person is their name. A company in the address book has no name and only
/// an organization, and showing an empty label for it helps nobody.
fn display_name(contact: &CNContact) -> String {
  // Safety: every key read here was requested in the fetch. Reading a key that
  // was not fetched is what raises, and these four are the four asked for.
  unsafe {
    let given = contact.givenName().to_string();
    let family = contact.familyName().to_string();
    let full = format!("{given} {family}").trim().to_string();
    if !full.is_empty() {
      return full;
    }
    contact.organizationName().to_string().trim().to_string()
  }
}

/// Every address in the book, one row per address.
///
/// A contact with a home and a work address gives two rows carrying the same
/// name, which is what the mirror stores and what the compose field completes.
#[tauri::command]
pub async fn mac_contacts_list() -> Result<Vec<MacContact>, String> {
  tauri::async_runtime::spawn_blocking(read_all)
    .await
    .map_err(|e| e.to_string())?
}

fn read_all() -> Result<Vec<MacContact>, String> {
  let status = authorization();
  if !readable(status) {
    // The caller turns this into the line the panel shows.
    return Err(format!("Contacts access is {}", status_label(status)));
  }

  // Safety: the objects below are made, used and dropped on this one thread,
  // and every call is a documented Contacts API.
  unsafe {
    let store = CNContactStore::new();
    let keys = NSArray::from_slice(&[
      ProtocolObject::from_ref(CNContactGivenNameKey),
      ProtocolObject::from_ref(CNContactFamilyNameKey),
      ProtocolObject::from_ref(CNContactOrganizationNameKey),
      ProtocolObject::from_ref(CNContactEmailAddressesKey),
    ]);
    let request =
      CNContactFetchRequest::initWithKeysToFetch(CNContactFetchRequest::alloc(), &keys);

    // Apple calls the block once per contact, on this thread, before
    // `enumerate` returns.
    let rows: Rc<RefCell<Vec<MacContact>>> = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&rows);
    let block = RcBlock::new(move |contact: NonNull<CNContact>, _stop: NonNull<Bool>| {
      // Safety: the contact is alive for the length of this call.
      let contact = contact.as_ref();
      let name = display_name(contact);
      let card = contact.identifier().to_string();
      for labeled in contact.emailAddresses().iter() {
        let email = labeled.value().to_string().trim().to_lowercase();
        // The book holds addresses people typed. Some are not addresses.
        if !email.contains('@') {
          continue;
        }
        sink.borrow_mut().push(MacContact {
          email,
          name: name.clone(),
          card: card.clone(),
        });
      }
    });

    let mut error: Option<Retained<NSError>> = None;
    let ok = store.enumerateContactsWithFetchRequest_error_usingBlock(
      &request,
      Some(&mut error),
      &block,
    );
    if !ok {
      return Err(
        error
          .map(|e| e.localizedDescription().to_string())
          .unwrap_or_else(|| "Contacts could not be read".to_string()),
      );
    }

    let out = std::mem::take(&mut *rows.borrow_mut());
    Ok(out)
  }
}
