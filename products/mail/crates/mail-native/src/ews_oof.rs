//! The auto-reply of an Exchange mailbox (section 16.2 of
//! `docs/mail-exchange-ews.md`): `GetUserOofSettings` and
//! `SetUserOofSettings`.
//!
//! The `ews` crate 0.1.1 has no types for these, so both requests are
//! written by hand (ews_xml.rs). The interface maps the dialog to these
//! fields (`lib/mail/exchange-autoreply.ts`).

use serde::{Deserialize, Serialize};

use crate::ews::{element_text, EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_xml::{envelope, escape, inner, MESSAGES_NS};
use crate::secrets::Secrets;

/// The auto-reply as Exchange keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReply {
  /// `Disabled`, `Enabled`, or `Scheduled`.
  pub state: String,
  /// Who outside the organization gets the reply: `None`, `Known`, `All`.
  pub external_audience: String,
  /// UTC, as the server gives it. Exchange keeps the last times also when
  /// the state is not `Scheduled`.
  pub start: Option<String>,
  pub end: Option<String>,
  /// HTML.
  pub internal: String,
  pub external: String,
}

const STATES: [&str; 3] = ["Disabled", "Enabled", "Scheduled"];
const AUDIENCES: [&str; 3] = ["None", "Known", "All"];

fn mailbox(address: &str) -> String {
  format!("<t:Mailbox><t:Address>{}</t:Address></t:Mailbox>", escape(address))
}

pub fn get_request(address: &str) -> String {
  envelope(&format!(
    r#"<GetUserOofSettingsRequest xmlns="{MESSAGES_NS}">{}</GetUserOofSettingsRequest>"#,
    mailbox(address)
  ))
}

/// Check the reply before it goes: the server refuses these, and a clear
/// error here is better than a fault.
fn check(reply: &AutoReply) -> EwsResult<()> {
  if !STATES.contains(&reply.state.as_str()) || !AUDIENCES.contains(&reply.external_audience.as_str()) {
    return Err(EwsError::Invalid("The auto-reply has a state or an audience that Exchange does not know.".into()));
  }
  if reply.state == "Scheduled" {
    let (Some(start), Some(end)) = (&reply.start, &reply.end) else {
      return Err(EwsError::Invalid("A scheduled auto-reply needs a start and an end.".into()));
    };
    // The same UTC format on both sides: the text order is the time order.
    if end <= start {
      return Err(EwsError::Invalid("The end of the auto-reply must be after its start.".into()));
    }
  }
  Ok(())
}

/// The children of `UserOofSettings`, in the order of the schema.
pub fn set_request(address: &str, reply: &AutoReply) -> EwsResult<String> {
  check(reply)?;
  let duration = match (&reply.start, &reply.end) {
    (Some(start), Some(end)) => format!(
      "<t:Duration><t:StartTime>{}</t:StartTime><t:EndTime>{}</t:EndTime></t:Duration>",
      escape(start),
      escape(end)
    ),
    _ => String::new(),
  };
  Ok(envelope(&format!(
    concat!(
      r#"<SetUserOofSettingsRequest xmlns="{m}">{mailbox}<t:UserOofSettings>"#,
      "<t:OofState>{state}</t:OofState><t:ExternalAudience>{audience}</t:ExternalAudience>{duration}",
      "<t:InternalReply><t:Message>{internal}</t:Message></t:InternalReply>",
      "<t:ExternalReply><t:Message>{external}</t:Message></t:ExternalReply>",
      "</t:UserOofSettings></SetUserOofSettingsRequest>"
    ),
    m = MESSAGES_NS,
    mailbox = mailbox(address),
    state = reply.state,
    audience = reply.external_audience,
    duration = duration,
    internal = escape(&reply.internal),
    external = escape(&reply.external)
  )))
}

/// The text of a reply's message, unescaped. None or empty: "".
fn reply_text(settings: &str, which: &str) -> String {
  let text = inner(settings, which).and_then(|r| element_text(r, "Message")).unwrap_or_default();
  body_of(&text)
}

/// The inside of `<body>`, when the reply is a whole HTML document.
///
/// Exchange gives a reply back wrapped in `<html><head>…<body>`, and the KU
/// server refuses that same document when it is set again
/// (`ErrorInternalServerError`, 2026-09-27). So the reply is kept as the
/// part inside `<body>`, which the server takes.
fn body_of(html: &str) -> String {
  let lower = html.to_ascii_lowercase();
  let Some(open) = lower.find("<body") else { return html.trim().to_string() };
  let Some(start) = lower[open..].find('>').map(|i| open + i + 1) else { return html.trim().to_string() };
  let end = lower[start..].find("</body>").map(|i| start + i).unwrap_or(html.len());
  html[start..end].trim().to_string()
}

pub fn read_settings(xml: &str) -> EwsResult<AutoReply> {
  let settings = inner(xml, "OofSettings").ok_or_else(|| EwsError::Parse("The answer has no OofSettings.".into()))?;
  let duration = inner(settings, "Duration").unwrap_or("");
  let field = |name: &str| element_text(settings, name).filter(|v| !v.is_empty());
  // The state and the organization's rule for outside senders, not the text.
  log::info!(
    "ews: auto-reply is {}, audience {}, the organization allows outside replies: {}",
    field("OofState").unwrap_or_default(),
    field("ExternalAudience").unwrap_or_default(),
    element_text(xml, "AllowExternalOof").unwrap_or_else(|| "(not said)".into())
  );
  Ok(AutoReply {
    state: field("OofState").unwrap_or_else(|| "Disabled".into()),
    external_audience: field("ExternalAudience").unwrap_or_else(|| "All".into()),
    start: element_text(duration, "StartTime").filter(|v| !v.is_empty()),
    end: element_text(duration, "EndTime").filter(|v| !v.is_empty()),
    internal: reply_text(settings, "InternalReply"),
    external: reply_text(settings, "ExternalReply"),
  })
}

pub async fn get(client: &EwsClient, address: &str) -> EwsResult<AutoReply> {
  read_settings(&client.call(&get_request(address)).await?)
}

/// Save the reply, and read it back as the server keeps it.
pub async fn set(client: &EwsClient, address: &str, reply: &AutoReply) -> EwsResult<AutoReply> {
  // What is sent, without the text: the state, the audience, and the times.
  log::info!(
    "ews: set auto-reply {} for {}, from {} to {}",
    reply.state,
    reply.external_audience,
    reply.start.as_deref().unwrap_or("-"),
    reply.end.as_deref().unwrap_or("-")
  );
  client.call(&set_request(address, reply)?).await?;
  get(client, address).await
}

fn normalize(account: &str) -> String {
  account.trim().to_lowercase()
}

pub mod commands {
  use super::*;

  #[tauri::command]
  pub async fn mail_ews_get_auto_reply(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<AutoReply, String> {
    let email = normalize(&account);
    let client = accounts.client(&secrets, &email).map_err(|e| e.to_string())?;
    get(&client, &email).await.map_err(|e| e.to_string())
  }

  #[tauri::command]
  pub async fn mail_ews_set_auto_reply(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    reply: AutoReply,
  ) -> Result<AutoReply, String> {
    let email = normalize(&account);
    let client = accounts.client(&secrets, &email).map_err(|e| e.to_string())?;
    set(&client, &email, &reply).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_oof_tests.rs"]
mod tests;
