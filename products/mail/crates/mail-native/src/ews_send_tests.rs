//! Tests for ews_send.rs, against the fake server in ews_fixtures.rs.

use std::sync::Arc;

use base64::Engine;

use super::*;
use crate::ews_fixtures::{self as fx, Handler};

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

fn mime() -> String {
  base64::engine::general_purpose::STANDARD.encode(fx::raw_message(1).as_bytes())
}

#[test]
fn the_send_request_sends_and_saves_a_copy() {
  let xml = send_request(&mime(), &["hidden@example.com".into()]).unwrap();
  assert!(xml.contains(r#"MessageDisposition="SendAndSaveCopy""#), "{xml}");
  assert!(xml.contains(r#"<SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></SavedItemFolderId>"#), "{xml}");
  assert!(xml.contains(r#"<t:MimeContent CharacterSet="UTF-8">"#), "{xml}");
  assert!(
    xml.contains("<t:BccRecipients><t:Mailbox><t:EmailAddress>hidden@example.com</t:EmailAddress></t:Mailbox></t:BccRecipients>"),
    "{xml}"
  );
}

#[test]
fn no_bcc_no_bcc_element() {
  let xml = send_request(&mime(), &[" ".into()]).unwrap();
  assert!(!xml.contains("BccRecipients"), "{xml}");
}

#[test]
fn an_empty_or_too_large_message_is_not_sent() {
  assert!(matches!(send_request("", &[]), Err(EwsError::Invalid(_))));
  let huge = "A".repeat(MAX_MIME_BASE64 + 4);
  assert!(matches!(send_request(&huge, &[]), Err(EwsError::Invalid(_))));
}

#[test]
fn a_send_goes_to_the_strict_server_once() {
  let handler: Handler = Arc::new(|operation, body| match operation {
    "CreateItem" if body.contains(&mime()) => (200, fx::create_answer(None)),
    _ => (500, fx::fault("ErrorInvalidRequest", "The request is invalid.")),
  });
  let server = fx::serve(handler);
  let sent = run(send(&fx::client(&server.url), &mime(), &[])).unwrap();
  assert!(sent.sent);
  assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[test]
fn a_refused_send_is_an_error() {
  let handler: Handler = Arc::new(|_, _| {
    let message = fx::error("CreateItem", "ErrorQuotaExceeded", "The mailbox quota has been exceeded.");
    (200, fx::response("CreateItem", &[message]))
  });
  let server = fx::serve(handler);
  let err = run(send(&fx::client(&server.url), &mime(), &[])).unwrap_err();
  assert!(err.to_string().starts_with("ews:fault: ErrorQuotaExceeded"), "{err}");
}

#[test]
fn a_draft_is_saved_into_drafts_with_the_unsent_flag() {
  let xml = save_draft_request(&mime(), &[]).unwrap();
  assert!(xml.contains(r#"MessageDisposition="SaveOnly""#), "{xml}");
  assert!(xml.contains(r#"<t:DistinguishedFolderId Id="drafts"/>"#), "{xml}");
  assert!(
    xml.contains(r#"<t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="0x0E07" PropertyType="Integer"/><t:Value>9</t:Value></t:ExtendedProperty>"#),
    "{xml}"
  );
}

#[test]
fn a_draft_is_never_deleted_hard() {
  let soft = delete_draft_request(&fx::item_id(1), false).unwrap();
  assert!(soft.contains(r#"DeleteType="SoftDelete""#), "{soft}");
  let discard = delete_draft_request(&fx::item_id(1), true).unwrap();
  assert!(discard.contains(r#"DeleteType="MoveToDeletedItems""#), "{discard}");
  assert!(!soft.contains("HardDelete") && !discard.contains("HardDelete"));
  assert!(matches!(delete_draft_request(" ", false), Err(EwsError::Invalid(_))));
}

#[test]
fn a_new_version_is_saved_and_then_the_old_one_goes() {
  let handler: Handler = Arc::new(|operation, body| match operation {
    "CreateItem" => (200, fx::create_answer(Some(20))),
    "DeleteItem" if body.contains(&fx::item_id(10)) && body.contains("SoftDelete") => (200, fx::delete_answer(&[true])),
    _ => (500, fx::fault("ErrorInvalidRequest", "The request is invalid.")),
  });
  let server = fx::serve(handler);
  let saved = run(save_draft(&fx::client(&server.url), &mime(), &[], Some(&fx::item_id(10)))).unwrap();
  assert_eq!(saved.item_id, fx::item_id(20));
  let requests = server.requests.lock().unwrap();
  assert_eq!(requests.len(), 2);
  assert!(requests[0].contains("<CreateItem") && requests[1].contains("<DeleteItem"));
}

#[test]
fn a_failed_save_keeps_the_old_version() {
  let handler: Handler = Arc::new(|_, _| (500, fx::fault("ErrorServerBusy", "The server cannot service this request right now.")));
  let server = fx::serve(handler);
  assert!(run(save_draft(&fx::client(&server.url), &mime(), &[], Some(&fx::item_id(10)))).is_err());
  let requests = server.requests.lock().unwrap();
  assert!(requests.iter().all(|r| !r.contains("<DeleteItem")));
}

#[test]
fn a_draft_already_gone_is_deleted() {
  let handler: Handler = Arc::new(|_, _| (200, fx::delete_answer(&[false])));
  let server = fx::serve(handler);
  assert!(run(delete_draft(&fx::client(&server.url), &fx::item_id(3), true)).is_ok());
}
