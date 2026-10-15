//! Tests for ews_write.rs, against the fake server in ews_fixtures.rs.

use std::sync::Arc;

use super::*;
use crate::ews::guard_request;
use crate::ews_fixtures::{self as fx, Handler};

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

fn ids(range: std::ops::RangeInclusive<u32>) -> Vec<String> {
  range.map(fx::item_id).collect()
}

#[test]
fn the_read_request_sets_one_field_on_each_item() {
  let xml = read_flag_request(&ids(1..=2), true).unwrap();
  assert!(xml.contains(r#"MessageDisposition="SaveOnly""#), "{xml}");
  assert!(xml.contains(r#"ConflictResolution="AlwaysOverwrite""#), "{xml}");
  assert!(
    xml.contains(r#"<t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>true</t:IsRead></t:Message></t:SetItemField>"#),
    "{xml}"
  );
  assert_eq!(xml.matches("<t:ItemChange>").count(), 2, "{xml}");
}

#[test]
fn the_flag_request_writes_the_flag_status() {
  let xml = flag_request(&ids(1..=1), true).unwrap();
  assert!(xml.contains(r#"<t:FieldURI FieldURI="item:Flag"/>"#), "{xml}");
  assert!(xml.contains("<t:Flag><t:FlagStatus>Flagged</t:FlagStatus></t:Flag>"), "{xml}");
  let off = flag_request(&ids(1..=1), false).unwrap();
  assert!(off.contains("<t:FlagStatus>NotFlagged</t:FlagStatus>"), "{off}");
}

#[test]
fn the_move_request_asks_for_the_new_ids() {
  let xml = move_request(&ids(1..=1), &fx::folder_id(7)).unwrap();
  assert!(xml.contains(&format!(r#"<ToFolderId><t:FolderId Id="{}"/></ToFolderId>"#, fx::folder_id(7))), "{xml}");
  assert!(xml.contains("<ReturnNewItemIds>true</ReturnNewItemIds>"), "{xml}");
}

#[test]
fn the_delete_request_is_hard_and_names_each_item() {
  let xml = delete_request(&ids(1..=2)).unwrap();
  assert!(xml.contains(r#"DeleteType="HardDelete""#), "{xml}");
  assert_eq!(xml.matches("<t:ItemId Id=").count(), 2);
  assert!(guard_request(&xml).is_ok());
}

#[test]
fn no_request_is_made_with_no_item() {
  assert!(matches!(delete_request(&[]), Err(EwsError::Invalid(_))));
  assert!(matches!(delete_request(&["  ".to_string()]), Err(EwsError::Invalid(_))));
  assert!(matches!(move_request(&[], &fx::folder_id(1)), Err(EwsError::Invalid(_))));
  assert!(matches!(move_request(&ids(1..=1), " "), Err(EwsError::Invalid(_))));
  assert!(matches!(read_flag_request(&[], true), Err(EwsError::Invalid(_))));
}

#[test]
fn the_guard_refuses_what_empties_or_deletes_a_folder() {
  for body in [
    r#"<soap:Body><m:EmptyFolder DeleteType="HardDelete"><m:FolderIds><t:DistinguishedFolderId Id="deleteditems"/></m:FolderIds></m:EmptyFolder></soap:Body>"#,
    r#"<soap:Body><EmptyFolder DeleteType="HardDelete" DeleteSubFolders="true"/></soap:Body>"#,
    r#"<soap:Body><m:DeleteFolder DeleteType="HardDelete"><m:FolderIds><t:FolderId Id="x"/></m:FolderIds></m:DeleteFolder></soap:Body>"#,
    r#"<soap:Body><m:DeleteItem DeleteType="HardDelete"><m:ItemIds/></m:DeleteItem></soap:Body>"#,
    r#"<soap:Body><DeleteItem DeleteType="HardDelete"><ItemIds><t:ItemId Id=""/></ItemIds></DeleteItem></soap:Body>"#,
  ] {
    assert!(matches!(guard_request(body), Err(EwsError::Invalid(_))), "{body}");
  }
  // A body that only names the word is not a request to empty a folder.
  assert!(guard_request("<soap:Body><m:GetFolder><!-- EmptyFolder --></m:GetFolder></soap:Body>").is_ok());
}

#[test]
fn the_guard_stops_the_request_before_the_server() {
  let handler: Handler = Arc::new(|_, _| (200, fx::delete_answer(&[true])));
  let server = fx::serve(handler);
  let client = fx::client(&server.url);
  let empty = r#"<?xml version="1.0"?><soap:Envelope><soap:Body><m:EmptyFolder DeleteType="HardDelete"/></soap:Body></soap:Envelope>"#;
  assert!(matches!(run(client.call(empty)), Err(EwsError::Invalid(_))));
  assert!(matches!(run(client.call_many(empty)), Err(EwsError::Invalid(_))));
  assert_eq!(server.count.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn read_changes_go_ten_at_a_time_and_a_gone_item_is_done() {
  let handler: Handler = Arc::new(|_, body| {
    let asked: Vec<(u32, bool)> = (1..=12).filter(|n| body.contains(&fx::item_id(*n))).map(|n| (n, n != 3)).collect();
    (200, fx::update_answer(&asked))
  });
  let server = fx::serve(handler);
  let out = run(set_read(&fx::client(&server.url), &ids(1..=12), true)).unwrap();
  assert_eq!(out.done.len(), 12);
  assert!(out.failed.is_empty());
  // Said apart too: a change queued offline puts that row back.
  assert_eq!(out.gone, vec![fx::item_id(3)]);
  let requests = server.requests.lock().unwrap();
  let batches: Vec<usize> = requests.iter().map(|r| r.matches("<t:ItemChange>").count()).collect();
  assert_eq!(batches, vec![10, 2]);
}

#[test]
fn a_move_answers_the_new_ids_in_order() {
  let handler: Handler = Arc::new(|_, _| (200, fx::move_answer(&[Some(101), None, Some(103)])));
  let server = fx::serve(handler);
  let out = run(move_items(&fx::client(&server.url), &ids(1..=3), &fx::folder_id(7))).unwrap();
  assert_eq!(out.moved[0], Moved { id: fx::item_id(1), new_id: Some(fx::item_id(101)) });
  assert_eq!(out.moved[1], Moved { id: fx::item_id(2), new_id: None });
  assert_eq!(out.moved[2].new_id.as_deref(), Some(fx::item_id(103).as_str()));
}

#[test]
fn a_failed_item_is_reported_and_the_rest_are_done() {
  let handler: Handler = Arc::new(|_, _| {
    let messages = vec![
      fx::success("DeleteItem", ""),
      fx::error("DeleteItem", "ErrorAccessDenied", "Access is denied. Check credentials and try again."),
    ];
    (200, fx::response("DeleteItem", &messages))
  });
  let server = fx::serve(handler);
  let out = run(delete_forever(&fx::client(&server.url), &ids(1..=2))).unwrap();
  assert_eq!(out.done, vec![fx::item_id(1)]);
  assert_eq!(out.failed.len(), 1);
  assert!(out.failed[0].error.starts_with("ews:fault: ErrorAccessDenied"), "{}", out.failed[0].error);
}

#[test]
fn the_strict_server_takes_every_write_request() {
  let handler: Handler = Arc::new(|operation, body| match operation {
    "UpdateItem" => (200, fx::update_answer(&[(1, true)])),
    "MoveItem" => (200, fx::move_answer(&[Some(9)])),
    "DeleteItem" => (200, fx::delete_answer(&[true])),
    _ => (500, fx::fault("ErrorInvalidRequest", body)),
  });
  let server = fx::serve(handler);
  let client = fx::client(&server.url);
  let one = ids(1..=1);
  assert!(run(set_read(&client, &one, false)).unwrap().failed.is_empty());
  assert!(run(set_flag(&client, &one, true)).unwrap().failed.is_empty());
  assert_eq!(run(move_items(&client, &one, &fx::folder_id(2))).unwrap().moved.len(), 1);
  assert_eq!(run(delete_forever(&client, &one)).unwrap().done.len(), 1);
}

/*
  The rules the queued actions lean on (docs/mail-local-store.md, 7), as the
  KU server keeps them: a moved item has a new id, and the old one is gone
  after; and a refused password is asked once and never again.
*/
#[test]
fn a_moved_item_answers_to_its_new_id_only() {
  let moved = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
  let seen = moved.clone();
  let handler: Handler = Arc::new(move |operation, body| {
    let asked: Vec<u32> = (1..=3).filter(|n| body.contains(&fx::item_id(*n))).collect();
    let mut gone = seen.lock().unwrap();
    match operation {
      "MoveItem" => {
        let answer: Vec<Option<u32>> = asked
          .iter()
          .map(|n| if gone.contains(&fx::item_id(*n)) { None } else { Some(n + 100) })
          .collect();
        gone.extend(asked.iter().map(|n| fx::item_id(*n)));
        (200, fx::move_answer(&answer))
      }
      "UpdateItem" => {
        let answer: Vec<(u32, bool)> = asked.iter().map(|n| (*n, !gone.contains(&fx::item_id(*n)))).collect();
        (200, fx::update_answer(&answer))
      }
      _ => (500, fx::fault("ErrorInvalidRequest", body)),
    }
  });
  let server = fx::serve(handler);
  let client = fx::client(&server.url);
  let out = run(move_items(&client, &ids(1..=2), &fx::folder_id(7))).unwrap();
  assert_eq!(out.moved[0].new_id.as_deref(), Some(fx::item_id(101).as_str()));
  // The same item again, by its old id: gone, with no new id.
  let again = run(move_items(&client, &ids(1..=1), &fx::folder_id(8))).unwrap();
  assert_eq!(again.moved, vec![Moved { id: fx::item_id(1), new_id: None }]);
  let read = run(set_read(&client, &ids(2..=3), true)).unwrap();
  assert_eq!(read.gone, vec![fx::item_id(2)]);
  assert_eq!(read.done.len(), 2);
}

#[test]
fn a_refused_password_is_not_asked_again() {
  let handler: Handler = Arc::new(|_, _| (200, fx::move_answer(&[Some(9)])));
  let server = fx::serve(handler);
  let client = crate::ews::EwsClient::new(crate::ews::EwsSettings {
    url: server.url.clone(),
    username: "someone@example.com".into(),
    password: "wrong".into(),
  })
  .unwrap();
  let first = run(move_items(&client, &ids(1..=1), &fx::folder_id(2)));
  assert!(matches!(first, Err(EwsError::Refused)), "{first:?}");
  let asked = server.count.load(std::sync::atomic::Ordering::SeqCst);
  let second = run(move_items(&client, &ids(1..=1), &fx::folder_id(2)));
  assert!(matches!(second, Err(EwsError::Refused)), "{second:?}");
  assert_eq!(server.count.load(std::sync::atomic::Ordering::SeqCst), asked, "the second move went to the server");
  assert!(server.requests.lock().unwrap().is_empty(), "no request got past the sign-in");
}

#[test]
#[ignore]
fn print_write_requests() {
  for r in [read_flag_request(&["I1".into()], true).unwrap(), move_request(&["I1".into()], "F1").unwrap(), delete_request(&["I1".into()]).unwrap()] {
    println!("{}\n", r.split("<soap:Body>").nth(1).unwrap_or(""));
  }
}
