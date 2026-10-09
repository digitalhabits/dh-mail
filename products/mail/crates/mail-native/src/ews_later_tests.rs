//! Tests for ews_later.rs, against the fake server in ews_fixtures.rs.

use std::sync::Arc;

use super::*;
use crate::ews_fixtures::*;

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

/// A server that answers every call of this module.
fn handler() -> Handler {
  Arc::new(|operation, body| match operation {
    "CreateItem" => (200, create_answer(None)),
    "FindItem" => (200, held_answer(&[(1, Some("2026-10-01T08:00:00Z")), (2, None), (3, Some("2026-09-30T07:00:00Z"))])),
    "GetItem" if body.contains("IncludeMimeContent>true") => {
      let items: Vec<Option<String>> =
        [1u32, 3].iter().filter(|n| body.contains(&item_id(**n))).map(|n| Some(message_mime(*n, &raw_message(*n)))).collect();
      (200, get_items(&items))
    }
    "GetItem" => {
      let rows: Vec<Option<String>> =
        [1u32, 3].iter().filter(|n| body.contains(&item_id(**n))).map(|n| Some(message_row(*n, "Held", true, "NotFlagged"))).collect();
      (200, get_items(&rows))
    }
    "MoveItem" if body.contains(r#"<t:DistinguishedFolderId Id="drafts"/>"#) => (200, move_answer(&[Some(40)])),
    "UpdateItem" => (200, update_answer(&[(40, true)])),
    "SendItem" => (200, response("SendItem", &[success("SendItem", "")])),
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  })
}

#[test]
fn the_list_has_the_held_messages_soonest_first() {
  let server = serve(handler());
  let list = run(held_at(&client(&server.url), "2026-09-27T12:00:00Z")).unwrap();
  // Item 2 has no time: it is on its way now, and is not listed.
  let ids: Vec<&str> = list.iter().map(|h| h.row.id.as_str()).collect();
  assert_eq!(ids, vec![item_id(3).as_str(), item_id(1).as_str()]);
  assert_eq!(list[0].send_at, "2026-09-30T07:00:00Z");
  assert_eq!(list[0].row.to[0].email, "sam@example.com");
  // The whole body, for Edit.
  assert_eq!(list[0].html.as_deref(), Some("<p>The plan for day 3.</p>"));
  let find = server.requests.lock().unwrap()[0].clone();
  assert!(find.contains(r#"<t:DistinguishedFolderId Id="outbox"/>"#), "{find}");
  assert!(find.contains(r#"<t:DistinguishedFolderId Id="sentitems"/>"#), "{find}");
  let json = serde_json::to_value(&list[0]).unwrap();
  assert_eq!(json["sendAt"], "2026-09-30T07:00:00Z");
  assert_eq!(json["subject"], "Held");
}

#[test]
fn cancel_moves_to_drafts_and_takes_the_time_off() {
  let server = serve(handler());
  let done = run(cancel(&client(&server.url), &item_id(1))).unwrap();
  assert_eq!(done.item_id, item_id(40));
  let requests = server.requests.lock().unwrap().clone();
  assert_eq!(requests.len(), 2);
  assert!(requests[0].contains("<MoveItem") && requests[0].contains(&item_id(1)));
  // The clear names the new id, and says AlwaysOverwrite (section 15.1).
  assert!(requests[1].contains("<t:DeleteItemField>") && requests[1].contains(&item_id(40)), "{}", requests[1]);
  assert!(requests[1].contains(r#"ConflictResolution="AlwaysOverwrite""#));
}

#[test]
fn send_now_sends_the_draft_with_its_new_change_key() {
  let server = serve(handler());
  run(send_now(&client(&server.url), &item_id(1))).unwrap();
  let requests = server.requests.lock().unwrap().clone();
  assert_eq!(requests.len(), 3);
  let send = &requests[2];
  assert!(send.contains(&format!(r#"Id="{}" ChangeKey="{}""#, item_id(40), change_key(540))), "{send}");
  assert!(send.contains(r#"<t:DistinguishedFolderId Id="sentitems"/>"#), "{send}");
}

#[test]
fn a_refused_move_is_an_error_and_nothing_more_goes() {
  let server = serve(Arc::new(|operation, _| match operation {
    "MoveItem" => (200, response("MoveItem", &[error("MoveItem", "ErrorMoveCopyFailed", "The move failed.")])),
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  }));
  let err = run(send_now(&client(&server.url), &item_id(1))).unwrap_err();
  assert!(err.to_string().contains("ErrorMoveCopyFailed"), "{err}");
  assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[test]
fn the_fake_server_refuses_what_the_real_one_does() {
  let server = serve(handler());
  let c = client(&server.url);
  let no_key = send_item_request(&item_id(40), "k").unwrap().replace(r#" ChangeKey="k""#, "");
  assert!(run(c.call(&no_key)).unwrap_err().to_string().contains("ErrorChangeKeyRequiredForWriteOperations"));
  let no_overwrite = clear_time_request(&item_id(40)).replace(r#" ConflictResolution="AlwaysOverwrite""#, "");
  assert!(run(c.call(&no_overwrite)).unwrap_err().to_string().contains("ErrorChangeKeyRequiredForWriteOperations"));
  assert!(send_item_request(&item_id(40), "").is_err());
}

#[test]
fn a_held_message_in_sent_items_is_listed_and_a_sent_one_is_not() {
  // Seen on KU (Exchange 2019): Outbox is empty, and the held message waits
  // in Sent Items as an unsent draft. A message that went keeps its time.
  let answer = held_answer_by_folder(&[], &[(5, Some("2026-09-27T12:35:00Z")), (6, Some("2026-09-27T11:34:00Z"))]);
  let times = read_held(&answer, "2026-09-27T11:40:00Z").unwrap();
  // In Sent Items: the server's, and the app cannot take it back.
  assert_eq!(times, vec![HeldTime { id: item_id(5), send_at: "2026-09-27T12:35:00Z".into(), cancellable: false }]);
  // In Outbox: the app can.
  let outbox = held_answer_by_folder(&[(7, Some("2026-09-27T12:35:00Z"))], &[]);
  assert!(read_held(&outbox, "2026-09-27T11:40:00Z").unwrap()[0].cancellable);
}

#[test]
fn now_is_utc_to_the_second() {
  let now = now_utc();
  assert_eq!(now.len(), 20, "{now}");
  assert!(now.ends_with('Z') && now.as_bytes()[10] == b'T', "{now}");
  assert!(now.as_str() > "2026-01-01T00:00:00Z", "{now}");
}

