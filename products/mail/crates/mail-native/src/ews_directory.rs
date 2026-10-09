//! The address book of an Exchange server (section 16.5 of
//! `docs/mail-exchange-ews.md`): `ResolveNames` on the directory, for the
//! suggestions in To, Cc, and Bcc.
//!
//! The `ews` crate 0.1.1 has no `ResolveNames`, so the request is written by
//! hand (ews_xml.rs). Nothing here is kept: the directory is the
//! organization's, not the reader's.

use serde::Serialize;

use crate::ews::{element_text, EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_xml::{all_inner, envelope, escape, inner, MESSAGES_NS};
use crate::secrets::Secrets;

/// The most people one answer gives back.
pub const MAX_PEOPLE: usize = 8;

/// The shortest text that is looked up. Fewer letters match half the
/// directory.
pub const MIN_TEXT: usize = 3;

/// One person in the directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Person {
  pub name: String,
  pub email: String,
}

/// `ResolveNames` on the directory only, with the contact data: on KU the
/// mailbox's `Name` is the user id (`abc123`), and the person's name is only
/// in the contact's `DisplayName` (17.1).
pub fn resolve_request(text: &str) -> EwsResult<String> {
  let text = text.trim();
  if text.chars().count() < MIN_TEXT {
    return Err(EwsError::Invalid(format!("Type {MIN_TEXT} letters or more to search the directory.")));
  }
  Ok(envelope(&format!(
    concat!(
      r#"<ResolveNames xmlns="{m}" ReturnFullContactData="true" SearchScope="ActiveDirectory">"#,
      "<UnresolvedEntry>{text}</UnresolvedEntry></ResolveNames>"
    ),
    m = MESSAGES_NS,
    text = escape(text)
  )))
}

/// One result, before the cut to `MAX_PEOPLE`.
struct Found {
  person: Person,
  /// The directory gives a department or a job title. A current member of
  /// staff has one; an old account often has neither (17.1).
  has_role: bool,
}

/// One `Resolution`: the address from the mailbox, the name from the
/// contact data (else the mailbox's name). None: no SMTP address.
fn found(resolution: &str) -> Option<Found> {
  let mailbox = inner(resolution, "Mailbox")?;
  let email = element_text(mailbox, "EmailAddress").unwrap_or_default().trim().to_lowercase();
  let smtp = element_text(mailbox, "RoutingType").is_none_or(|r| r.eq_ignore_ascii_case("SMTP"));
  if !smtp || !email.contains('@') {
    return None;
  }
  let contact = inner(resolution, "Contact").unwrap_or("");
  let field = |name: &str| element_text(contact, name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
  let name = field("DisplayName").or_else(|| element_text(mailbox, "Name").map(|v| v.trim().to_string())).unwrap_or_default();
  let has_role = field("Department").is_some() || field("JobTitle").is_some();
  Some(Found { person: Person { name, email }, has_role })
}

/// The people in an answer. No match is an empty list. A mailbox with no
/// SMTP address is left out. The ones with a department or a job title
/// come first, in the server's order; then the rest. At most `MAX_PEOPLE`.
pub fn read_people(xml: &str) -> EwsResult<Vec<Person>> {
  let message = inner(xml, "ResolveNamesResponseMessage").unwrap_or("");
  let code = element_text(message, "ResponseCode").unwrap_or_default();
  if code == "ErrorNameResolutionNoResults" {
    return Ok(Vec::new());
  }
  if xml.contains(r#"ResponseClass="Error""#) {
    let text = element_text(message, "MessageText").unwrap_or_default();
    return Err(EwsError::Fault { code, message: text });
  }
  let mut all: Vec<Found> = Vec::new();
  for f in all_inner(message, "Resolution").into_iter().filter_map(found) {
    if !all.iter().any(|a| a.person.email == f.person.email) {
      all.push(f);
    }
  }
  // Counts only, never a name: for the next test on a real directory.
  let with_role = all.iter().filter(|f| f.has_role).count();
  log::info!("ews: directory answer: {} people, {with_role} with a department or job title", all.len());
  all.sort_by_key(|f| !f.has_role);
  Ok(all.into_iter().take(MAX_PEOPLE).map(|f| f.person).collect())
}

pub async fn resolve(client: &EwsClient, text: &str) -> EwsResult<Vec<Person>> {
  // `call_many`: no match comes as an `Error` message, which is an answer.
  read_people(&client.call_many(&resolve_request(text)?).await?)
}

/// `ResolveNames` for the signed-in mailbox itself: its own record, with
/// the contact data that lists every address it has.
pub fn own_request(account: &str) -> EwsResult<String> {
  Ok(envelope(&format!(
    concat!(
      r#"<ResolveNames xmlns="{m}" ReturnFullContactData="true" SearchScope="ActiveDirectory">"#,
      "<UnresolvedEntry>{text}</UnresolvedEntry></ResolveNames>"
    ),
    m = MESSAGES_NS,
    text = escape(account.trim())
  )))
}

/// The SMTP addresses of one `Resolution`: the mailbox's own, and each
/// `smtp:` entry of the contact's `EmailAddresses` (`SMTP:` is the main
/// one, `smtp:` the others; `X500:`, `SIP:` and the like are not mail).
fn addresses_of(resolution: &str) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  let mut add = |raw: &str| {
    let raw = raw.trim();
    let email = match raw.split_once(':') {
      Some((kind, rest)) if kind.eq_ignore_ascii_case("smtp") => rest,
      Some(_) => return,
      None => raw,
    };
    let email = email.trim().to_lowercase();
    if email.contains('@') && !out.contains(&email) {
      out.push(email);
    }
  };
  if let Some(mailbox) = inner(resolution, "Mailbox") {
    let smtp = element_text(mailbox, "RoutingType").is_none_or(|r| r.eq_ignore_ascii_case("SMTP"));
    if smtp {
      if let Some(email) = element_text(mailbox, "EmailAddress") {
        add(&email);
      }
    }
  }
  if let Some(list) = inner(resolution, "Contact").and_then(|c| inner(c, "EmailAddresses")) {
    for entry in all_inner(list, "Entry") {
      add(entry);
    }
  }
  out
}

/// Every address of the signed-in mailbox, from its record in the
/// directory. A mailbox signs in as one address and may send as another:
/// at a university, `abc123@uni.example` sends as `kim@dept.uni.example`, and mail from that
/// address read as somebody else's. Only the record that holds `account`
/// itself counts; none found is an empty list.
pub fn read_own_addresses(xml: &str, account: &str) -> Vec<String> {
  let account = account.trim().to_lowercase();
  let user_id = user_id_of(&account);
  let message = inner(xml, "ResolveNamesResponseMessage").unwrap_or("");
  let resolutions = all_inner(message, "Resolution");
  // The record that lists the account's address, else the one whose
  // mailbox `Name` is the account's user id: on KU the record of
  // abc123@dept.uni.example does not list that address, and its Name is abc123.
  let by_address = resolutions.iter().map(|r| addresses_of(r)).find(|a| a.contains(&account));
  let found = by_address.or_else(|| {
    resolutions
      .iter()
      .find(|r| {
        inner(r, "Mailbox")
          .and_then(|m| element_text(m, "Name"))
          .is_some_and(|name| name.trim().eq_ignore_ascii_case(user_id))
      })
      .map(|r| addresses_of(r))
  });
  // Counts only, never an address.
  log::info!(
    "ews: own record: {} resolution(s), {}",
    resolutions.len(),
    if found.is_some() { "one is this mailbox" } else { "none is this mailbox" }
  );
  let mut found = found.unwrap_or_default();
  // The address signed in with is ours whatever the record lists.
  if !found.is_empty() && !found.contains(&account) {
    found.push(account);
  }
  found
}

/// The part before the @: the user id on a directory like KU's.
fn user_id_of(account: &str) -> &str {
  account.split('@').next().unwrap_or(account)
}

pub async fn own_addresses(client: &EwsClient, account: &str) -> EwsResult<Vec<String>> {
  // Asked by the user id, which is what the directory's record is named by;
  // `call_many`: no match comes as an `Error` message, which is an answer.
  let account = account.trim().to_lowercase();
  Ok(read_own_addresses(&client.call_many(&own_request(user_id_of(&account))?).await?, &account))
}

pub mod commands {
  use super::*;

  /// The people in the directory whose name or address fits `text`.
  #[tauri::command]
  pub async fn mail_ews_resolve_names(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    text: String,
  ) -> Result<Vec<Person>, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    // A count or an error code, never a name: the interface shows nothing
    // when the search fails.
    match resolve(&client, &text).await {
      Ok(people) => {
        log::info!("ews: directory search of {} letters found {}", text.chars().count(), people.len());
        Ok(people)
      }
      Err(e) => {
        log::warn!("ews: directory search failed: {e}");
        Err(e.to_string())
      }
    }
  }

  /// Every address the signed-in mailbox has, so mail from any of them is
  /// the reader's own. A count in the log, never an address.
  #[tauri::command]
  pub async fn mail_ews_own_addresses(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<Vec<String>, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    match own_addresses(&client, &account).await {
      Ok(found) => {
        log::info!("ews: the mailbox has {} address(es) in the directory", found.len());
        Ok(found)
      }
      Err(e) => {
        log::warn!("ews: own addresses lookup failed: {e}");
        Err(e.to_string())
      }
    }
  }
}

#[cfg(test)]
#[path = "ews_directory_tests.rs"]
mod tests;
