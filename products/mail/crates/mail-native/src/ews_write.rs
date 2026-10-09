//! The writes of an Exchange account: read and unread, flag, move, and
//! delete forever (phase 3 of `docs/mail-exchange-ews.md`, section 12).
//!
//! Each command takes item ids, sends 10 items for each call (as the reads
//! do), and answers for each id. The interface decides which items of a
//! thread an action is about (`lib/mail/exchange-actions.ts`), and then
//! changes the local copy.
//!
//! Delete forever is `DeleteItem` with `HardDelete`, for the ids the reader
//! picked and no others. The transport refuses a request that empties or
//! deletes a folder, or deletes with no item named (`guard_request` in
//! ews.rs).

use serde::Serialize;

use ews::delete_item::{DeleteItem, DeleteItemResponse};
use ews::move_item::{MoveItem, MoveItemResponse};
use ews::update_item::{
  ConflictResolution, ItemChange, ItemChangeDescription, ItemChangeInner, UpdateItem, UpdateItemResponse, Updates,
};
use ews::{
  BaseFolderId, BaseItemId, CopyMoveItemData, DeleteType, Message, MessageDisposition, OperationResponse,
  PathToElement, ResponseClass,
};

use crate::ews::{EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_ops::{self, document, message_error, read};
use crate::secrets::Secrets;

/// One id the server did not change, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure {
  pub id: String,
  pub error: String,
}

/// The answer to a change: the ids done, and the ids that failed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Changed {
  pub done: Vec<String>,
  pub failed: Vec<Failure>,
}

/// One moved item: its id before, and its id now. `new_id` is null for an
/// item that was already gone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
  pub id: String,
  pub new_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct MoveResult {
  pub moved: Vec<Moved>,
  pub failed: Vec<Failure>,
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

fn item_id(id: &str) -> BaseItemId {
  BaseItemId::ItemId { id: id.to_string(), change_key: None }
}

/// Ids must be named, and none may be empty: a request with no item is not
/// sent.
fn check_ids(ids: &[String]) -> EwsResult<()> {
  if ids.is_empty() || ids.iter().any(|id| id.trim().is_empty()) {
    return Err(EwsError::Invalid("No item was named. Nothing was sent to the server.".into()));
  }
  Ok(())
}

/// `UpdateItem` with one field on each item. Save only: the items are not
/// sent. `AlwaysOverwrite`, because the app keeps no change key.
fn update_request(ids: &[String], field: &str, message: Message) -> EwsResult<String> {
  check_ids(ids)?;
  let changes = ids
    .iter()
    .map(|id| ItemChange {
      item_change: ItemChangeInner {
        item_id: item_id(id),
        updates: Updates {
          inner: vec![ItemChangeDescription::SetItemField {
            field_uri: PathToElement::FieldURI { field_URI: field.to_string() },
            message: message.clone(),
          }],
        },
      },
    })
    .collect();
  document(UpdateItem {
    message_disposition: MessageDisposition::SaveOnly,
    // AlwaysOverwrite, as Thunderbird does for read and flag: the reader's
    // latest wish wins. The app keeps no ChangeKey, and without one the KU
    // server refuses AutoResolve (ErrorChangeKeyRequiredForWriteOperations).
    conflict_resolution: Some(ConflictResolution::AlwaysOverwrite),
    item_changes: changes,
  })
}

pub fn read_flag_request(ids: &[String], is_read: bool) -> EwsResult<String> {
  update_request(ids, "message:IsRead", Message { is_read: Some(is_read), ..Default::default() })
}

/// `UpdateItem` on `item:Flag`, written by hand.
///
/// The one request here not written with the `ews` crate. The crate writes
/// the flag's children with no prefix (`<t:Flag><FlagStatus>`), which puts
/// them in the messages namespace, and the schema refuses that. The rest of
/// the request is the same as `update_request` writes.
pub fn flag_request(ids: &[String], flagged: bool) -> EwsResult<String> {
  check_ids(ids)?;
  let status = if flagged { "Flagged" } else { "NotFlagged" };
  let changes: String = ids
    .iter()
    .map(|id| {
      format!(
        concat!(
          r#"<t:ItemChange><t:ItemId Id="{id}"/><t:Updates><t:SetItemField><t:FieldURI FieldURI="item:Flag"/>"#,
          r#"<t:Message><t:Flag><t:FlagStatus>{status}</t:FlagStatus></t:Flag></t:Message>"#,
          r#"</t:SetItemField></t:Updates></t:ItemChange>"#
        ),
        id = xml_attr(id),
        status = status
      )
    })
    .collect();
  Ok(format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="{t}">"#,
      r#"<soap:Header><t:RequestServerVersion Version="{version}"/></soap:Header><soap:Body>"#,
      r#"<UpdateItem xmlns="{m}" MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite">"#,
      r#"<ItemChanges>{changes}</ItemChanges></UpdateItem></soap:Body></soap:Envelope>"#
    ),
    t = TYPES_NS,
    m = MESSAGES_NS,
    version = crate::ews::REQUEST_SERVER_VERSION,
    changes = changes
  ))
}

const TYPES_NS: &str = "http://schemas.microsoft.com/exchange/services/2006/types";
const MESSAGES_NS: &str = "http://schemas.microsoft.com/exchange/services/2006/messages";

/// A value for an XML attribute in double quotes.
fn xml_attr(value: &str) -> String {
  value.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn move_request(ids: &[String], to_folder: &str) -> EwsResult<String> {
  check_ids(ids)?;
  if to_folder.trim().is_empty() {
    return Err(EwsError::Invalid("No folder was named. Nothing was sent to the server.".into()));
  }
  document(MoveItem {
    inner: CopyMoveItemData {
      to_folder_id: BaseFolderId::FolderId { id: to_folder.to_string(), change_key: None },
      item_ids: ids.iter().map(|id| item_id(id)).collect(),
      return_new_item_ids: Some(true),
    },
  })
}

/// `DeleteItem` with `HardDelete`: gone, not to Deleted Items. Only for
/// the items named, and never with none.
pub fn delete_request(ids: &[String]) -> EwsResult<String> {
  check_ids(ids)?;
  document(DeleteItem {
    delete_type: DeleteType::HardDelete,
    send_meeting_cancellations: None,
    affected_task_occurrences: None,
    suppress_read_receipts: Some(true),
    item_ids: ids.iter().map(|id| item_id(id)).collect(),
  })
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/// An item that is already gone is not a failure: the change it asked for
/// cannot matter any more, and the next sync removes its row.
fn gone(error: &ews::response::ResponseError) -> bool {
  format!("{:?}", error.response_code) == "ErrorItemNotFound"
}

/// Each id against its message, in the order of the request.
fn changed_from<R: OperationResponse>(xml: &str, ids: &[String]) -> EwsResult<Changed> {
  let messages = read::<R>(xml)?;
  let mut out = Changed::default();
  for (index, id) in ids.iter().enumerate() {
    match messages.get(index) {
      Some(ResponseClass::Success(_)) | Some(ResponseClass::Warning(_)) => out.done.push(id.clone()),
      Some(ResponseClass::Error(e)) if gone(e) => out.done.push(id.clone()),
      Some(ResponseClass::Error(e)) => out.failed.push(Failure { id: id.clone(), error: message_error(e).to_string() }),
      None => out.failed.push(Failure { id: id.clone(), error: "ews:parse: The server did not answer for this item.".into() }),
    }
  }
  Ok(out)
}

pub fn read_update(xml: &str, ids: &[String]) -> EwsResult<Changed> {
  changed_from::<UpdateItemResponse>(xml, ids)
}

pub fn read_delete(xml: &str, ids: &[String]) -> EwsResult<Changed> {
  changed_from::<DeleteItemResponse>(xml, ids)
}

pub fn read_move(xml: &str, ids: &[String]) -> EwsResult<MoveResult> {
  let messages = read::<MoveItemResponse>(xml)?;
  let mut out = MoveResult::default();
  for (index, id) in ids.iter().enumerate() {
    match messages.get(index) {
      Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => {
        let new_id = m.items.inner.first().and_then(|i| i.inner_message().item_id.as_ref()).map(|i| i.id.clone());
        out.moved.push(Moved { id: id.clone(), new_id });
      }
      Some(ResponseClass::Error(e)) if gone(e) => out.moved.push(Moved { id: id.clone(), new_id: None }),
      Some(ResponseClass::Error(e)) => out.failed.push(Failure { id: id.clone(), error: message_error(e).to_string() }),
      None => out.failed.push(Failure { id: id.clone(), error: "ews:parse: The server did not answer for this item.".into() }),
    }
  }
  Ok(out)
}

// ---------------------------------------------------------------------------
// Calls, 10 items at a time
// ---------------------------------------------------------------------------

pub async fn set_read(client: &EwsClient, ids: &[String], is_read: bool) -> EwsResult<Changed> {
  check_ids(ids)?;
  let mut out = Changed::default();
  for batch in ews_ops::batches(ids) {
    let part = read_update(&client.call_many(&read_flag_request(batch, is_read)?).await?, batch)?;
    out.done.extend(part.done);
    out.failed.extend(part.failed);
  }
  Ok(out)
}

pub async fn set_flag(client: &EwsClient, ids: &[String], flagged: bool) -> EwsResult<Changed> {
  check_ids(ids)?;
  let mut out = Changed::default();
  for batch in ews_ops::batches(ids) {
    let part = read_update(&client.call_many(&flag_request(batch, flagged)?).await?, batch)?;
    out.done.extend(part.done);
    out.failed.extend(part.failed);
  }
  Ok(out)
}

pub async fn move_items(client: &EwsClient, ids: &[String], to_folder: &str) -> EwsResult<MoveResult> {
  check_ids(ids)?;
  let mut out = MoveResult::default();
  for batch in ews_ops::batches(ids) {
    let part = read_move(&client.call_many(&move_request(batch, to_folder)?).await?, batch)?;
    out.moved.extend(part.moved);
    out.failed.extend(part.failed);
  }
  Ok(out)
}

pub async fn delete_forever(client: &EwsClient, ids: &[String]) -> EwsResult<Changed> {
  check_ids(ids)?;
  let mut out = Changed::default();
  for batch in ews_ops::batches(ids) {
    let part = read_delete(&client.call_many(&delete_request(batch)?).await?, batch)?;
    out.done.extend(part.done);
    out.failed.extend(part.failed);
  }
  Ok(out)
}

/// The commands. Registered with the `exchange` feature.
pub mod commands {
  use super::*;

  /// Mark items read or unread.
  #[tauri::command]
  pub async fn mail_ews_set_read(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_ids: Vec<String>,
    is_read: bool,
  ) -> Result<Changed, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    set_read(&client, &item_ids, is_read).await.map_err(|e| e.to_string())
  }

  /// Flag or unflag items.
  #[tauri::command]
  pub async fn mail_ews_set_flag(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_ids: Vec<String>,
    flagged: bool,
  ) -> Result<Changed, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    set_flag(&client, &item_ids, flagged).await.map_err(|e| e.to_string())
  }

  /// Move items to a folder. Answers the new id of each item.
  #[tauri::command]
  pub async fn mail_ews_move(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_ids: Vec<String>,
    to_folder_id: String,
  ) -> Result<MoveResult, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    move_items(&client, &item_ids, &to_folder_id).await.map_err(|e| e.to_string())
  }

  /// Delete these items for good. Only the items named, never a folder.
  #[tauri::command]
  pub async fn mail_ews_delete_forever(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_ids: Vec<String>,
  ) -> Result<Changed, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    delete_forever(&client, &item_ids).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_write_tests.rs"]
mod tests;
