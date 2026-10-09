//! Sending from an Exchange account (phase 4 of `docs/mail-exchange-ews.md`,
//! section 13): the MIME message that the interface builds, in one
//! `CreateItem` with `SendAndSaveCopy`. And the server copy of a draft
//! (phase 5, section 14.1): the same MIME, saved into Drafts.

use serde::Serialize;

use ews::create_item::{CreateItem, CreateItemResponse};
use ews::delete_item::{DeleteItem, DeleteItemResponse};
use ews::{
  ArrayOfRecipients, BaseFolderId, BaseItemId, DeleteType, ExtendedFieldURI, ExtendedProperty, Mailbox, Message,
  MessageDisposition, MimeContent, PropertyType, RealItem, Recipient, ResponseClass,
};

use crate::ews::{EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_ops::{document, message_error, read};
use crate::secrets::Secrets;

/// The most base64 MIME one request may carry. Exchange 2019 takes requests
/// up to about 35 MB by default, and the SOAP body holds the MIME as base64.
pub const MAX_MIME_BASE64: usize = 25 * 1024 * 1024;

fn recipients(addresses: &[String]) -> Option<ArrayOfRecipients> {
  let list: Vec<Recipient> = addresses
    .iter()
    .map(|a| a.trim())
    .filter(|a| !a.is_empty())
    .map(|a| Recipient { mailbox: Mailbox { email_address: Some(a.to_string()), ..Default::default() } })
    .collect();
  (!list.is_empty()).then(|| ArrayOfRecipients(list))
}

/// The message as `CreateItem` carries it: the MIME, and the Bcc addresses
/// as well, because the server can drop a `Bcc` header from the MIME.
fn mime_item(mime_base64: &str, bcc: &[String]) -> EwsResult<RealItem> {
  let content: String = mime_base64.chars().filter(|c| !c.is_whitespace()).collect();
  if content.is_empty() {
    return Err(EwsError::Invalid("The message is empty. Nothing was sent to the server.".into()));
  }
  if content.len() > MAX_MIME_BASE64 {
    return Err(EwsError::Invalid(
      "The message is too large for the server. Remove some files and try again.".into(),
    ));
  }
  Ok(RealItem::Message(Message {
    mime_content: Some(MimeContent { character_set: Some("UTF-8".into()), content }),
    bcc_recipients: recipients(bcc),
    ..Default::default()
  }))
}

/// `CreateItem`, send and save a copy in Sent Items.
fn send_create_item(mime_base64: &str, bcc: &[String]) -> EwsResult<CreateItem> {
  Ok(CreateItem {
    message_disposition: Some(MessageDisposition::SendAndSaveCopy),
    saved_item_folder_id: Some(BaseFolderId::DistinguishedFolderId { id: "sentitems".into(), change_key: None }),
    items: vec![mime_item(mime_base64, bcc)?],
  })
}

pub fn send_request(mime_base64: &str, bcc: &[String]) -> EwsResult<String> {
  document(send_create_item(mime_base64, bcc)?)
}

/// The id of the item a `CreateItem` made, if the answer names one. A send
/// answers with no item: the copy is in Sent Items, and the next sync
/// brings it.
pub fn read_created(xml: &str) -> EwsResult<Option<String>> {
  match read::<CreateItemResponse>(xml)?.into_iter().next() {
    Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => {
      Ok(m.items.inner.first().and_then(|i| i.inner_message().item_id.as_ref()).map(|i| i.id.clone()))
    }
    Some(ResponseClass::Error(e)) => Err(message_error(&e)),
    None => Err(EwsError::Parse("The answer to CreateItem has no response message.".into())),
  }
}

/// `PR_MESSAGE_FLAGS` with `MSGFLAG_READ | MSGFLAG_UNSENT`. Without the
/// unsent flag the server keeps a MIME item as a received message, not as a
/// draft.
fn draft_flags() -> ExtendedProperty {
  ExtendedProperty {
    extended_field_URI: ExtendedFieldURI {
      distinguished_property_set_id: None,
      property_set_id: None,
      property_tag: Some("0x0E07".into()),
      property_name: None,
      property_id: None,
      property_type: Some(PropertyType::Integer),
    },
    value: "9".into(),
  }
}

/// `CreateItem`, save only, into Drafts, with the draft flags.
pub fn save_draft_request(mime_base64: &str, bcc: &[String]) -> EwsResult<String> {
  let RealItem::Message(mut message) = mime_item(mime_base64, bcc)? else {
    return Err(EwsError::Invalid("The draft is not a message.".into()));
  };
  message.extended_property = Some(vec![draft_flags()]);
  document(CreateItem {
    message_disposition: Some(MessageDisposition::SaveOnly),
    saved_item_folder_id: Some(BaseFolderId::DistinguishedFolderId { id: "drafts".into(), change_key: None }),
    items: vec![RealItem::Message(message)],
  })
}

/// `DeleteItem` for one draft: to Deleted Items when the reader discards it,
/// else `SoftDelete` (a version replaced, or the draft of a message sent).
/// Never `HardDelete`: that is for Delete forever only.
pub fn delete_draft_request(item_id: &str, discard: bool) -> EwsResult<String> {
  if item_id.trim().is_empty() {
    return Err(EwsError::Invalid("No draft was named. Nothing was sent to the server.".into()));
  }
  document(DeleteItem {
    delete_type: if discard { DeleteType::MoveToDeletedItems } else { DeleteType::SoftDelete },
    send_meeting_cancellations: None,
    affected_task_occurrences: None,
    suppress_read_receipts: None,
    item_ids: vec![BaseItemId::ItemId { id: item_id.to_string(), change_key: None }],
  })
}

/// A draft that is gone already is not a failure. It is written to the
/// log all the same: a draft the server says is gone, that then comes back
/// at the next sync, was asked for by an id the server does not know.
fn read_deleted(xml: &str) -> EwsResult<()> {
  match read::<DeleteItemResponse>(xml)?.into_iter().next() {
    Some(ResponseClass::Error(e)) if format!("{:?}", e.response_code) != "ErrorItemNotFound" => Err(message_error(&e)),
    Some(ResponseClass::Error(_)) => {
      log::info!("ews: the draft to delete was not found on the server (ErrorItemNotFound)");
      Ok(())
    }
    _ => Ok(()),
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDraft {
  pub item_id: String,
}

/// Save a draft, and then delete the version it replaces. A failed delete of
/// the old version is written to the log, not returned: the new one is
/// saved, and the old one stays until the next save.
pub async fn save_draft(
  client: &EwsClient,
  mime_base64: &str,
  bcc: &[String],
  replaces: Option<&str>,
) -> EwsResult<SavedDraft> {
  let xml = client.call(&save_draft_request(mime_base64, bcc)?).await?;
  let item_id = read_created(&xml)?.ok_or_else(|| EwsError::Parse("The server saved the draft with no id.".into()))?;
  if let Some(old) = replaces.filter(|old| !old.trim().is_empty() && *old != item_id) {
    if let Err(err) = delete_draft(client, old, false).await {
      log::warn!("ews: the old version of a draft was not deleted: {err}");
    }
  }
  Ok(SavedDraft { item_id })
}

pub async fn delete_draft(client: &EwsClient, item_id: &str, discard: bool) -> EwsResult<()> {
  read_deleted(&client.call_many(&delete_draft_request(item_id, discard)?).await?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Sent {
  pub sent: bool,
}

pub async fn send(client: &EwsClient, mime_base64: &str, bcc: &[String]) -> EwsResult<Sent> {
  let xml = client.call(&send_request(mime_base64, bcc)?).await?;
  read_created(&xml)?;
  Ok(Sent { sent: true })
}

/// The commands. Registered with the `exchange` feature.
pub mod commands {
  use super::*;

  /// Send one MIME message (base64), and keep a copy in Sent Items.
  #[tauri::command]
  pub async fn mail_ews_send(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    mime: String,
    bcc: Vec<String>,
  ) -> Result<Sent, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    send(&client, &mime, &bcc).await.map_err(|e| e.to_string())
  }

  /// Save the server copy of a draft into Drafts. With `replaces`, the
  /// version saved before is deleted after (soft).
  #[tauri::command]
  pub async fn mail_ews_save_draft(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    mime: String,
    bcc: Vec<String>,
    replaces: Option<String>,
  ) -> Result<SavedDraft, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    save_draft(&client, &mime, &bcc, replaces.as_deref()).await.map_err(|e| e.to_string())
  }

  /// Delete one draft: to Deleted Items with `discard`, else soft.
  #[tauri::command]
  pub async fn mail_ews_delete_draft(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_id: String,
    discard: bool,
  ) -> Result<(), String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    // The page shows the reason too, but only the log keeps it.
    delete_draft(&client, &item_id, discard).await.map_err(|e| {
      log::warn!("ews: the server did not delete a draft (discard: {discard}): {e}");
      e.to_string()
    })
  }
}

#[cfg(test)]
#[path = "ews_send_tests.rs"]
mod tests;
