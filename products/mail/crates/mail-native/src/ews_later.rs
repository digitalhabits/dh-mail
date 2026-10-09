//! Messages an Exchange account's server holds for a time (section 16.4 of
//! `docs/mail-exchange-ews.md`), with the deferred send time
//! (`PidTagDeferredSendTime`, 0x3FEF) on them.
//!
//! The app does not send later from Exchange. On Exchange 2019 (KU,
//! 2026-09-27) a held message cannot be cancelled: `MoveItem` answers
//! `ErrorMoveCopyFailed` in Outbox and in Sent Items, and a delete in the
//! webmail does not stop it (section 17.1). But another client can leave
//! one, so the list reads Outbox and Sent Items, and keeps the messages
//! whose send time is still to come. Cancel moves the message to Drafts and
//! takes the time off it. Send now does that, and then sends the draft. The
//! `ews` crate 0.1.1 has neither `DeleteItemField` nor `SendItem`, so those
//! two requests are written by hand (ews_xml.rs).

use serde::Serialize;

use ews::find_item::{FindItem, FindItemResponse, Traversal};
use ews::move_item::{MoveItem, MoveItemResponse};
use ews::update_item::UpdateItemResponse;
use ews::{
  BasePoint, BaseItemId, BaseShape, CopyMoveItemData, ItemShape, PathToElement, PropertyType, ResponseClass, View,
};

use crate::ews::{EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_ops::{self, distinguished, document, message_error, read, ItemRow};
use crate::ews_xml::{envelope, escape, MESSAGES_NS};
use crate::secrets::Secrets;

const DEFERRED_SEND_TIME: &str = "0x3FEF";

/// The most held messages one list reads.
const MAX_HELD: usize = 50;

/// `FindItem` on Outbox, with the send time of each message.
pub fn held_request() -> EwsResult<String> {
  document(FindItem {
    traversal: Traversal::Shallow,
    item_shape: ItemShape {
      base_shape: BaseShape::IdOnly,
      include_mime_content: None,
      additional_properties: Some(vec![PathToElement::ExtendedFieldURI {
        distinguished_property_set_id: None,
        property_set_id: None,
        property_tag: Some(DEFERRED_SEND_TIME.into()),
        property_name: None,
        property_id: None,
        property_type: PropertyType::SystemTime,
      }]),
    },
    view: Some(View::IndexedPageItemView { max_entries_returned: Some(MAX_HELD), base_point: BasePoint::Beginning, offset: 0 }),
    parent_folder_ids: vec![distinguished("outbox"), distinguished("sentitems")],
  })
}

/// One held message: its id, its send time, and whether the app can take
/// it back. Only a message in Outbox can be: on Exchange 2019 (KU,
/// 2026-09-27) one in Sent Items is the server's, and `MoveItem` refuses it
/// with `ErrorMoveCopyFailed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeldTime {
  pub id: String,
  pub send_at: String,
  pub cancellable: bool,
}

/// Each message in Outbox or Sent Items whose send time is after `now`
/// (UTC, `YYYY-MM-DDTHH:MM:SSZ`). A sent message keeps its time, so a time
/// that has passed is a message that went.
pub fn read_held(xml: &str, now: &str) -> EwsResult<Vec<HeldTime>> {
  let mut out = Vec::new();
  let mut found = 0;
  // One answer for each folder asked, in the order of the request: Outbox,
  // then Sent Items.
  for (folder, message) in read::<FindItemResponse>(xml)?.into_iter().enumerate() {
    let message = match message {
      ResponseClass::Success(m) | ResponseClass::Warning(m) => m,
      ResponseClass::Error(e) => return Err(message_error(&e)),
    };
    found += message.root_folder.items.inner.len();
    for item in &message.root_folder.items.inner {
      let m = item.inner_message();
      let Some(id) = m.item_id.as_ref().map(|i| i.id.clone()) else { continue };
      let at = m.extended_property.iter().flatten().find(|p| {
        p.extended_field_URI.property_tag.as_deref().is_some_and(|t| t.eq_ignore_ascii_case(DEFERRED_SEND_TIME))
      });
      if let Some(at) = at.filter(|at| utc_second(&at.value) > now.to_string()) {
        out.push(HeldTime { id, send_at: at.value.clone(), cancellable: folder == 0 });
      }
    }
  }
  // Counts only: how many were read, and how many are still to go.
  log::info!("ews: {found} message(s) read in Outbox and Sent Items, {} held", out.len());
  Ok(out)
}

/// A server time cut to `YYYY-MM-DDTHH:MM:SSZ`, so text order is time order.
fn utc_second(at: &str) -> String {
  let base: String = at.chars().take(19).collect();
  format!("{base}Z")
}

/// Now, in UTC, as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn now_utc() -> String {
  let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
  let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
  // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
  let z = days + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = doy - (153 * mp + 2) / 5 + 1;
  let month = if mp < 10 { mp + 3 } else { mp - 9 };
  let year = yoe + era * 400 + i64::from(month <= 2);
  format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rest / 3_600, rest % 3_600 / 60, rest % 60)
}

/// A message the server holds, as the interface lists it. The body is for
/// Edit, which puts it back in the composer; the preview has 255 characters
/// only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Held {
  pub send_at: String,
  /// False when the server has it and the app cannot take it back: the
  /// interface then offers no Cancel, Send now, or Edit.
  pub cancellable: bool,
  #[serde(flatten)]
  pub row: ItemRow,
  pub text: Option<String>,
  pub html: Option<String>,
}

/// The largest held message whose body is read for the list. A larger one
/// has its preview only.
const MAX_BODY_BYTES: u64 = crate::ews_bodies::MAX_ITEM_BYTES as u64;

/// The text and the HTML of each message, from its MIME.
async fn bodies(client: &EwsClient, rows: &[ItemRow]) -> EwsResult<Vec<(String, crate::mime::ParsedMessage)>> {
  let ids: Vec<String> = rows.iter().filter(|r| r.size.unwrap_or(0) <= MAX_BODY_BYTES).map(|r| r.id.clone()).collect();
  if ids.is_empty() {
    return Ok(Vec::new());
  }
  let raw = crate::ews_read::raw_messages(client, &ids).await?;
  Ok(raw.into_iter().filter_map(|(id, m)| Some((id, crate::mime::parse_message(&m?)))).collect())
}

pub async fn held(client: &EwsClient) -> EwsResult<Vec<Held>> {
  held_at(client, &now_utc()).await
}

/// The held messages, with `now` given: the tests fix it.
pub async fn held_at(client: &EwsClient, now: &str) -> EwsResult<Vec<Held>> {
  let times = read_held(&client.call(&held_request()?).await?, now)?;
  if times.is_empty() {
    return Ok(Vec::new());
  }
  let ids: Vec<String> = times.iter().map(|t| t.id.clone()).collect();
  let mut rows = Vec::new();
  for batch in ews_ops::batches(&ids) {
    rows.extend(ews_ops::read_rows(&client.call_many(&ews_ops::rows_request(batch)?).await?)?);
  }
  let mut parsed = bodies(client, &rows).await?;
  let mut out: Vec<Held> = rows
    .into_iter()
    .filter_map(|row| {
      let time = times.iter().find(|t| t.id == row.id)?;
      let (at, cancellable) = (time.send_at.clone(), time.cancellable);
      let body = parsed.iter().position(|(id, _)| *id == row.id).map(|i| parsed.swap_remove(i).1);
      let (text, html) = body.map(|b| (b.text, b.html)).unwrap_or((None, None));
      Some(Held { send_at: at, cancellable, row, text, html })
    })
    .collect();
  out.sort_by(|a, b| a.send_at.cmp(&b.send_at));
  Ok(out)
}

fn move_to_drafts_request(item_id: &str) -> EwsResult<String> {
  document(MoveItem {
    inner: CopyMoveItemData {
      to_folder_id: distinguished("drafts"),
      item_ids: vec![BaseItemId::ItemId { id: item_id.to_string(), change_key: None }],
      return_new_item_ids: Some(true),
    },
  })
}

/// `UpdateItem` that takes the send time off, written by hand: the crate
/// has no `DeleteItemField`. `AlwaysOverwrite`, as KU wants with no
/// `ChangeKey` (section 15.1).
pub fn clear_time_request(item_id: &str) -> String {
  envelope(&format!(
    concat!(
      r#"<UpdateItem xmlns="{m}" MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite">"#,
      r#"<ItemChanges><t:ItemChange><t:ItemId Id="{id}"/><t:Updates><t:DeleteItemField>"#,
      r#"<t:ExtendedFieldURI PropertyTag="{tag}" PropertyType="SystemTime"/>"#,
      r#"</t:DeleteItemField></t:Updates></t:ItemChange></ItemChanges></UpdateItem>"#
    ),
    m = MESSAGES_NS,
    id = escape(item_id),
    tag = DEFERRED_SEND_TIME
  ))
}

/// `SendItem` for one draft, written by hand: the crate has none. The
/// `ChangeKey` is the one the last change gave.
pub fn send_item_request(item_id: &str, change_key: &str) -> EwsResult<String> {
  if item_id.trim().is_empty() || change_key.trim().is_empty() {
    return Err(EwsError::Invalid("The draft has no id or change key. Nothing was sent to the server.".into()));
  }
  Ok(envelope(&format!(
    concat!(
      r#"<SendItem xmlns="{m}" SaveItemToFolder="true"><ItemIds><t:ItemId Id="{id}" ChangeKey="{key}"/></ItemIds>"#,
      r#"<SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></SavedItemFolderId></SendItem>"#
    ),
    m = MESSAGES_NS,
    id = escape(item_id),
    key = escape(change_key)
  )))
}

/// The new id of the moved item.
fn read_moved(xml: &str) -> EwsResult<String> {
  match read::<MoveItemResponse>(xml)?.into_iter().next() {
    Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => m
      .items
      .inner
      .first()
      .and_then(|i| i.inner_message().item_id.as_ref())
      .map(|i| i.id.clone())
      .ok_or_else(|| EwsError::Parse("The server moved the message and gave no new id.".into())),
    Some(ResponseClass::Error(e)) => Err(message_error(&e)),
    None => Err(EwsError::Parse("The answer to MoveItem has no response message.".into())),
  }
}

/// The id and the change key after an update.
fn read_changed(xml: &str) -> EwsResult<(String, String)> {
  match read::<UpdateItemResponse>(xml)?.into_iter().next() {
    Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => m
      .items
      .inner
      .first()
      .and_then(|i| i.inner_message().item_id.as_ref())
      .and_then(|i| Some((i.id.clone(), i.change_key.clone()?)))
      .ok_or_else(|| EwsError::Parse("The server changed the draft and gave no change key.".into())),
    Some(ResponseClass::Error(e)) => Err(message_error(&e)),
    None => Err(EwsError::Parse("The answer to UpdateItem has no response message.".into())),
  }
}

/// The draft a cancel leaves, and its change key if the time came off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cancelled {
  pub item_id: String,
  #[serde(skip)]
  pub change_key: Option<String>,
}

/// Move the held message to Drafts, then take the time off. A failed clear
/// is written to the log: the message is safe in Drafts.
pub async fn cancel(client: &EwsClient, item_id: &str) -> EwsResult<Cancelled> {
  if item_id.trim().is_empty() {
    return Err(EwsError::Invalid("No message was named. Nothing was sent to the server.".into()));
  }
  let moved = read_moved(&client.call(&move_to_drafts_request(item_id)?).await?)?;
  match client.call(&clear_time_request(&moved)).await.and_then(|xml| read_changed(&xml)) {
    Ok((id, key)) => Ok(Cancelled { item_id: id, change_key: Some(key) }),
    Err(err) => {
      log::warn!("ews: a cancelled message is in Drafts, but its send time did not come off: {err}");
      Ok(Cancelled { item_id: moved, change_key: None })
    }
  }
}

/// Cancel, then send the draft now.
pub async fn send_now(client: &EwsClient, item_id: &str) -> EwsResult<()> {
  let draft = cancel(client, item_id).await?;
  let key = draft.change_key.ok_or_else(|| {
    EwsError::Invalid("The message is in Drafts, but it still has its send time. Send it from Drafts.".into())
  })?;
  client.call(&send_item_request(&draft.item_id, &key)?).await?;
  Ok(())
}

pub mod commands {
  use super::*;

  #[tauri::command]
  pub async fn mail_ews_held(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<Vec<Held>, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    held(&client).await.map_err(|e| {
      // The interface shows no Outbox group on an error, so it is logged here.
      log::warn!("ews: the held list failed: {e}");
      e.to_string()
    })
  }

  /// Keep a held message as a draft, and never send it.
  #[tauri::command]
  pub async fn mail_ews_cancel_held(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_id: String,
  ) -> Result<Cancelled, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    cancel(&client, &item_id).await.map_err(|e| e.to_string())
  }

  /// Send a held message now.
  #[tauri::command]
  pub async fn mail_ews_send_held_now(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_id: String,
  ) -> Result<(), String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    send_now(&client, &item_id).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_later_tests.rs"]
mod tests;
