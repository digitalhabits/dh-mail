//! Tests for ews_read.rs, against the fake server in ews_fixtures.rs.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::ews_fixtures::*;

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

/// A mailbox with an inbox, a subfolder of it, Sent Items, an Archive,
/// a calendar, and a non-mail plain folder.
fn mailbox_folders() -> Vec<FolderFixture> {
  vec![
    FolderFixture { children: 1, ..FolderFixture::mail(1, 99, "Inbox", 40, 3) },
    FolderFixture::mail(2, 99, "Sent Items", 12, 0),
    FolderFixture::mail(3, 1, "Projects", 5, 1),
    FolderFixture::mail(7, 99, "Archive", 300, 0),
    FolderFixture { element: "CalendarFolder", class: Some("IPF.Appointment"), ..FolderFixture::mail(20, 99, "Calendar", 0, 0) },
    FolderFixture { class: Some("IPF.Configuration"), ..FolderFixture::mail(21, 99, "Settings", 0, 0) },
  ]
}

/// A handler that answers the folder-list calls from `mailbox_folders`.
fn hierarchy_handler() -> Handler {
  Arc::new(|operation, body| {
    let folders = mailbox_folders();
    match operation {
      "SyncFolderHierarchy" => {
        let all: Vec<&FolderFixture> = folders.iter().collect();
        (200, hierarchy_answer(&all, &[], &sync_state(1), true))
      }
      "GetFolder" if body.contains("DistinguishedFolderId Id=\"inbox\"") => (200, well_known_answer([1, 2, 4, 5, 6, 8, 7, 99])),
      "GetFolder" => {
        let asked: Vec<&FolderFixture> = folders.iter().filter(|f| body.contains(&folder_id(f.n))).collect();
        (200, get_folders(&asked))
      }
      _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
    }
  })
}

#[test]
fn the_first_folder_sync_lists_mail_folders_and_the_well_known_ids() {
  let server = serve(hierarchy_handler());
  let result = run(sync_hierarchy(&client(&server.url), None)).unwrap();
  let names: Vec<&str> = result.folders.iter().map(|f| f.name.as_str()).collect();
  // The calendar goes by its element, and Settings by its class.
  assert_eq!(names, vec!["Inbox", "Sent Items", "Projects", "Archive"]);
  assert_eq!(result.folders[2].parent_id.as_deref(), Some(folder_id(1).as_str()));
  let known = result.well_known.unwrap();
  assert_eq!(known["inbox"], folder_id(1));
  assert_eq!(known["archive"], folder_id(7));
  assert_eq!(known["msgfolderroot"], folder_id(99));
  assert_eq!(result.sync_state, sync_state(1));
}

#[test]
fn a_later_folder_sync_does_not_ask_for_the_well_known_ids() {
  let server = serve(hierarchy_handler());
  let result = run(sync_hierarchy(&client(&server.url), Some(sync_state(0)))).unwrap();
  assert!(result.well_known.is_none());
  let requests = server.requests.lock().unwrap();
  assert!(requests.iter().all(|r| !r.contains("DistinguishedFolderId Id=\"inbox\"")));
  assert!(requests[0].contains(&sync_state(0)));
}

#[test]
fn folders_are_read_ten_at_a_time() {
  let handler: Handler = Arc::new(|operation, body| match operation {
    "SyncFolderHierarchy" => {
      let many: Vec<FolderFixture> = (1..=23).map(|n| FolderFixture::mail(n, 99, "Folder", 1, 0)).collect();
      (200, hierarchy_answer(&many.iter().collect::<Vec<_>>(), &[], &sync_state(1), true))
    }
    _ => {
      let many: Vec<FolderFixture> = (1..=23).map(|n| FolderFixture::mail(n, 99, "Folder", 1, 0)).collect();
      let asked: Vec<&FolderFixture> = many.iter().filter(|f| body.contains(&folder_id(f.n))).collect();
      (200, get_folders(&asked))
    }
  });
  let server = serve(handler);
  let result = run(sync_hierarchy(&client(&server.url), Some(sync_state(0)))).unwrap();
  assert_eq!(result.folders.len(), 23);
  let requests = server.requests.lock().unwrap();
  let batches: Vec<usize> = requests.iter().skip(1).map(|r| r.matches("<t:FolderId ").count()).collect();
  assert_eq!(batches, vec![10, 10, 3]);
}

/// A handler for one folder: the pages in order, and the rows of items 1 to
/// 30, with item 13 gone before its row was read.
fn items_handler(pages: Vec<String>) -> Handler {
  let pages = std::sync::Mutex::new(pages.into_iter());
  Arc::new(move |operation, body| match operation {
    "SyncFolderItems" => (200, pages.lock().unwrap().next().expect("no more pages")),
    "GetItem" => {
      let items: Vec<Option<String>> = (1..=30)
        .filter(|n| body.contains(&format!("Id=\"{}\"", item_id(*n))))
        .map(|n| if n == 13 { None } else { Some(message_row(n, &format!("Message {n}"), n % 3 == 0, "NotFlagged")) })
        .collect();
      (200, get_items(&items))
    }
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  })
}

#[test]
fn an_items_page_brings_the_rows_ten_at_a_time() {
  let changes: Vec<ItemChange> = (1..=12).map(ItemChange::Create).chain([ItemChange::Delete(25), ItemChange::ReadFlag(14, true)]).collect();
  let server = serve(items_handler(vec![sync_items_answer(&changes, &sync_state(5), false)]));
  let page = run(sync_items(&client(&server.url), &folder_id(1), None, &BTreeMap::new())).unwrap();
  // 13 changed ids: 1 to 12 and 14. Item 13 was not in the page.
  assert_eq!(page.items.len(), 13);
  assert_eq!(page.items[0].subject, "Message 1");
  assert_eq!(page.deleted, vec![item_id(25)]);
  assert!(!page.last_page);
  assert_eq!(page.sync_state, sync_state(5));
  let requests = server.requests.lock().unwrap();
  let batches: Vec<usize> = requests.iter().skip(1).map(|r| r.matches("<t:ItemId ").count()).collect();
  assert_eq!(batches, vec![10, 3]);
  // The strict server refuses the body with the recipients. None was asked.
  assert!(requests.iter().all(|r| !r.contains("item:Body")));
}

#[test]
fn an_item_that_went_before_its_row_is_left_out() {
  let changes = [ItemChange::Create(12), ItemChange::Create(13)];
  let server = serve(items_handler(vec![sync_items_answer(&changes, &sync_state(6), true)]));
  let page = run(sync_items(&client(&server.url), &folder_id(1), Some(sync_state(5)), &BTreeMap::new())).unwrap();
  assert_eq!(page.items.iter().map(|r| r.id.clone()).collect::<Vec<_>>(), vec![item_id(12)]);
  assert!(page.last_page);
}

#[test]
fn a_bad_sync_state_is_a_fault_the_worker_can_read() {
  let handler: Handler = Arc::new(|_, _| {
    (500, fault("ErrorInvalidSyncStateData", "Synchronization state data is corrupt or otherwise invalid."))
  });
  let server = serve(handler);
  let err = run(sync_items(&client(&server.url), &folder_id(1), Some("bad".into()), &BTreeMap::new())).unwrap_err();
  assert!(err.to_string().starts_with("ews:fault: ErrorInvalidSyncStateData: "), "{err}");
}

#[test]
fn a_busy_server_gives_its_back_off() {
  let handler: Handler = Arc::new(|_, _| {
    let body = fault("ErrorServerBusy", "The server cannot service this request right now. Try again later.").replace(
      "</detail>",
      r#"<t:MessageXml xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><t:Value Name="BackOffMilliseconds">4500</t:Value></t:MessageXml></detail>"#,
    );
    (500, body)
  });
  let server = serve(handler);
  let err = run(sync_hierarchy(&client(&server.url), None)).unwrap_err();
  assert_eq!(err, EwsError::Busy(Some(4500)));
}

#[test]
fn the_request_carries_the_version_the_server_wants() {
  let server = serve(hierarchy_handler());
  run(sync_hierarchy(&client(&server.url), None)).unwrap();
  assert!(server.requests.lock().unwrap().iter().all(|r| r.contains(r#"Version="Exchange2013_SP1""#)));
}

fn mime_handler() -> Handler {
  Arc::new(|operation, body| match operation {
    "GetItem" if body.contains("IncludeMimeContent") => {
      let items: Vec<Option<String>> = [1u32, 2]
        .iter()
        .filter(|n| body.contains(&item_id(**n)))
        .map(|n| if *n == 2 { None } else { Some(message_mime(*n, &raw_message(*n))) })
        .collect();
      (200, get_items(&items))
    }
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  })
}

fn row(n: u32) -> serde_json::Value {
  json!({
    "messageId": item_id(n), "threadId": conversation_id(n), "fromName": "Dana Example",
    "fromEmail": "dana@example.com", "to": [], "cc": [], "bcc": [], "subject": format!("Plan {n}"),
    "snippet": "", "sentAt": 1_790_064_720_000i64, "hasAttachments": true, "unread": false,
    "starred": false, "isDraft": false, "labels": ["INBOX"]
  })
}

#[test]
fn bodies_are_read_from_the_mime_and_kept() {
  let server = serve(mime_handler());
  let db = MailDb::open_in_memory().unwrap();
  db.call("messages.upsertMany", &json!({"account": "someone@example.com", "rows": [row(1), row(2)]})).unwrap();
  let raw = run(raw_messages(&client(&server.url), &[item_id(1), item_id(2)])).unwrap();
  assert_eq!(keep_bodies(&db, "someone@example.com", raw), 1);
  let thread = db
    .call("messages.thread", &json!({"account": "someone@example.com", "threadId": conversation_id(1)}))
    .unwrap();
  let body = &thread["messages"][0]["body"];
  assert_eq!(body["html"], "<p>The plan for day 1.</p>");
  assert_eq!(body["attachments"][0]["filename"], "plan.pdf");
  assert_eq!(body["attachments"][0]["section"], "2");
}

#[test]
fn the_source_is_the_whole_mime_of_one_item() {
  let server = serve(mime_handler());
  let encoded = run(fetch_source(&client(&server.url), &item_id(1))).unwrap();
  let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).unwrap();
  assert_eq!(bytes, raw_message(1).into_bytes());
  // An item the server does not give is an error, not an empty message.
  let err = run(fetch_source(&client(&server.url), &item_id(2))).unwrap_err();
  assert!(err.to_string().contains("did not give"), "{err}");
}

#[test]
fn an_attachment_comes_from_the_mime_by_its_section() {
  let server = serve(mime_handler());
  let part = run(fetch_part(&client(&server.url), &item_id(1), "2")).unwrap();
  assert_eq!(part["mimeType"], "application/pdf");
  assert_eq!(part["filename"], "plan.pdf");
  assert_eq!(part["bytesBase64"], "JVBERi0x");
  assert!(run(fetch_part(&client(&server.url), &item_id(1), "../2")).is_err());
  assert!(run(fetch_part(&client(&server.url), &item_id(2), "2")).is_err());
}

// ---- The newest items first ------------------------------------------------

#[test]
fn the_newest_items_are_asked_for_newest_first() {
  let doc = ews_ops::newest_request(&folder_id(1), 200).unwrap();
  let sort = doc.find("<SortOrder>").expect("a sort order");
  let parents = doc.find("<ParentFolderIds").unwrap();
  let view = doc.find("IndexedPageItemView").unwrap();
  // Where the schema has it: after the view, before the folders.
  assert!(view < sort && sort < parents, "{doc}");
  assert!(doc.contains(r#"<t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder>"#));
  assert!(doc.contains(r#"MaxEntriesReturned="200""#));
}

#[test]
fn the_newest_items_come_with_their_rows_and_keys() {
  let handler: Handler = Arc::new(|operation, body| match operation {
    "FindItem" => (200, held_answer(&[(30, None), (29, None), (28, None)])),
    "GetItem" => {
      let items: Vec<Option<String>> = [30, 29, 28]
        .iter()
        .filter(|n| body.contains(&format!("Id=\"{}\"", item_id(**n))))
        .map(|n| Some(message_row(*n, &format!("Message {n}"), false, "NotFlagged")))
        .collect();
      (200, get_items(&items))
    }
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  });
  let server = serve(handler);
  let newest = run(newest_items(&client(&server.url), &folder_id(1), 3)).unwrap();
  let ids: Vec<String> = newest.items.iter().map(|r| r.id.clone()).collect();
  assert_eq!(ids, vec![item_id(30), item_id(29), item_id(28)]);
  assert_eq!(newest.keys.get(&item_id(29)), Some(&change_key(29)));
}

#[test]
fn rows_the_copy_has_as_they_are_are_not_read_again() {
  let changes: Vec<ItemChange> = (1..=12).map(ItemChange::Create).collect();
  let server = serve(items_handler(vec![sync_items_answer(&changes, &sync_state(5), false)]));
  let mut known = BTreeMap::new();
  for n in 1..=10 {
    known.insert(item_id(n), change_key(n));
  }
  // Item 11 changed since it was read: another key.
  known.insert(item_id(11), change_key(99));
  let page = run(sync_items(&client(&server.url), &folder_id(1), None, &known)).unwrap();
  assert_eq!(page.kept.len(), 10);
  let read: Vec<String> = page.items.iter().map(|r| r.id.clone()).collect();
  assert_eq!(read, vec![item_id(11), item_id(12)]);
  let requests = server.requests.lock().unwrap();
  assert_eq!(requests.len(), 2, "one page and one GetItem of two");
  assert_eq!(requests[1].matches("<t:ItemId ").count(), 2);
}

#[test]
fn a_read_flag_change_is_read_again_whatever_its_key() {
  let changes = [ItemChange::ReadFlag(4, true)];
  let server = serve(items_handler(vec![sync_items_answer(&changes, &sync_state(6), true)]));
  let known = BTreeMap::from([(item_id(4), change_key(4))]);
  let page = run(sync_items(&client(&server.url), &folder_id(1), Some(sync_state(5)), &known)).unwrap();
  assert!(page.kept.is_empty());
  assert_eq!(page.items.len(), 1);
}
