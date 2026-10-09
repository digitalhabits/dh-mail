//! The EWS requests and answers of the read path, written and read with the
//! `ews` crate.
//!
//! The `ews` crate is Thunderbird's set of EWS types (MPL-2.0, used without
//! changes). This module builds each request as a document, and reads each
//! answer into plain types that the commands in `ews_read.rs` return as JSON.
//! Nothing here touches the network, so every function is tested with the
//! fixtures in `ews_fixtures.rs`, which follow what the KU server sends.
//!
//! The order of work follows Thunderbird:
//!
//! 1. `SyncFolderHierarchy` with `IdOnly`, then `GetFolder` in batches of 10
//!    for the names, the classes, and the counts.
//! 2. `SyncFolderItems` with `IdOnly`, 256 changes for each page.
//! 3. `GetItem` with a property list for the rows, 10 items for each call.
//! 4. `GetItem` with `MimeContent` for a body.

use base64::Engine;
use serde::Serialize;

use ews::get_folder::{GetFolder, GetFolderResponse};
use ews::get_item::{GetItem, GetItemResponse};
use ews::server_version::ExchangeServerVersion;
use ews::soap::{Envelope, Header};
use ews::sync_folder_hierarchy::{self, SyncFolderHierarchy, SyncFolderHierarchyResponse};
use ews::sync_folder_items::{self, SyncFolderItems, SyncFolderItemsResponse};
use ews::{
  BaseFolderId, BaseItemId, BaseShape, Folder, FolderShape, ItemShape, Mailbox, Message, Operation,
  OperationResponse, PathToElement, ResponseClass,
};

use crate::ews::{EwsError, EwsResult};

/// The version this app asks for. Thunderbird sends the same to Exchange
/// 2019. It gives `Preview` and `Flag`, which 2010 does not.
pub const VERSION: ExchangeServerVersion = ExchangeServerVersion::Exchange2013_SP1;

/// Changes in one `SyncFolderItems` page. Thunderbird uses the same number.
pub const ITEMS_PER_PAGE: u16 = 256;

/// Items or folders in one `GetItem` or `GetFolder` call.
pub const BATCH: usize = 10;

/// The folders asked for by name on the first sync, in this order.
pub const WELL_KNOWN: [&str; 8] = [
  "inbox",
  "sentitems",
  "drafts",
  "deleteditems",
  "junkemail",
  "outbox",
  "archive",
  "msgfolderroot",
];

/// The row fields, as `FieldURI` names. Not `Body`, `Attachments`,
/// `References`, `InReplyTo`, or `ReplyTo`: the KU server refused a request
/// that asked for all of those with the recipients (section 10). The body
/// comes from the MIME instead.
const ROW_FIELDS: [&str; 16] = [
  "item:Subject",
  "item:ItemClass",
  "message:From",
  "message:Sender",
  "message:ToRecipients",
  "message:CcRecipients",
  "item:DateTimeReceived",
  "item:DateTimeSent",
  "message:IsRead",
  "item:IsDraft",
  "item:Flag",
  "item:Preview",
  "item:ConversationId",
  "message:InternetMessageId",
  "item:HasAttachments",
  "item:Size",
];

// ---------------------------------------------------------------------------
// Documents in and out
// ---------------------------------------------------------------------------

/// The SOAP document for one operation, with the version header.
pub fn document<O: Operation>(operation: O) -> EwsResult<String> {
  let envelope = Envelope {
    headers: vec![Header::RequestServerVersion { version: VERSION }],
    body: operation,
  };
  let bytes = envelope
    .as_xml_document()
    .map_err(|e| EwsError::Invalid(format!("The request could not be written: {e}")))?;
  String::from_utf8(bytes).map_err(|e| EwsError::Invalid(e.to_string()))
}

/// The response messages of an answer. A SOAP fault becomes an error.
///
/// The crate stops the program on an answer with no SOAP header, and every
/// real answer has one (`ServerVersionInfo`). So an answer without it is
/// refused here first.
pub fn read<R: OperationResponse>(xml: &str) -> EwsResult<Vec<ResponseClass<R::Message>>> {
  if !xml.contains(":Fault>") && !xml.contains("ServerVersionInfo") {
    return Err(EwsError::Parse("The answer has no SOAP header.".into()));
  }
  match Envelope::<R>::from_xml_document(xml.as_bytes()) {
    Ok(envelope) => Ok(envelope.body.into_response_messages()),
    Err(ews::Error::RequestFault(fault)) => Err(fault_error(&fault)),
    Err(err) => Err(EwsError::Parse(describe(&err))),
  }
}

fn describe(err: &ews::Error) -> String {
  match err {
    ews::Error::Deserialize(inner) => format!("The answer could not be read at {}: {}", inner.path(), inner.inner()),
    other => format!("The answer could not be read: {other}"),
  }
}

fn fault_error(fault: &ews::soap::Fault) -> EwsError {
  let code = fault
    .detail
    .as_ref()
    .and_then(|d| d.response_code.as_ref())
    .map(|c| format!("{c:?}"))
    .unwrap_or_else(|| fault.faultcode.rsplit(':').next().unwrap_or("Fault").to_string());
  EwsError::Fault { code, message: fault.faultstring.clone() }
}

/// A failed response message as an error.
pub fn message_error(error: &ews::response::ResponseError) -> EwsError {
  EwsError::Fault {
    code: format!("{:?}", error.response_code),
    message: error.message_text.clone(),
  }
}

/// The one message of an answer to a request with one target.
pub(crate) fn only<T>(messages: Vec<ResponseClass<T>>) -> EwsResult<T> {
  match messages.into_iter().next() {
    Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => Ok(m),
    Some(ResponseClass::Error(e)) => Err(message_error(&e)),
    None => Err(EwsError::Parse("The answer has no response message.".into())),
  }
}

pub(crate) fn folder_ref(id: &str) -> BaseFolderId {
  BaseFolderId::FolderId { id: id.to_string(), change_key: None }
}

pub(crate) fn distinguished(id: &str) -> BaseFolderId {
  BaseFolderId::DistinguishedFolderId { id: id.to_string(), change_key: None }
}

fn item_ids(ids: &[String]) -> Vec<BaseItemId> {
  ids.iter().map(|id| BaseItemId::ItemId { id: id.clone(), change_key: None }).collect()
}

// ---------------------------------------------------------------------------
// The inbox, for the connect check and the debug command
// ---------------------------------------------------------------------------

/// The inbox name and counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
  pub display_name: String,
  pub total_count: u64,
  pub unread_count: u64,
  pub child_folder_count: u64,
}

pub fn inbox_request() -> EwsResult<String> {
  document(GetFolder {
    folder_shape: FolderShape { base_shape: BaseShape::Default },
    folder_ids: vec![distinguished("inbox")],
  })
}

pub fn read_inbox(xml: &str) -> EwsResult<FolderSummary> {
  let message = only(read::<GetFolderResponse>(xml)?)?;
  let folder = message
    .folders
    .inner
    .into_iter()
    .next()
    .ok_or_else(|| EwsError::Parse("The answer to GetFolder has no folder in it.".into()))?;
  let info = folder_info(&folder);
  Ok(FolderSummary {
    display_name: info.name,
    total_count: u64::from(info.total),
    unread_count: u64::from(info.unread),
    child_folder_count: u64::from(info.child_count),
  })
}

// ---------------------------------------------------------------------------
// The folder list
// ---------------------------------------------------------------------------

/// A mail folder, as the worker keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
  pub id: String,
  pub parent_id: Option<String>,
  pub name: String,
  pub folder_class: Option<String>,
  pub total: u32,
  pub unread: u32,
  pub child_count: u32,
}

/// One page of `SyncFolderHierarchy`: the ids of the plain folders that
/// changed, and the ids that went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyPage {
  pub changed: Vec<String>,
  pub deleted: Vec<String>,
  pub sync_state: String,
  pub last: bool,
}

pub fn hierarchy_request(sync_state: Option<String>) -> EwsResult<String> {
  document(SyncFolderHierarchy {
    folder_shape: FolderShape { base_shape: BaseShape::IdOnly },
    sync_folder_id: Some(distinguished("msgfolderroot")),
    sync_state,
  })
}

/// Calendar, contacts, tasks, and search folders are left out here, by
/// their element. A plain `Folder` is judged by its class after `GetFolder`.
pub fn read_hierarchy(xml: &str) -> EwsResult<HierarchyPage> {
  let message = only(read::<SyncFolderHierarchyResponse>(xml)?)?;
  let mut page = HierarchyPage {
    changed: Vec::new(),
    deleted: Vec::new(),
    sync_state: message.sync_state,
    last: message.includes_last_folder_in_range,
  };
  for change in message.changes.inner {
    match change {
      sync_folder_hierarchy::Change::Create { folder } | sync_folder_hierarchy::Change::Update { folder } => {
        if let Folder::Folder { folder_id: Some(id), .. } = folder {
          page.changed.push(id.id);
        }
      }
      sync_folder_hierarchy::Change::Delete { folder_id } => page.deleted.push(folder_id.id),
    }
  }
  Ok(page)
}

/// `GetFolder` with all properties: the class and the parent are not in
/// the default shape, and the crate's folder shape has no property list.
pub fn folders_request(ids: &[String]) -> EwsResult<String> {
  document(GetFolder {
    folder_shape: FolderShape { base_shape: BaseShape::AllProperties },
    folder_ids: ids.iter().map(|id| folder_ref(id)).collect(),
  })
}

/// The folders of a `GetFolder` answer. A folder that went between the two
/// calls answers with an error, and is left out.
pub fn read_folders(xml: &str) -> EwsResult<Vec<FolderInfo>> {
  let mut out = Vec::new();
  for message in read::<GetFolderResponse>(xml)? {
    match message {
      ResponseClass::Success(m) | ResponseClass::Warning(m) => {
        out.extend(m.folders.inner.iter().map(folder_info).filter(|f| !f.id.is_empty()));
      }
      ResponseClass::Error(e) => log::info!("ews: a folder was not read: {:?}", e.response_code),
    }
  }
  Ok(out)
}

/// Mail folders only: class `IPF.Note` or `IPF.Note.*`. A folder with no
/// class is kept, as Thunderbird keeps it.
pub fn is_mail_folder(folder: &FolderInfo) -> bool {
  match folder.folder_class.as_deref() {
    None => true,
    Some(class) => class == "IPF.Note" || class.starts_with("IPF.Note."),
  }
}

pub(crate) fn folder_info(folder: &Folder) -> FolderInfo {
  let (id, parent, class, name, total, child, unread) = match folder {
    Folder::Folder {
      folder_id,
      parent_folder_id,
      folder_class,
      display_name,
      total_count,
      child_folder_count,
      unread_count,
      ..
    } => (folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, *unread_count),
    Folder::CalendarFolder { folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, .. }
    | Folder::ContactsFolder { folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, .. }
    | Folder::SearchFolder { folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, .. }
    | Folder::TasksFolder { folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, .. } => {
      (folder_id, parent_folder_id, folder_class, display_name, total_count, child_folder_count, None)
    }
  };
  FolderInfo {
    id: id.as_ref().map(|f| f.id.clone()).unwrap_or_default(),
    parent_id: parent.as_ref().map(|f| f.id.clone()),
    name: name.clone().unwrap_or_default(),
    folder_class: class.clone(),
    total: total.unwrap_or(0),
    unread: unread.unwrap_or(0),
    child_count: child.unwrap_or(0),
  }
}

/// `GetFolder` for the well-known folders, by name, `IdOnly`.
pub fn well_known_request() -> EwsResult<String> {
  document(GetFolder {
    folder_shape: FolderShape { base_shape: BaseShape::IdOnly },
    folder_ids: WELL_KNOWN.iter().map(|name| distinguished(name)).collect(),
  })
}

/// Name and id of each well-known folder the server has. The answer keeps
/// the order of the request. A folder the mailbox does not have (for
/// example no archive) answers with an error, and is left out.
pub fn read_well_known(xml: &str) -> EwsResult<Vec<(String, String)>> {
  let messages = read::<GetFolderResponse>(xml)?;
  if messages.len() != WELL_KNOWN.len() {
    return Err(EwsError::Parse(format!(
      "GetFolder answered {} of {} well-known folders.",
      messages.len(),
      WELL_KNOWN.len()
    )));
  }
  let mut out = Vec::new();
  for (name, message) in WELL_KNOWN.iter().zip(messages) {
    if let ResponseClass::Success(m) | ResponseClass::Warning(m) = message {
      if let Some(folder) = m.folders.inner.first() {
        let info = folder_info(folder);
        if !info.id.is_empty() {
          out.push((name.to_string(), info.id));
        }
      }
    }
  }
  Ok(out)
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/// One page of `SyncFolderItems`. `changed` holds the created and updated
/// items, and the items whose read flag changed: all of them get their row
/// again with `GetItem`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemsPage {
  pub changed: Vec<String>,
  pub deleted: Vec<String>,
  pub sync_state: String,
  pub last: bool,
  /// The change key of each changed item, where the server gave one. A key
  /// that matches the one the newest items came with means the row in the
  /// copy is current, and is not asked for again.
  pub change_keys: std::collections::BTreeMap<String, String>,
}

pub fn items_request(folder: &str, sync_state: Option<String>) -> EwsResult<String> {
  document(SyncFolderItems {
    item_shape: ItemShape { base_shape: BaseShape::IdOnly, ..Default::default() },
    sync_folder_id: folder_ref(folder),
    sync_state,
    ignore: None,
    max_changes_returned: ITEMS_PER_PAGE,
    // Not given. The crate writes `<SyncScope><NormalItems/></SyncScope>`,
    // and the schema wants the text `NormalItems`, so the server would
    // refuse the request. `NormalItems` is the default when it is not given.
    sync_scope: None,
  })
}

pub fn read_items_page(xml: &str) -> EwsResult<ItemsPage> {
  let message = only(read::<SyncFolderItemsResponse>(xml)?)?;
  let mut page = ItemsPage {
    changed: Vec::new(),
    deleted: Vec::new(),
    sync_state: message.sync_state,
    last: message.includes_last_item_in_range,
    change_keys: Default::default(),
  };
  for change in message.changes.inner {
    let id = match change {
      sync_folder_items::Change::Create { item } | sync_folder_items::Change::Update { item } => {
        item.inner_message().item_id.as_ref().map(|i| {
          if let Some(key) = &i.change_key {
            page.change_keys.insert(i.id.clone(), key.clone());
          }
          i.id.clone()
        })
      }
      // A read flag that changed is a row to read again, whatever its key.
      sync_folder_items::Change::ReadFlagChange { item_id, .. } => {
        page.change_keys.remove(&item_id.id);
        Some(item_id.id)
      }
      sync_folder_items::Change::Delete { item_id } => {
        page.changed.retain(|c| c != &item_id.id);
        page.deleted.push(item_id.id);
        None
      }
    };
    if let Some(id) = id {
      if !page.changed.contains(&id) {
        page.deleted.retain(|d| d != &id);
        page.changed.push(id);
      }
    }
  }
  Ok(page)
}

/// The newest items of a folder, newest first, for the first read: the
/// list shows them while `SyncFolderItems` goes through the folder in the
/// server's own order, which on some servers is oldest first.
///
/// The `ews` crate's `FindItem` has no `SortOrder`, so it is put in by hand,
/// where the schema has it: after the view, before `ParentFolderIds`.
pub fn newest_request(folder: &str, count: usize) -> EwsResult<String> {
  use ews::find_item::{FindItem, Traversal};
  let doc = document(FindItem {
    traversal: Traversal::Shallow,
    item_shape: ItemShape { base_shape: BaseShape::IdOnly, ..Default::default() },
    view: Some(ews::View::IndexedPageItemView {
      max_entries_returned: Some(count),
      base_point: ews::BasePoint::Beginning,
      offset: 0,
    }),
    parent_folder_ids: vec![folder_ref(folder)],
  })?;
  let at = doc
    .find("<ParentFolderIds")
    .ok_or_else(|| EwsError::Invalid("FindItem was written without ParentFolderIds.".into()))?;
  let sort = r#"<SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></SortOrder>"#;
  Ok(format!("{}{}{}", &doc[..at], sort, &doc[at..]))
}

/// The ids of a `FindItem` answer, in its order, with their change keys.
pub fn read_newest(xml: &str) -> EwsResult<Vec<(String, Option<String>)>> {
  use ews::find_item::FindItemResponse;
  let message = only(read::<FindItemResponse>(xml)?)?;
  Ok(
    message
      .root_folder
      .items
      .inner
      .iter()
      .filter_map(|item| item.inner_message().item_id.as_ref().map(|i| (i.id.clone(), i.change_key.clone())))
      .collect(),
  )
}

/// A name and an address.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Address {
  pub name: String,
  pub email: String,
}

/// The row fields of one item. The worker makes the store row from it and
/// adds the labels, which depend on the folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRow {
  pub id: String,
  pub conversation_id: Option<String>,
  pub internet_message_id: Option<String>,
  pub item_class: Option<String>,
  pub subject: String,
  pub from: Option<Address>,
  pub sender: Option<Address>,
  pub to: Vec<Address>,
  pub cc: Vec<Address>,
  /// Milliseconds since 1970.
  pub received_at: Option<i64>,
  pub sent_at: Option<i64>,
  pub is_read: bool,
  pub is_draft: bool,
  /// `NotFlagged`, `Flagged`, or `Complete`.
  pub flag_status: Option<String>,
  pub preview: String,
  pub has_attachments: bool,
  pub size: Option<u64>,
}

pub fn rows_request(ids: &[String]) -> EwsResult<String> {
  let fields = ROW_FIELDS
    .iter()
    .map(|name| PathToElement::FieldURI { field_URI: name.to_string() })
    .collect();
  document(GetItem {
    item_shape: ItemShape {
      base_shape: BaseShape::IdOnly,
      include_mime_content: None,
      additional_properties: Some(fields),
    },
    item_ids: item_ids(ids),
  })
}

/// The rows of a `GetItem` answer. An item that went between the sync and
/// this call answers with an error, and is left out: the next sync page
/// reports it as deleted.
pub fn read_rows(xml: &str) -> EwsResult<Vec<ItemRow>> {
  let mut out = Vec::new();
  for message in read::<GetItemResponse>(xml)? {
    match message {
      ResponseClass::Success(m) | ResponseClass::Warning(m) => {
        out.extend(m.items.inner.iter().filter_map(|item| row_from(item.inner_message())));
      }
      ResponseClass::Error(e) => log::info!("ews: an item was not read: {:?}", e.response_code),
    }
  }
  Ok(out)
}

fn row_from(m: &Message) -> Option<ItemRow> {
  let id = m.item_id.as_ref()?.id.clone();
  Some(ItemRow {
    id,
    conversation_id: m.conversation_id.as_ref().map(|c| c.id.clone()),
    internet_message_id: m.internet_message_id.clone(),
    item_class: m.item_class.clone(),
    subject: m.subject.clone().unwrap_or_default(),
    from: m.from.as_ref().map(|r| address(&r.mailbox)),
    sender: m.sender.as_ref().map(|r| address(&r.mailbox)),
    to: m.to_recipients.iter().flat_map(|list| list.iter().map(|r| address(&r.mailbox))).collect(),
    cc: m.cc_recipients.iter().flat_map(|list| list.iter().map(|r| address(&r.mailbox))).collect(),
    received_at: m.date_time_received.as_ref().map(millis),
    sent_at: m.date_time_sent.as_ref().map(millis),
    is_read: m.is_read.unwrap_or(true),
    is_draft: m.is_draft.unwrap_or(false),
    flag_status: m.flag.as_ref().and_then(|f| f.flag_status.as_ref()).map(|s| format!("{s:?}")),
    preview: m.preview.clone().unwrap_or_default(),
    has_attachments: m.has_attachments.unwrap_or(false),
    size: m.size.map(|s| s as u64),
  })
}

fn address(mailbox: &Mailbox) -> Address {
  Address {
    name: mailbox.name.clone().unwrap_or_default(),
    email: mailbox.email_address.clone().unwrap_or_default().to_lowercase(),
  }
}

fn millis(at: &ews::DateTime) -> i64 {
  (at.0.unix_timestamp_nanos() / 1_000_000) as i64
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

pub fn mime_request(ids: &[String]) -> EwsResult<String> {
  document(GetItem {
    item_shape: ItemShape {
      base_shape: BaseShape::IdOnly,
      include_mime_content: Some(true),
      additional_properties: None,
    },
    item_ids: item_ids(ids),
  })
}

/// The raw message of each requested item, in the order of `ids`. `None`
/// for an item the server did not give: gone, or with no MIME.
pub fn read_mime(xml: &str, ids: &[String]) -> EwsResult<Vec<(String, Option<Vec<u8>>)>> {
  let messages = read::<GetItemResponse>(xml)?;
  let mut out = Vec::with_capacity(ids.len());
  for (index, id) in ids.iter().enumerate() {
    let raw = match messages.get(index) {
      Some(ResponseClass::Success(m)) | Some(ResponseClass::Warning(m)) => {
        let mime = m.items.inner.first().and_then(|item| item.inner_message().mime_content.as_ref());
        let raw = mime.and_then(|mime| decode_base64(&mime.content));
        // Why an item came back with no message, by code only: no content.
        if raw.is_none() {
          log::info!("ews: an item came back with no MIME (items: {}, MIME: {})", m.items.inner.len(), mime.is_some());
        }
        raw
      }
      Some(ResponseClass::Error(e)) => {
        log::info!("ews: an item was not read: {:?}", e.response_code);
        None
      }
      None => None,
    };
    out.push((id.clone(), raw));
  }
  Ok(out)
}

/// The server can break the base64 over lines.
fn decode_base64(text: &str) -> Option<Vec<u8>> {
  let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
  base64::engine::general_purpose::STANDARD.decode(clean).ok()
}

/// Split ids into the batches of one call.
pub fn batches(ids: &[String]) -> impl Iterator<Item = &[String]> {
  ids.chunks(BATCH)
}

#[cfg(test)]
#[path = "ews_ops_tests.rs"]
mod tests;
