//! The read path of an Exchange account: the folder list, the changes in a
//! folder, the bodies, and one attachment.
//!
//! Each command makes the EWS calls with the account's client (`ews.rs`),
//! and reads the answers with `ews_ops.rs`. The folder list and the changes
//! go back to the worker in the interface (`lib/mail/exchange-sync.ts`) as
//! JSON, and the worker writes the rows. A body is written to the store
//! here, as `mail_sync_fetch_bodies` does for Gmail, because the MIME can be
//! large and `mime.rs` is here.
//!
//! Phase 2 reads only. Nothing here changes the mailbox on the server.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::db::MailDb;
use crate::ews::{EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_ops::{self, FolderInfo, ItemRow};
use crate::messages::BodyRow;
use crate::secrets::Secrets;

/// More pages than this in one `SyncFolderHierarchy` means that something
/// is wrong. A mailbox has a few hundred folders, and one page holds all.
const MAX_HIERARCHY_PAGES: usize = 20;

/// The folder list, as `mail_ews_sync_hierarchy` returns it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hierarchy {
  /// The mail folders that are new or changed since the sync state.
  pub folders: Vec<FolderInfo>,
  /// The ids of folders that went.
  pub deleted: Vec<String>,
  /// On the first call only: the id of each well-known folder, by its EWS
  /// name (`inbox`, `sentitems`, ...).
  pub well_known: Option<BTreeMap<String, String>>,
  pub sync_state: String,
}

/// One page of changes in a folder, as `mail_ews_sync_items` returns it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsPage {
  /// The rows of the created and changed items, and of the items whose read
  /// flag changed.
  pub items: Vec<ItemRow>,
  pub deleted: Vec<String>,
  pub sync_state: String,
  pub last_page: bool,
  /// Changed items whose row the copy already has as it is now: they came
  /// with the newest items, with the same change key. Not read again, and
  /// counted for the read's progress.
  pub kept: Vec<String>,
}

/// The newest items of a folder, as `mail_ews_newest_items` returns them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewestItems {
  /// Their rows, newest first.
  pub items: Vec<ItemRow>,
  /// The change key of each, for `mail_ews_sync_items` to know them by.
  pub keys: BTreeMap<String, String>,
}

/// The newest `count` items of a folder, with their rows.
pub async fn newest_items(client: &EwsClient, folder_id: &str, count: usize) -> EwsResult<NewestItems> {
  if folder_id.trim().is_empty() {
    return Err(EwsError::Invalid("No folder was given.".into()));
  }
  let found = ews_ops::read_newest(&client.call(&ews_ops::newest_request(folder_id, count)?).await?)?;
  let ids: Vec<String> = found.iter().map(|(id, _)| id.clone()).collect();
  let keys = found.into_iter().filter_map(|(id, key)| key.map(|k| (id, k))).collect();
  let mut items = Vec::with_capacity(ids.len());
  for batch in ews_ops::batches(&ids) {
    let xml = client.call_many(&ews_ops::rows_request(batch)?).await?;
    items.extend(ews_ops::read_rows(&xml)?);
  }
  Ok(NewestItems { items, keys })
}

/// The folder changes since `sync_state`, or every mail folder when there is
/// none.
pub async fn sync_hierarchy(client: &EwsClient, sync_state: Option<String>) -> EwsResult<Hierarchy> {
  let first = sync_state.is_none();
  let mut state = sync_state;
  let mut changed: Vec<String> = Vec::new();
  let mut deleted: Vec<String> = Vec::new();
  for _ in 0..MAX_HIERARCHY_PAGES {
    let page = ews_ops::read_hierarchy(&client.call(&ews_ops::hierarchy_request(state.clone())?).await?)?;
    for id in page.changed {
      deleted.retain(|d| d != &id);
      if !changed.contains(&id) {
        changed.push(id);
      }
    }
    for id in page.deleted {
      changed.retain(|c| c != &id);
      deleted.push(id);
    }
    state = Some(page.sync_state);
    if page.last {
      let folders = folders_of(client, &changed).await?;
      let well_known = if first { Some(well_known(client).await?) } else { None };
      return Ok(Hierarchy { folders, deleted, well_known, sync_state: state.unwrap_or_default() });
    }
  }
  Err(EwsError::Parse(format!("SyncFolderHierarchy did not end after {MAX_HIERARCHY_PAGES} pages.")))
}

/// Names, classes, parents, and counts, in batches of 10. Mail folders only.
async fn folders_of(client: &EwsClient, ids: &[String]) -> EwsResult<Vec<FolderInfo>> {
  let mut out = Vec::new();
  for batch in ews_ops::batches(ids) {
    let xml = client.call_many(&ews_ops::folders_request(batch)?).await?;
    out.extend(ews_ops::read_folders(&xml)?.into_iter().filter(ews_ops::is_mail_folder));
  }
  Ok(out)
}

async fn well_known(client: &EwsClient) -> EwsResult<BTreeMap<String, String>> {
  let xml = client.call_many(&ews_ops::well_known_request()?).await?;
  Ok(ews_ops::read_well_known(&xml)?.into_iter().collect())
}

/// One page of changes in a folder, with the rows of the changed items.
///
/// `known` holds the change keys of rows the copy has as they are now (the
/// newest items, read first). Those are not read again.
pub async fn sync_items(
  client: &EwsClient,
  folder_id: &str,
  sync_state: Option<String>,
  known: &BTreeMap<String, String>,
) -> EwsResult<ItemsPage> {
  if folder_id.trim().is_empty() {
    return Err(EwsError::Invalid("No folder was given.".into()));
  }
  let page = ews_ops::read_items_page(&client.call(&ews_ops::items_request(folder_id, sync_state)?).await?)?;
  let (kept, to_read) = split_known(&page, known);
  let mut items = Vec::with_capacity(to_read.len());
  for batch in ews_ops::batches(&to_read) {
    let xml = client.call_many(&ews_ops::rows_request(batch)?).await?;
    items.extend(ews_ops::read_rows(&xml)?);
  }
  Ok(ItemsPage { items, deleted: page.deleted, sync_state: page.sync_state, last_page: page.last, kept })
}

/// The changed items the copy already has as they are (same change key),
/// and the rest, which are read.
pub(crate) fn split_known(page: &ews_ops::ItemsPage, known: &BTreeMap<String, String>) -> (Vec<String>, Vec<String>) {
  page
    .changed
    .iter()
    .cloned()
    .partition(|id| matches!((known.get(id), page.change_keys.get(id)), (Some(a), Some(b)) if a == b))
}

/// The raw message of each item, in batches of 10, in the order asked.
pub(crate) async fn raw_messages(client: &EwsClient, ids: &[String]) -> EwsResult<Vec<(String, Option<Vec<u8>>)>> {
  let mut out = Vec::with_capacity(ids.len());
  for batch in ews_ops::batches(ids) {
    let xml = client.call_many(&ews_ops::mime_request(batch)?).await?;
    out.extend(ews_ops::read_mime(&xml, batch)?);
  }
  Ok(out)
}

/// Read each message's body out of its MIME and keep it. Returns how many
/// were kept. A message the server did not give is marked as skipped, so
/// the thread view does not ask for it again and again.
pub fn keep_bodies(db: &MailDb, account: &str, raw: Vec<(String, Option<Vec<u8>>)>) -> usize {
  let mut kept = 0;
  for (id, message) in raw {
    let Some(message) = message else {
      let _ = db.messages_body_skipped(account, &id);
      continue;
    };
    let parsed = crate::mime::parse_message(&message);
    let body = BodyRow {
      text: parsed.text,
      html: parsed.html,
      inline_images: serde_json::to_value(&parsed.inline_images).unwrap_or(json!({})),
      attachments: serde_json::to_value(&parsed.attachments).unwrap_or(json!([])),
    };
    match db.bodies_put(account, &id, &body) {
      Ok(()) => kept += 1,
      Err(e) => log::warn!("[mail-ews] {account}: could not keep a body: {e}"),
    }
  }
  kept
}

/// One attachment, by the section `mime::parse_message` gave it.
pub async fn fetch_part(client: &EwsClient, item_id: &str, section: &str) -> EwsResult<Value> {
  if section.is_empty() || !section.chars().all(|c| c.is_ascii_digit() || c == '.') {
    return Err(EwsError::Invalid("The part name is not a MIME section.".into()));
  }
  let raw = raw_messages(client, &[item_id.to_string()]).await?;
  let message = raw
    .into_iter()
    .next()
    .and_then(|(_, m)| m)
    .ok_or_else(|| EwsError::Invalid("The server did not give this message.".into()))?;
  let (bytes, mime_type, filename) = crate::mime::part_by_section(&message, section)
    .ok_or_else(|| EwsError::Invalid("The message has no such part.".into()))?;
  Ok(json!({
    "bytesBase64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes),
    "mimeType": mime_type,
    "filename": filename,
  }))
}

/// The whole MIME of one item, base64, for Show original (section 16.1).
/// Exchange makes it again from what it keeps: it is not always the bytes
/// that arrived.
pub async fn fetch_source(client: &EwsClient, item_id: &str) -> EwsResult<String> {
  let raw = raw_messages(client, &[item_id.to_string()]).await?;
  let message = raw
    .into_iter()
    .next()
    .and_then(|(_, m)| m)
    .ok_or_else(|| EwsError::Invalid("The server did not give this message.".into()))?;
  Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &message))
}

fn normalize(account: &str) -> String {
  account.trim().to_lowercase()
}

/// The commands of the read path. Registered with the `exchange` feature.
pub mod commands {
  use super::*;

  /// The folder changes since `syncState`, or every mail folder when it is
  /// empty. On the first call, also the ids of the well-known folders.
  #[tauri::command]
  pub async fn mail_ews_sync_hierarchy(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    sync_state: Option<String>,
  ) -> Result<Hierarchy, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    let state = sync_state.filter(|s| !s.is_empty());
    sync_hierarchy(&client, state).await.map_err(|e| e.to_string())
  }

  /// One page of changes in a folder, with the rows of the changed items.
  #[tauri::command]
  pub async fn mail_ews_sync_items(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    folder_id: String,
    sync_state: Option<String>,
    known: Option<BTreeMap<String, String>>,
  ) -> Result<ItemsPage, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    let state = sync_state.filter(|s| !s.is_empty());
    sync_items(&client, &folder_id, state, &known.unwrap_or_default()).await.map_err(|e| e.to_string())
  }

  /// The newest `count` items of a folder (at most 500), newest first, for
  /// the start of a first read.
  #[tauri::command]
  pub async fn mail_ews_newest_items(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    folder_id: String,
    count: usize,
  ) -> Result<NewestItems, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    newest_items(&client, &folder_id, count.clamp(1, 500)).await.map_err(|e| e.to_string())
  }

  /// Get the bodies of these items and keep them in the store. Returns how
  /// many were kept.
  #[tauri::command]
  pub async fn mail_ews_fetch_bodies(
    app: AppHandle,
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_ids: Vec<String>,
  ) -> Result<usize, String> {
    let email = normalize(&account);
    if item_ids.is_empty() {
      return Ok(0);
    }
    let client = accounts.client(&secrets, &email).map_err(|e| e.to_string())?;
    let raw = raw_messages(&client, &item_ids).await.map_err(|e| e.to_string())?;
    // Parsing a large message takes time: off the async threads.
    tauri::async_runtime::spawn_blocking(move || {
      let db = app.state::<MailDb>();
      let kept = keep_bodies(&db, &email, raw);
      log::info!("[mail-ews] {email}: kept {kept} bodies on demand");
      kept
    })
    .await
    .map_err(|e| e.to_string())
  }

  /// The names and counts of these folders, as the server has them now.
  /// For the worker, after a folder pass that brought changes (section
  /// 12.3), so the rail does not wait for the 5-minute pass.
  #[tauri::command]
  pub async fn mail_ews_folder_counts(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    folder_ids: Vec<String>,
  ) -> Result<Vec<FolderInfo>, String> {
    if folder_ids.is_empty() {
      return Ok(Vec::new());
    }
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    folders_of(&client, &folder_ids).await.map_err(|e| e.to_string())
  }

  /// One attachment of an item: the bytes, base64, with its type and name.
  #[tauri::command]
  pub async fn mail_ews_fetch_part(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_id: String,
    section: String,
  ) -> Result<Value, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    fetch_part(&client, &item_id, &section).await.map_err(|e| e.to_string())
  }

  /// The whole message of an item, base64, for Show original.
  #[tauri::command]
  pub async fn mail_ews_fetch_source(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    item_id: String,
  ) -> Result<String, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    fetch_source(&client, &item_id).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_read_tests.rs"]
mod tests;
