//! Tests for ews_ops.rs, with the fixtures in ews_fixtures.rs.

use super::*;
use crate::ews_fixtures::*;

#[test]
fn requests_carry_the_2013_version() {
  for request in [
    inbox_request().unwrap(),
    hierarchy_request(None).unwrap(),
    well_known_request().unwrap(),
    items_request(&folder_id(1), None).unwrap(),
    rows_request(&[item_id(1)]).unwrap(),
    mime_request(&[item_id(1)]).unwrap(),
  ] {
    assert!(request.contains(r#"Version="Exchange2013_SP1""#), "{request}");
    assert!(request.starts_with(r#"<?xml version="1.0" encoding="utf-8"?>"#));
  }
}

#[test]
fn the_items_request_asks_for_ids_only_and_256() {
  let request = items_request(&folder_id(3), Some(sync_state(1))).unwrap();
  assert!(request.contains("<t:BaseShape>IdOnly</t:BaseShape>"), "{request}");
  assert!(request.contains("<MaxChangesReturned>256</MaxChangesReturned>"), "{request}");
  assert!(request.contains(&folder_id(3)));
  assert!(request.contains(&sync_state(1)));
  // Left out: the crate writes it in a form the schema does not take.
  assert!(!request.contains("SyncScope"), "{request}");
}

#[test]
fn the_rows_request_does_not_ask_for_the_body() {
  let request = rows_request(&[item_id(1), item_id(2)]).unwrap();
  assert!(request.contains(r#"FieldURI="message:ToRecipients""#), "{request}");
  assert!(request.contains(r#"FieldURI="item:Preview""#));
  assert!(!request.contains("item:Body"));
  assert!(!request.contains("item:Attachments"));
  assert_eq!(request.matches("<t:ItemId ").count(), 2);
}

#[test]
fn the_mime_request_asks_for_mime() {
  let request = mime_request(&[item_id(4)]).unwrap();
  assert!(request.contains("<t:IncludeMimeContent>true</t:IncludeMimeContent>"), "{request}");
}

#[test]
fn reads_the_inbox() {
  let inbox = FolderFixture::mail(1, 99, "Inbox", 1204, 17);
  let summary = read_inbox(&get_folders(&[&inbox])).unwrap();
  assert_eq!(summary.display_name, "Inbox");
  assert_eq!((summary.total_count, summary.unread_count), (1204, 17));
}

#[test]
fn a_fault_is_an_error_with_its_code() {
  let xml = fault("ErrorInvalidSyncStateData", "Synchronization state data is corrupt or otherwise invalid.");
  let err = read_items_page(&xml).unwrap_err();
  assert_eq!(
    err,
    EwsError::Fault {
      code: "ErrorInvalidSyncStateData".into(),
      message: "Synchronization state data is corrupt or otherwise invalid.".into(),
    }
  );
  assert!(err.to_string().starts_with("ews:fault: ErrorInvalidSyncStateData: "));
}

#[test]
fn an_answer_with_no_header_is_refused_without_a_panic() {
  let xml = r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>"#;
  assert!(matches!(read_hierarchy(xml), Err(EwsError::Parse(_))));
  assert!(matches!(read_rows("not xml at all"), Err(EwsError::Parse(_))));
}

#[test]
fn reads_a_hierarchy_page_and_drops_other_folder_kinds() {
  let inbox = FolderFixture::mail(1, 99, "Inbox", 10, 2);
  let calendar = FolderFixture { element: "CalendarFolder", class: Some("IPF.Appointment"), ..FolderFixture::mail(2, 99, "Calendar", 0, 0) };
  let yammer = FolderFixture { class: Some("IPF"), ..FolderFixture::mail(3, 99, "Yammer Root", 0, 0) };
  let page = read_hierarchy(&hierarchy_answer(&[&inbox, &calendar, &yammer], &[7], &sync_state(2), true)).unwrap();
  // The calendar goes by its element. Yammer Root is a plain Folder and is
  // judged by its class after GetFolder.
  assert_eq!(page.changed, vec![folder_id(1), folder_id(3)]);
  assert_eq!(page.deleted, vec![folder_id(7)]);
  assert_eq!(page.sync_state, sync_state(2));
  assert!(page.last);
}

#[test]
fn reads_folders_and_keeps_mail_folders_only() {
  let inbox = FolderFixture::mail(1, 99, "Inbox", 10, 2);
  let sub = FolderFixture { class: Some("IPF.Note.Custom"), ..FolderFixture::mail(4, 1, "Projects", 3, 1) };
  let plain = FolderFixture { class: None, ..FolderFixture::mail(5, 99, "No class", 0, 0) };
  let config = FolderFixture { class: Some("IPF.Configuration"), ..FolderFixture::mail(6, 99, "Settings", 0, 0) };
  let files = FolderFixture { class: Some("IPF.Files"), ..FolderFixture::mail(8, 99, "Files", 0, 0) };
  let folders = read_folders(&get_folders(&[&inbox, &sub, &plain, &config, &files])).unwrap();
  let kept: Vec<&str> = folders.iter().filter(|f| is_mail_folder(f)).map(|f| f.name.as_str()).collect();
  assert_eq!(kept, vec!["Inbox", "Projects", "No class"]);
  assert_eq!(folders[1].parent_id.as_deref(), Some(folder_id(1).as_str()));
  assert_eq!((folders[0].total, folders[0].unread), (10, 2));
}

#[test]
fn a_folder_that_went_is_left_out() {
  let inbox = FolderFixture::mail(1, 99, "Inbox", 10, 2);
  let xml = response(
    "GetFolder",
    &[
      success("GetFolder", &format!("<m:Folders>{}</m:Folders>", inbox.xml())),
      error("GetFolder", "ErrorFolderNotFound", "The specified folder could not be found in the store."),
    ],
  );
  assert_eq!(read_folders(&xml).unwrap().len(), 1);
}

#[test]
fn reads_the_well_known_folders_in_order() {
  // No archive in this mailbox.
  let pairs = read_well_known(&well_known_answer([1, 2, 3, 4, 5, 6, 0, 99])).unwrap();
  let names: Vec<&str> = pairs.iter().map(|(n, _)| n.as_str()).collect();
  assert_eq!(names, vec!["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "outbox", "msgfolderroot"]);
  assert_eq!(pairs[0].1, folder_id(1));
  assert_eq!(pairs[6].1, folder_id(99));
}

#[test]
fn reads_an_items_page() {
  let changes = [
    ItemChange::Create(1),
    ItemChange::Update(2),
    ItemChange::ReadFlag(3, true),
    ItemChange::Delete(4),
    // A create and a delete of the same item in one page: gone.
    ItemChange::Create(5),
    ItemChange::Delete(5),
    // A read flag on an item created in the same page: one row.
    ItemChange::ReadFlag(1, false),
  ];
  let page = read_items_page(&sync_items_answer(&changes, &sync_state(3), false)).unwrap();
  assert_eq!(page.changed, vec![item_id(1), item_id(2), item_id(3)]);
  assert_eq!(page.deleted, vec![item_id(4), item_id(5)]);
  assert!(!page.last);
  assert_eq!(page.sync_state.len(), sync_state(3).len());
}

#[test]
fn an_empty_items_page_is_the_last() {
  let page = read_items_page(&sync_items_answer(&[], &sync_state(4), true)).unwrap();
  assert!(page.changed.is_empty() && page.deleted.is_empty() && page.last);
}

#[test]
fn reads_rows() {
  let xml = get_items(&[Some(message_row(2, "Budget &amp; plan", false, "Flagged")), None]);
  let rows = read_rows(&xml).unwrap();
  assert_eq!(rows.len(), 1);
  let row = &rows[0];
  assert_eq!(row.id, item_id(2));
  assert_eq!(row.id.len(), 152);
  assert_eq!(row.conversation_id.as_deref(), Some(conversation_id(2).as_str()));
  assert_eq!(row.subject, "Budget & plan");
  assert_eq!(row.from, Some(Address { name: "Dana Example".into(), email: "dana@example.com".into() }));
  // Addresses in lower case.
  assert_eq!(row.to[0].email, "sam@example.com");
  assert_eq!(row.cc[0].name, "Kim Example");
  assert!(!row.is_read);
  assert_eq!(row.flag_status.as_deref(), Some("Flagged"));
  assert_eq!(row.preview, "A preview of message 2, with & in it.");
  assert!(row.has_attachments);
  assert_eq!(row.internet_message_id.as_deref(), Some("<msg2@mail.example.com>"));
  // 2026-09-22T08:12:00Z
  assert_eq!(row.received_at, Some(1_790_064_720_000));
  assert_eq!(row.size, Some(4221));
}

#[test]
fn reads_mime_in_the_order_asked() {
  let xml = get_items(&[Some(message_mime(1, &raw_message(1))), None]);
  let ids = [item_id(1), item_id(2)];
  let out = read_mime(&xml, &ids).unwrap();
  assert_eq!(out[0].0, item_id(1));
  let raw = out[0].1.as_ref().unwrap();
  assert!(String::from_utf8_lossy(raw).contains("Subject: Plan 1"));
  assert_eq!(out[1], (item_id(2), None));
}

#[test]
fn batches_are_ten() {
  let ids: Vec<String> = (0..23).map(item_id).collect();
  let sizes: Vec<usize> = batches(&ids).map(<[String]>::len).collect();
  assert_eq!(sizes, vec![10, 10, 3]);
}

#[test]
#[ignore]
fn print_requests() {
  for r in [
    inbox_request().unwrap(),
    hierarchy_request(Some("S".into())).unwrap(),
    folders_request(&["F1".into()]).unwrap(),
    well_known_request().unwrap(),
    rows_request(&["I1".into()]).unwrap(),
    mime_request(&["I1".into()]).unwrap(),
  ] {
    println!("{r}\n");
  }
}
