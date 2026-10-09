//! Test data for the EWS code, and a fake EWS server.
//!
//! Everything here follows what the KU server sent on 2026-09-26, with
//! invented content:
//!
//! - Every answer that is not a fault has the `ServerVersionInfo` header of
//!   Exchange 2019.
//! - Folder ids are 120 characters and change keys 40. Item ids are 152
//!   characters, and conversation ids 80.
//! - `From` and `Sender` are `t:Mailbox` with `Name`, `EmailAddress`,
//!   `RoutingType`, and `MailboxType`.
//! - Errors come as SOAP faults with HTTP 500.
//!
//! The fake server is as strict as IIS and Exchange were in the probes: it
//! answers 411 to a POST with no `Content-Length`, a fault to a request with
//! no `Exchange2013_SP1` version header, and `ErrorInvalidRequest` to a
//! `GetItem` that asks for the body with the recipients. Only `example.com`
//! data: this crate is published.

#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

const TYPES: &str = "http://schemas.microsoft.com/exchange/services/2006/types";
const MESSAGES: &str = "http://schemas.microsoft.com/exchange/services/2006/messages";

/// An id of exactly `len` characters, in the base64 alphabet, that differs
/// by `n` and `kind`.
fn id_of(kind: &str, n: u32, len: usize) -> String {
  let mut out = format!("AAMkADExYW1wbGUt{kind}{n:04}");
  while out.len() < len - 1 {
    out.push('A');
  }
  out.push('=');
  out.truncate(len);
  out
}

/// A folder id: 120 characters.
pub fn folder_id(n: u32) -> String {
  id_of("Rm9s", n, 120)
}

/// A change key: 40 characters.
pub fn change_key(n: u32) -> String {
  id_of("Q2hn", n, 40)
}

/// An item id: 152 characters.
pub fn item_id(n: u32) -> String {
  id_of("SXRt", n, 152)
}

/// A conversation id: 80 characters.
pub fn conversation_id(n: u32) -> String {
  id_of("Q252", n, 80)
}

/// A whole answer: the declaration, the header, and the body.
pub fn envelope(body: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">"#,
      r#"<s:Header><h:ServerVersionInfo MajorVersion="15" MinorVersion="2" MajorBuildNumber="2562" "#,
      r#"MinorBuildNumber="17" Version="V2017_07_11" xmlns:h="{t}" xmlns="{t}" "#,
      r#"xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"/>"#,
      r#"</s:Header><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" "#,
      r#"xmlns:xsd="http://www.w3.org/2001/XMLSchema">{body}</s:Body></s:Envelope>"#
    ),
    t = TYPES,
    body = body
  )
}

/// A SOAP fault, as EWS sends it with HTTP 500. No header.
pub fn fault(code: &str, text: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>"#,
      r#"<faultcode xmlns:a="{t}">a:{code}</faultcode><faultstring xml:lang="en-US">{text}</faultstring>"#,
      r#"<detail><e:ResponseCode xmlns:e="http://schemas.microsoft.com/exchange/services/2006/errors">{code}</e:ResponseCode>"#,
      r#"<e:Message xmlns:e="http://schemas.microsoft.com/exchange/services/2006/errors">{text}</e:Message>"#,
      r#"</detail></s:Fault></s:Body></s:Envelope>"#
    ),
    t = TYPES,
    code = code,
    text = text
  )
}

/// `<m:{operation}Response>` with its messages.
pub fn response(operation: &str, messages: &[String]) -> String {
  envelope(&format!(
    r#"<m:{operation}Response xmlns:m="{MESSAGES}" xmlns:t="{TYPES}"><m:ResponseMessages>{}</m:ResponseMessages></m:{operation}Response>"#,
    messages.concat()
  ))
}

/// A successful response message.
pub fn success(operation: &str, inner: &str) -> String {
  format!(
    r#"<m:{operation}ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>{inner}</m:{operation}ResponseMessage>"#
  )
}

/// A failed response message.
pub fn error(operation: &str, code: &str, text: &str) -> String {
  format!(
    concat!(
      r#"<m:{op}ResponseMessage ResponseClass="Error"><m:MessageText>{text}</m:MessageText>"#,
      r#"<m:ResponseCode>{code}</m:ResponseCode><m:DescriptiveLinkKey>0</m:DescriptiveLinkKey></m:{op}ResponseMessage>"#
    ),
    op = operation,
    code = code,
    text = text
  )
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/// A folder with all properties, as `GetFolder` gives it.
pub struct FolderFixture {
  pub element: &'static str,
  pub n: u32,
  pub parent: u32,
  pub class: Option<&'static str>,
  pub name: &'static str,
  pub total: u32,
  pub unread: u32,
  pub children: u32,
}

impl FolderFixture {
  pub fn mail(n: u32, parent: u32, name: &'static str, total: u32, unread: u32) -> FolderFixture {
    FolderFixture { element: "Folder", n, parent, class: Some("IPF.Note"), name, total, unread, children: 0 }
  }

  pub fn xml(&self) -> String {
    let class = self.class.map(|c| format!("<t:FolderClass>{c}</t:FolderClass>")).unwrap_or_default();
    // Only a plain folder has an unread count.
    let unread = if self.element == "Folder" { format!("<t:UnreadCount>{}</t:UnreadCount>", self.unread) } else { String::new() };
    format!(
      concat!(
        r#"<t:{el}><t:FolderId Id="{id}" ChangeKey="{ck}"/><t:ParentFolderId Id="{parent}" ChangeKey="{pck}"/>"#,
        r#"{class}<t:DisplayName>{name}</t:DisplayName><t:TotalCount>{total}</t:TotalCount>"#,
        r#"<t:ChildFolderCount>{children}</t:ChildFolderCount>"#,
        r#"<t:EffectiveRights><t:CreateAssociated>true</t:CreateAssociated><t:CreateContents>true</t:CreateContents>"#,
        r#"<t:CreateHierarchy>true</t:CreateHierarchy><t:Delete>true</t:Delete><t:Modify>true</t:Modify>"#,
        r#"<t:Read>true</t:Read><t:ViewPrivateItems>true</t:ViewPrivateItems></t:EffectiveRights>{unread}</t:{el}>"#
      ),
      el = self.element,
      id = folder_id(self.n),
      ck = change_key(self.n),
      parent = folder_id(self.parent),
      pck = change_key(self.parent),
      class = class,
      name = self.name,
      total = self.total,
      children = self.children,
      unread = unread
    )
  }

  /// The same folder with its id only, as `SyncFolderHierarchy` gives it
  /// with `IdOnly`.
  pub fn id_only(&self) -> String {
    format!(r#"<t:{el}><t:FolderId Id="{id}" ChangeKey="{ck}"/></t:{el}>"#, el = self.element, id = folder_id(self.n), ck = change_key(self.n))
  }
}

/// A `SyncFolderHierarchy` answer: creates, then deletes.
pub fn hierarchy_answer(created: &[&FolderFixture], deleted: &[u32], state: &str, last: bool) -> String {
  let mut changes = String::new();
  for folder in created {
    changes.push_str(&format!("<t:Create>{}</t:Create>", folder.id_only()));
  }
  for n in deleted {
    changes.push_str(&format!(r#"<t:Delete><t:FolderId Id="{}" ChangeKey="{}"/></t:Delete>"#, folder_id(*n), change_key(*n)));
  }
  let inner = format!(
    "<m:SyncState>{state}</m:SyncState><m:IncludesLastFolderInRange>{last}</m:IncludesLastFolderInRange><m:Changes>{changes}</m:Changes>"
  );
  response("SyncFolderHierarchy", &[success("SyncFolderHierarchy", &inner)])
}

/// A `GetFolder` answer with one message for each folder.
pub fn get_folders(folders: &[&FolderFixture]) -> String {
  let messages: Vec<String> = folders
    .iter()
    .map(|f| success("GetFolder", &format!("<m:Folders>{}</m:Folders>", f.xml())))
    .collect();
  response("GetFolder", &messages)
}

/// The answer to the well-known folders request: 8 messages in the order
/// asked, the ids given in `ids` (0 for a folder the mailbox does not have).
pub fn well_known_answer(ids: [u32; 8]) -> String {
  let messages: Vec<String> = ids
    .iter()
    .map(|n| {
      if *n == 0 {
        error("GetFolder", "ErrorFolderNotFound", "The specified folder could not be found in the store.")
      } else {
        let folder = format!(r#"<t:Folder><t:FolderId Id="{}" ChangeKey="{}"/></t:Folder>"#, folder_id(*n), change_key(*n));
        success("GetFolder", &format!("<m:Folders>{folder}</m:Folders>"))
      }
    })
    .collect();
  response("GetFolder", &messages)
}

/// A long sync state, as the server sends one (about 530 characters).
pub fn sync_state(n: u32) -> String {
  let mut out = format!("H4sIAAAAAAAEAO29B2AcSZYlJi9tynt/SvVK1+B0rQ{n:04}");
  while out.len() < 530 {
    out.push_str("AAAA");
  }
  out
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/// One change in a `SyncFolderItems` page.
pub enum ItemChange {
  Create(u32),
  Update(u32),
  Delete(u32),
  ReadFlag(u32, bool),
}

/// A `SyncFolderItems` answer. With `IdOnly`, each item has its id only.
pub fn sync_items_answer(changes: &[ItemChange], state: &str, last: bool) -> String {
  let id_only = |n: u32| format!(r#"<t:Message><t:ItemId Id="{}" ChangeKey="{}"/></t:Message>"#, item_id(n), change_key(n));
  let mut xml = String::new();
  for change in changes {
    xml.push_str(&match change {
      ItemChange::Create(n) => format!("<t:Create>{}</t:Create>", id_only(*n)),
      ItemChange::Update(n) => format!("<t:Update>{}</t:Update>", id_only(*n)),
      ItemChange::Delete(n) => format!(r#"<t:Delete><t:ItemId Id="{}" ChangeKey="{}"/></t:Delete>"#, item_id(*n), change_key(*n)),
      ItemChange::ReadFlag(n, read) => format!(
        r#"<t:ReadFlagChange><t:ItemId Id="{}" ChangeKey="{}"/><t:IsRead>{read}</t:IsRead></t:ReadFlagChange>"#,
        item_id(*n),
        change_key(*n)
      ),
    });
  }
  let inner = format!(
    "<m:SyncState>{state}</m:SyncState><m:IncludesLastItemInRange>{last}</m:IncludesLastItemInRange><m:Changes>{xml}</m:Changes>"
  );
  response("SyncFolderItems", &[success("SyncFolderItems", &inner)])
}

/// A `t:Mailbox` as the server writes it.
pub fn mailbox(name: &str, email: &str, kind: &str) -> String {
  format!(
    "<t:Mailbox><t:Name>{name}</t:Name><t:EmailAddress>{email}</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>{kind}</t:MailboxType></t:Mailbox>"
  )
}

/// A message with the row fields, as `GetItem` with the property list gives
/// it. The order of the elements is the order of the schema.
pub fn message_row(n: u32, subject: &str, read: bool, flag: &str) -> String {
  format!(
    concat!(
      r#"<t:Message><t:ItemId Id="{id}" ChangeKey="{ck}"/><t:ItemClass>IPM.Note</t:ItemClass>"#,
      "<t:Subject>{subject}</t:Subject><t:DateTimeReceived>2026-09-2{d}T08:1{d}:00Z</t:DateTimeReceived>",
      "<t:Size>4{n}21</t:Size><t:DateTimeSent>2026-09-2{d}T08:0{d}:30Z</t:DateTimeSent>",
      "<t:HasAttachments>{att}</t:HasAttachments>",
      "<t:Sender>{sender}</t:Sender><t:ToRecipients>{to}</t:ToRecipients><t:CcRecipients>{cc}</t:CcRecipients>",
      "<t:IsDraft>false</t:IsDraft><t:ConversationId Id=\"{conv}\"/>",
      "<t:From>{from}</t:From><t:InternetMessageId>&lt;msg{n}@mail.example.com&gt;</t:InternetMessageId>",
      "<t:IsRead>{read}</t:IsRead><t:Flag><t:FlagStatus>{flag}</t:FlagStatus></t:Flag>",
      "<t:Preview>A preview of message {n}, with &amp; in it.</t:Preview></t:Message>"
    ),
    id = item_id(n),
    ck = change_key(n),
    subject = subject,
    d = n % 10,
    n = n,
    att = n % 2 == 0,
    sender = mailbox("Dana Example", "dana@example.com", "OneOff"),
    to = mailbox("Sam Example", "Sam@Example.com", "Mailbox"),
    cc = mailbox("Kim Example", "kim@example.com", "OneOff"),
    conv = conversation_id(n),
    from = mailbox("Dana Example", "dana@example.com", "OneOff"),
    read = read,
    flag = flag
  )
}

/// A `GetItem` answer with one message for each item. `None` is an item
/// that went: `ErrorItemNotFound`.
pub fn get_items(items: &[Option<String>]) -> String {
  let messages: Vec<String> = items
    .iter()
    .map(|item| match item {
      Some(xml) => success("GetItem", &format!("<m:Items>{xml}</m:Items>")),
      None => error("GetItem", "ErrorItemNotFound", "The specified object was not found in the store."),
    })
    .collect();
  response("GetItem", &messages)
}

/// A message with its MIME, as `GetItem` with `IncludeMimeContent` gives
/// it. The server breaks the base64 over lines.
pub fn message_mime(n: u32, raw: &str) -> String {
  use base64::Engine;
  let encoded = base64::engine::general_purpose::STANDARD.encode(raw.as_bytes());
  let wrapped: Vec<String> = encoded.as_bytes().chunks(76).map(|c| String::from_utf8_lossy(c).into_owned()).collect();
  format!(
    r#"<t:Message><t:MimeContent CharacterSet="UTF-8">{}</t:MimeContent><t:ItemId Id="{}" ChangeKey="{}"/></t:Message>"#,
    wrapped.join("\r\n"),
    item_id(n),
    change_key(n)
  )
}

/// A raw message with text, HTML, and one PDF file.
pub fn raw_message(n: u32) -> String {
  format!(
    concat!(
      "From: Dana Example <dana@example.com>\r\nTo: Sam Example <sam@example.com>\r\n",
      "Subject: Plan {n}\r\nMessage-ID: <msg{n}@mail.example.com>\r\nMIME-Version: 1.0\r\n",
      "Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n",
      "--outer\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n",
      "--alt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThe plan for day {n}.\r\n",
      "--alt\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>The plan for day {n}.</p>\r\n",
      "--alt--\r\n",
      "--outer\r\nContent-Type: application/pdf; name=\"plan.pdf\"\r\n",
      "Content-Disposition: attachment; filename=\"plan.pdf\"\r\n",
      "Content-Transfer-Encoding: base64\r\n\r\nJVBERi0x\r\n",
      "--outer--\r\n"
    ),
    n = n
  )
}

// ---------------------------------------------------------------------------
// The fake server
// ---------------------------------------------------------------------------

/// The answer the fake server gives to one request: the operation name and
/// the request body in, the status and the body out.
pub type Handler = Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync>;

pub struct FakeEws {
  pub url: String,
  /// Every request body, in order.
  pub requests: Arc<Mutex<Vec<String>>>,
  pub count: Arc<AtomicUsize>,
}

/// The operation a request asks for: the first element in the SOAP body.
pub fn operation_of(body: &str) -> String {
  let Some(at) = body.find("<soap:Body>") else { return String::new() };
  let rest = &body[at + "<soap:Body>".len()..];
  let name: String = rest.trim_start_matches('<').chars().take_while(|c| c.is_alphanumeric() || *c == ':').collect();
  name.rsplit(':').next().unwrap_or("").to_string()
}

/// What the real server refuses, before the handler sees the request.
fn refusal(body: &str) -> Option<(u16, String)> {
  if !body.contains(r#"Version="Exchange2013_SP1""#) {
    return Some((500, fault("ErrorInvalidServerVersion", "The specified server version is invalid.")));
  }
  if let Some(refused) = oof_refusal(body).or_else(|| later_refusal(body)).or_else(|| resolve_refusal(body)) {
    return Some(refused);
  }
  let too_much = ["item:Body", "item:Attachments", "message:ToRecipients"];
  if too_much.iter().all(|f| body.contains(f)) {
    return Some((500, fault("ErrorInvalidRequest", "The request is invalid.")));
  }
  // What the schema and the server want of the writes. A type element with
  // no `t:` prefix is in the messages namespace, which the schema refuses:
  // the `ews` crate writes the flag's children that way (ews_write.rs).
  if body.contains("<FlagStatus>") {
    return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  }
  if operation_of(body) == "UpdateItem" && !body.contains("MessageDisposition=\"") {
    return Some((500, fault("ErrorMessageDispositionRequired", "MessageDisposition attribute is required.")));
  }
  // The KU server (2026-09-27): a write with no ChangeKey must say
  // AlwaysOverwrite, or it is refused. AutoResolve needs the ChangeKey.
  if operation_of(body) == "UpdateItem"
    && !body.contains(r#"ConflictResolution="AlwaysOverwrite""#)
    && !body.contains("ChangeKey=")
  {
    return Some((
      500,
      fault("ErrorChangeKeyRequiredForWriteOperations", "ChangeKey is required for this operation."),
    ));
  }
  // A folder rename names the folder's ChangeKey, as item writes must.
  if operation_of(body) == "UpdateFolder" && !body.contains("ChangeKey=") {
    return Some((
      500,
      fault("ErrorChangeKeyRequiredForWriteOperations", "ChangeKey is required for this operation."),
    ));
  }
  if operation_of(body) == "CreateItem" && !body.contains("MessageDisposition=\"") {
    return Some((500, fault("ErrorMessageDispositionRequired", "MessageDisposition attribute is required.")));
  }
  if operation_of(body) == "DeleteItem" && !body.contains("DeleteType=\"") {
    return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  }
  if operation_of(body) == "MoveItem" && !body.contains("<ToFolderId>") {
    return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  }
  None
}

/// What the server refuses of send later (section 16.4).
fn later_refusal(body: &str) -> Option<(u16, String)> {
  let operation = operation_of(body);
  // The send time must be a time, with its zone.
  if operation == "CreateItem" && body.contains(r#"PropertyTag="0x3FEF""#) {
    let value = crate::ews::element_text(body.split(r#"PropertyTag="0x3FEF""#).nth(1)?, "Value").unwrap_or_default();
    if value.len() != 20 || !value.ends_with('Z') || value.as_bytes().get(10) != Some(&b'T') {
      return Some((500, fault("ErrorInvalidExtendedPropertyValue", "The extended property value is invalid.")));
    }
  }
  if operation == "SendItem" && (!body.contains("ChangeKey=") || !body.contains("SaveItemToFolder=")) {
    return Some((500, fault("ErrorChangeKeyRequiredForWriteOperations", "ChangeKey is required for this operation.")));
  }
  if operation == "FindItem" && !body.contains("Traversal=") {
    return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  }
  // The schema's order in FindItem: the view, then SortOrder, then the
  // folders. A FieldOrder must say its order.
  if operation == "FindItem" && body.contains("<SortOrder>") {
    let sort = body.find("<SortOrder>").unwrap_or(0);
    let parents = body.find("<ParentFolderIds").unwrap_or(0);
    if sort > parents || !body.contains("<t:FieldOrder Order=\"") {
      return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
    }
  }
  None
}

/// A `FindItem` answer on Outbox and Sent Items, one message for each
/// folder, as the server gives it for two folders.
pub fn held_answer_by_folder(outbox: &[(u32, Option<&str>)], sent: &[(u32, Option<&str>)]) -> String {
  let root = |items: &[(u32, Option<&str>)]| {
    format!(
      r#"<m:RootFolder IndexedPagingOffset="{len}" TotalItemsInView="{len}" IncludesLastItemInRange="true"><t:Items>{}</t:Items></m:RootFolder>"#,
      held_items(items),
      len = items.len()
    )
  };
  response("FindItem", &[success("FindItem", &root(outbox)), success("FindItem", &root(sent))])
}

fn held_items(items: &[(u32, Option<&str>)]) -> String {
  items
    .iter()
    .map(|(n, at)| {
      let time = at
        .map(|at| {
          format!(r#"<t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="0x3fef" PropertyType="SystemTime"/><t:Value>{at}</t:Value></t:ExtendedProperty>"#)
        })
        .unwrap_or_default();
      format!(r#"<t:Message><t:ItemId Id="{}" ChangeKey="{}"/>{time}</t:Message>"#, item_id(*n), change_key(*n))
    })
    .collect()
}

/// A `FindItem` answer on Outbox: each item with its send time, or with
/// none (a message on its way now).
pub fn held_answer(items: &[(u32, Option<&str>)]) -> String {
  let inner: String = items
    .iter()
    .map(|(n, at)| {
      let time = at
        .map(|at| {
          format!(r#"<t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="0x3fef" PropertyType="SystemTime"/><t:Value>{at}</t:Value></t:ExtendedProperty>"#)
        })
        .unwrap_or_default();
      format!(r#"<t:Message><t:ItemId Id="{}" ChangeKey="{}"/>{time}</t:Message>"#, item_id(*n), change_key(*n))
    })
    .collect();
  let root = format!(
    r#"<m:RootFolder IndexedPagingOffset="{len}" TotalItemsInView="{len}" IncludesLastItemInRange="true"><t:Items>{inner}</t:Items></m:RootFolder>"#,
    len = items.len()
  );
  response("FindItem", &[success("FindItem", &root)])
}

/// What the server refuses of `ResolveNames` (section 16.5):
/// `ReturnFullContactData` is required, and the entry is in the messages
/// namespace, with text in it.
fn resolve_refusal(body: &str) -> Option<(u16, String)> {
  if operation_of(body) != "ResolveNames" {
    return None;
  }
  let entry = crate::ews::element_text(body, "UnresolvedEntry").unwrap_or_default();
  let full = body.contains(r#"ReturnFullContactData="true""#) || body.contains(r#"ReturnFullContactData="false""#);
  if !full || body.contains("<t:UnresolvedEntry>") || entry.trim().is_empty() {
    return Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  }
  None
}

/// One entry of the fake directory. As on KU (2026-09-27), the mailbox's
/// `Name` is the user id; the person's name is only in the contact data.
pub struct DirEntry {
  pub alias: &'static str,
  pub display: &'static str,
  pub email: &'static str,
  pub routing: &'static str,
  pub department: Option<&'static str>,
  pub job_title: Option<&'static str>,
}

/// The contact data of an entry, as `ReturnFullContactData="true"` gives
/// it: the children in the schema's order, the address as `SMTP:` in
/// `EmailAddresses`, and no `Department` or `JobTitle` when AD has none.
fn contact_xml(e: &DirEntry) -> String {
  let opt = |tag: &str, v: Option<&str>| v.map(|v| format!("<t:{tag}>{v}</t:{tag}>")).unwrap_or_default();
  format!(
    concat!(
      "<t:Contact><t:Culture>en-US</t:Culture><t:DisplayName>{display}</t:DisplayName>",
      "<t:EmailAddresses><t:Entry Key=\"EmailAddress1\">SMTP:{email}</t:Entry></t:EmailAddresses>",
      "<t:ContactSource>ActiveDirectory</t:ContactSource>{department}{job}</t:Contact>"
    ),
    display = e.display,
    email = e.email,
    department = opt("Department", e.department),
    job = opt("JobTitle", e.job_title)
  )
}

/// A `ResolveNames` answer. None is `ErrorNameResolutionNoResults`; more
/// than one is a `Warning`. `full`: with the contact data.
pub fn resolve_answer(people: &[&DirEntry], full: bool) -> String {
  if people.is_empty() {
    return response(
      "ResolveNames",
      &[error("ResolveNames", "ErrorNameResolutionNoResults", "No results were found.")],
    );
  }
  let set: String = people
    .iter()
    .map(|e| {
      format!(
        concat!(
          "<t:Resolution><t:Mailbox><t:Name>{alias}</t:Name><t:EmailAddress>{email}</t:EmailAddress>",
          "<t:RoutingType>{routing}</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>{contact}</t:Resolution>"
        ),
        alias = e.alias,
        email = e.email,
        routing = e.routing,
        contact = if full { contact_xml(e) } else { String::new() }
      )
    })
    .collect();
  let (class, code) = if people.len() == 1 { ("Success", "NoError") } else { ("Warning", "ErrorNameResolutionMultipleResults") };
  let message = format!(
    concat!(
      r#"<m:ResolveNamesResponseMessage ResponseClass="{class}">"#,
      "{text}<m:ResponseCode>{code}</m:ResponseCode><m:DescriptiveLinkKey>0</m:DescriptiveLinkKey>",
      r#"<m:ResolutionSet TotalItemsInView="{n}" IncludesLastItemInRange="true">{set}</m:ResolutionSet>"#,
      "</m:ResolveNamesResponseMessage>"
    ),
    class = class,
    text = if people.len() > 1 { "<m:MessageText>Multiple results were found.</m:MessageText>" } else { "" },
    code = code,
    n = people.len(),
    set = set
  );
  response("ResolveNames", &[message])
}

/// The mailbox the fake server signs in as. Another address is someone
/// else's mailbox.
pub const OWN_ADDRESS: &str = "someone@example.com";

/// What the server refuses of the auto-reply requests (section 16.2).
fn oof_refusal(body: &str) -> Option<(u16, String)> {
  let operation = operation_of(body);
  if operation != "GetUserOofSettingsRequest" && operation != "SetUserOofSettingsRequest" {
    return None;
  }
  let schema = || Some((500, fault("ErrorSchemaValidation", "The request failed schema validation.")));
  // A type element with no prefix is in the messages namespace.
  if ["<Mailbox>", "<Address>", "<UserOofSettings>", "<OofState>"].iter().any(|t| body.contains(t)) {
    return schema();
  }
  if !body.contains(&format!("<t:Address>{OWN_ADDRESS}</t:Address>")) {
    return Some((200, oof_error(&operation, "ErrorAccessDenied", "Access is denied.")));
  }
  if operation == "GetUserOofSettingsRequest" {
    return None;
  }
  let order = ["<t:OofState>", "<t:ExternalAudience>", "<t:Duration>", "<t:InternalReply>", "<t:ExternalReply>"];
  let at: Vec<usize> = order.iter().filter_map(|t| body.find(t)).collect();
  if !body.contains("<t:ExternalAudience>") || at.windows(2).any(|w| w[0] > w[1]) {
    return schema();
  }
  // The KU server (2026-09-27): a reply that is a whole HTML document, as
  // GetUserOofSettings gives it back, is refused with an internal error.
  if body.contains("&lt;html") || body.contains("&lt;head") {
    return Some((500, fault("ErrorInternalServerError", "An internal server error occurred. The operation failed.")));
  }
  if body.contains("<t:OofState>Scheduled</t:OofState>") {
    let start = crate::ews::element_text(body, "StartTime").unwrap_or_default();
    let end = crate::ews::element_text(body, "EndTime").unwrap_or_default();
    if start.is_empty() || end <= start {
      return Some((200, oof_error(&operation, "ErrorInvalidScheduledOofDuration", "The duration is invalid.")));
    }
  }
  None
}

/// An auto-reply answer with a failed `ResponseMessage`.
fn oof_error(request: &str, code: &str, text: &str) -> String {
  let name = request.trim_end_matches("Request");
  envelope(&format!(
    concat!(
      r#"<{name}Response xmlns="{m}"><ResponseMessage ResponseClass="Error"><MessageText>{text}</MessageText>"#,
      r#"<ResponseCode>{code}</ResponseCode><DescriptiveLinkKey>0</DescriptiveLinkKey></ResponseMessage></{name}Response>"#
    ),
    name = name,
    m = MESSAGES,
    text = text,
    code = code
  ))
}

/// A `GetUserOofSettings` answer, in the form Exchange 2019 gives: the
/// messages escaped, and the times with no zone.
pub fn oof_answer(state: &str, audience: &str, start: &str, end: &str, internal: &str, external: &str) -> String {
  let escape = |v: &str| v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
  envelope(&format!(
    concat!(
      r#"<GetUserOofSettingsResponse xmlns="{m}"><ResponseMessage ResponseClass="Success">"#,
      "<ResponseCode>NoError</ResponseCode></ResponseMessage>",
      r#"<OofSettings xmlns="{t}"><OofState>{state}</OofState><ExternalAudience>{audience}</ExternalAudience>"#,
      "<Duration><StartTime>{start}</StartTime><EndTime>{end}</EndTime></Duration>",
      "<InternalReply><Message>{internal}</Message></InternalReply>",
      "<ExternalReply>{external}</ExternalReply></OofSettings>",
      "<AllowExternalOof>All</AllowExternalOof></GetUserOofSettingsResponse>"
    ),
    m = MESSAGES,
    t = TYPES,
    state = state,
    audience = audience,
    start = start,
    end = end,
    internal = escape(internal),
    external = if external.is_empty() { "<Message/>".to_string() } else { format!("<Message>{}</Message>", escape(external)) }
  ))
}

/// A `SetUserOofSettings` answer that worked.
pub fn oof_set_answer() -> String {
  envelope(&format!(
    concat!(
      r#"<SetUserOofSettingsResponse xmlns="{m}"><ResponseMessage ResponseClass="Success">"#,
      "<ResponseCode>NoError</ResponseCode></ResponseMessage></SetUserOofSettingsResponse>"
    ),
    m = MESSAGES
  ))
}

/// Start the fake server. It takes Basic sign-in with any password but
/// "wrong", so the tests here are about the answers, not the sign-in
/// (ews.rs tests NTLM).
pub fn serve(handler: Handler) -> FakeEws {
  let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
  let port = server.server_addr().to_ip().unwrap().port();
  let requests = Arc::new(Mutex::new(Vec::new()));
  let count = Arc::new(AtomicUsize::new(0));
  let (log, hits) = (requests.clone(), count.clone());
  std::thread::spawn(move || {
    for mut request in server.incoming_requests() {
      hits.fetch_add(1, Ordering::SeqCst);
      let mut body = String::new();
      let _ = request.as_reader().read_to_string(&mut body);
      let has = |name: &str| request.headers().iter().any(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name));
      let auth = request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Authorization"))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default();
      let (status, text) = if !has("Content-Length") {
        (411, String::new())
      } else if !auth.starts_with("Basic ") || auth == basic("wrong") {
        (401, String::new())
      } else {
        log.lock().unwrap().push(body.clone());
        refusal(&body).unwrap_or_else(|| handler(&operation_of(&body), &body))
      };
      let mut response = tiny_http::Response::from_string(text).with_status_code(status);
      if status == 401 {
        response.add_header(tiny_http::Header::from_bytes("WWW-Authenticate", "Basic realm=\"mail.example.com\"").unwrap());
      }
      let _ = request.respond(response);
    }
  });
  FakeEws { url: format!("http://127.0.0.1:{port}/EWS/Exchange.asmx"), requests, count }
}

fn basic(password: &str) -> String {
  use base64::Engine;
  format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("someone@example.com:{password}")))
}

/// A client for the fake server, signed in as `someone@example.com`.
pub fn client(url: &str) -> crate::ews::EwsClient {
  crate::ews::EwsClient::new(crate::ews::EwsSettings {
    url: url.into(),
    username: "someone@example.com".into(),
    password: "correct horse".into(),
  })
  .unwrap()
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// An `UpdateItem` answer: `true` for an item changed, `false` for one that
/// was gone (`ErrorItemNotFound`).
pub fn update_answer(items: &[(u32, bool)]) -> String {
  let messages: Vec<String> = items
    .iter()
    .map(|(n, ok)| {
      if *ok {
        let inner = format!(
          r#"<m:Items><t:Message><t:ItemId Id="{}" ChangeKey="{}"/></t:Message></m:Items><m:ConflictResults><t:Count>0</t:Count></m:ConflictResults>"#,
          item_id(*n),
          change_key(n + 500)
        );
        success("UpdateItem", &inner)
      } else {
        error("UpdateItem", "ErrorItemNotFound", "The specified object was not found in the store.")
      }
    })
    .collect();
  response("UpdateItem", &messages)
}

/// A `MoveItem` answer with `ReturnNewItemIds`: the new id of each item, or
/// `None` for one that was gone.
pub fn move_answer(new_ids: &[Option<u32>]) -> String {
  let messages: Vec<String> = new_ids
    .iter()
    .map(|n| match n {
      Some(n) => success(
        "MoveItem",
        &format!(r#"<m:Items><t:Message><t:ItemId Id="{}" ChangeKey="{}"/></t:Message></m:Items>"#, item_id(*n), change_key(*n)),
      ),
      None => error("MoveItem", "ErrorItemNotFound", "The specified object was not found in the store."),
    })
    .collect();
  response("MoveItem", &messages)
}

/// A `DeleteItem` answer: one message for each item, with no content.
pub fn delete_answer(items: &[bool]) -> String {
  let messages: Vec<String> = items
    .iter()
    .map(|ok| {
      if *ok {
        success("DeleteItem", "")
      } else {
        error("DeleteItem", "ErrorItemNotFound", "The specified object was not found in the store.")
      }
    })
    .collect();
  response("DeleteItem", &messages)
}

/// A `CreateItem` answer. A send (`SendAndSaveCopy`) names no item; a save
/// (`SaveOnly`) names the item it made.
pub fn create_answer(made: Option<u32>) -> String {
  let items = match made {
    Some(n) => format!(r#"<m:Items><t:Message><t:ItemId Id="{}" ChangeKey="{}"/></t:Message></m:Items>"#, item_id(n), change_key(n)),
    None => "<m:Items/>".to_string(),
  };
  response("CreateItem", &[success("CreateItem", &items)])
}


// ---------------------------------------------------------------------------
// Autodiscover (section 16.7): a fake host, a fake DNS server, and answers
// ---------------------------------------------------------------------------

/// One request to a fake Autodiscover host.
#[derive(Debug, Clone)]
pub struct AdRequest {
  pub method: String,
  /// The `Authorization` scheme sent (`NTLM`, `Basic`), if any.
  pub auth: Option<String>,
  /// The password of a Basic sign-in, if any.
  pub password: Option<String>,
  pub body: String,
}

impl AdRequest {
  /// A request that carried a password: Basic, or the NTLM answer.
  pub fn signed(&self) -> bool {
    self.password.is_some()
  }
}

/// What a host answers after sign-in: status, headers, body.
pub type AdHandler = Arc<dyn Fn(&AdRequest) -> (u16, Vec<(&'static str, String)>, String) + Send + Sync>;

pub struct FakeHost {
  /// `http://127.0.0.1:<port>`, with no path.
  pub base: String,
  pub requests: Arc<Mutex<Vec<AdRequest>>>,
}

impl FakeHost {
  pub fn signed_count(&self) -> usize {
    self.requests.lock().unwrap().iter().filter(|r| r.signed()).count()
  }
}

fn basic_password(auth: &str) -> Option<String> {
  use base64::Engine;
  let raw = base64::engine::general_purpose::STANDARD.decode(auth.strip_prefix("Basic ")?.trim()).ok()?;
  let pair = String::from_utf8(raw).ok()?;
  pair.split_once(':').map(|(_, p)| p.to_string())
}

/// What a real Autodiscover host refuses of a POST, before the handler: no
/// `Content-Length` (IIS, 411), and a body with no address or no known
/// response schema (Exchange answers code 600, "Invalid Request").
fn ad_refusal(request: &AdRequest, has_length: bool) -> Option<(u16, String)> {
  if !has_length {
    return Some((411, String::new()));
  }
  let schema = "<AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema>";
  let address = crate::ews::element_text(&request.body, "EMailAddress").unwrap_or_default();
  if !request.body.contains(schema) || !address.contains('@') {
    return Some((200, ad_error("600", "Invalid Request")));
  }
  None
}

/// What the host answers, by the rules of IIS and Exchange, then `handler`.
fn ad_answer(request: &AdRequest, has_length: bool, handler: &AdHandler) -> (u16, Vec<(&'static str, String)>, String) {
  let challenge = vec![("WWW-Authenticate", "Basic realm=\"autodiscover.example.com\"".to_string())];
  if request.method == "GET" {
    return handler(request);
  }
  // No NTLM here: the client falls back to Basic, as with `serve`.
  match request.password.as_deref() {
    None => return (401, challenge, String::new()),
    Some("wrong") => return (401, challenge, String::new()),
    Some(_) => {}
  }
  if let Some((status, body)) = ad_refusal(request, has_length) {
    return (status, Vec::new(), body);
  }
  handler(request)
}

/// Start a fake Autodiscover host. It takes Basic sign-in with any password
/// but "wrong".
pub fn serve_autodiscover(handler: AdHandler) -> FakeHost {
  let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
  let port = server.server_addr().to_ip().unwrap().port();
  let requests = Arc::new(Mutex::new(Vec::new()));
  let log = requests.clone();
  std::thread::spawn(move || {
    for mut request in server.incoming_requests() {
      let mut body = String::new();
      let _ = request.as_reader().read_to_string(&mut body);
      let header = |name: &str| {
        request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
      };
      let auth = header("Authorization");
      let seen = AdRequest {
        method: request.method().as_str().to_string(),
        auth: auth.as_deref().map(|a| a.split_whitespace().next().unwrap_or("").to_string()),
        password: auth.as_deref().and_then(basic_password),
        body,
      };
      let (status, headers, text) = ad_answer(&seen, header("Content-Length").is_some(), &handler);
      log.lock().unwrap().push(seen);
      let mut response = tiny_http::Response::from_string(text).with_status_code(status);
      for (name, value) in headers {
        response.add_header(tiny_http::Header::from_bytes(name, value.as_bytes()).unwrap());
      }
      let _ = request.respond(response);
    }
  });
  FakeHost { base: format!("http://127.0.0.1:{port}"), requests }
}

/// A host that takes the connection and never answers.
pub fn serve_silent() -> String {
  let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
  let port = listener.local_addr().unwrap().port();
  std::thread::spawn(move || {
    let mut held = Vec::new();
    for stream in listener.incoming().flatten() {
      held.push(stream);
    }
  });
  format!("http://127.0.0.1:{port}")
}

fn ad_envelope(account: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">"#,
      r#"<Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">"#,
      "<User><DisplayName>Sam Example</DisplayName></User><Account>{account}</Account></Response></Autodiscover>"
    ),
    account = account
  )
}

/// A settings answer: each protocol as (type, EwsUrl), with the `WEB` one
/// that real answers carry too.
pub fn ad_settings(protocols: &[(&str, &str)]) -> String {
  let list: String = protocols
    .iter()
    .map(|(kind, url)| {
      format!("<Protocol><Type>{kind}</Type><Server>mail.example.com</Server><ASUrl>{url}</ASUrl><EwsUrl>{url}</EwsUrl></Protocol>")
    })
    .collect();
  ad_envelope(&format!(
    "<AccountType>email</AccountType><Action>settings</Action>{list}<Protocol><Type>WEB</Type><External><OWAUrl AuthenticationMethod=\"Fba\">https://mail.example.com/owa/</OWAUrl></External></Protocol>"
  ))
}

pub fn ad_redirect_addr(address: &str) -> String {
  ad_envelope(&format!("<AccountType>email</AccountType><Action>redirectAddr</Action><RedirectAddr>{address}</RedirectAddr>"))
}

pub fn ad_redirect_url(url: &str) -> String {
  ad_envelope(&format!("<AccountType>email</AccountType><Action>redirectUrl</Action><RedirectUrl>{url}</RedirectUrl>"))
}

/// An error answer, as Exchange sends it with HTTP 200.
pub fn ad_error(code: &str, message: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">"#,
      r#"<Response><Error Time="10:00:00.0000000" Id="1234567890"><ErrorCode>{code}</ErrorCode>"#,
      "<Message>{message}</Message><DebugData /></Error></Response></Autodiscover>"
    ),
    code = code,
    message = message
  )
}

/// A fake DNS server that answers one SRV name with one host.
pub fn serve_dns(name: &'static str, host: &'static str) -> std::net::SocketAddr {
  let socket = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
  let addr = socket.local_addr().unwrap();
  std::thread::spawn(move || loop {
    let mut buf = [0u8; 512];
    let Ok((len, from)) = socket.recv_from(&mut buf) else { return };
    let _ = socket.send_to(&dns_answer(&buf[..len], name, host), from);
  });
  addr
}

/// The answer to a query: the question again, and one SRV record (port 443)
/// when the name is the one known; else no record (NXDOMAIN).
fn dns_answer(query: &[u8], name: &str, host: &str) -> Vec<u8> {
  let asked = crate::ews_srv::query(name, u16::from_be_bytes([query[0], query[1]]));
  let known = query == asked.as_slice();
  let mut out = query.to_vec();
  out[2] = 0x81;
  out[3] = if known { 0x80 } else { 0x83 };
  out[7] = u8::from(known);
  if known {
    let mut target = Vec::new();
    for label in host.split('.') {
      target.push(label.len() as u8);
      target.extend_from_slice(label.as_bytes());
    }
    target.push(0);
    out.extend_from_slice(&[0xC0, 0x0C, 0, 33, 0, 1, 0, 0, 0x0E, 0x10]);
    out.extend_from_slice(&((6 + target.len()) as u16).to_be_bytes());
    out.extend_from_slice(&[0, 0, 0, 5, 0x01, 0xBB]);
    out.extend_from_slice(&target);
  }
  out
}
