//! Folder edits against the fake server, which is as strict as the KU
//! server (section 10 of `docs/mail-exchange-ews.md`). Invented data only.

use std::sync::{Arc, Mutex};

use super::*;
use crate::ews::guard_request;
use crate::ews_fixtures::{self as fx, Handler};

fn run<F: std::future::Future>(future: F) -> F::Output {
  tauri::async_runtime::block_on(future)
}

fn folder_answer(operation: &str, id: &str, key: &str) -> String {
  let folder = format!(r#"<m:Folders><t:Folder><t:FolderId Id="{id}" ChangeKey="{key}"/></t:Folder></m:Folders>"#);
  fx::response(operation, &[fx::success(operation, &folder)])
}

#[test]
fn a_new_folder_is_a_mail_folder_under_its_parent() {
  let xml = create_request(&fx::folder_id(1), "  Receipts ").unwrap();
  assert!(xml.contains(&format!(r#"<ParentFolderId><t:FolderId Id="{}"/></ParentFolderId>"#, fx::folder_id(1))), "{xml}");
  assert!(xml.contains("<t:FolderClass>IPF.Note</t:FolderClass>"), "{xml}");
  assert!(xml.contains("<t:DisplayName>Receipts</t:DisplayName>"), "{xml}");
}

#[test]
fn a_bad_name_or_id_sends_nothing() {
  assert!(create_request(&fx::folder_id(1), "  ").is_err());
  assert!(create_request(&fx::folder_id(1), "a/b").is_err());
  assert!(create_request("", "Receipts").is_err());
  assert!(rename_request(&fx::folder_id(1), &fx::change_key(1), "").is_err());
  assert!(move_request(" ", None).is_err());
}

#[test]
fn a_rename_names_the_change_key() {
  let xml = rename_request(&fx::folder_id(2), &fx::change_key(2), "Bills").unwrap();
  assert!(xml.contains(&format!(r#"ChangeKey="{}""#, fx::change_key(2))), "{xml}");
  assert!(xml.contains(r#"<t:FieldURI FieldURI="folder:DisplayName"/>"#), "{xml}");
  assert!(xml.contains("<t:DisplayName>Bills</t:DisplayName>"), "{xml}");
}

#[test]
fn delete_is_a_move_to_deleted_items_and_passes_the_guard() {
  let xml = move_request(&fx::folder_id(3), None).unwrap();
  assert!(xml.contains("<MoveFolder"), "{xml}");
  assert!(xml.contains(r#"<t:DistinguishedFolderId Id="deleteditems"/>"#), "{xml}");
  assert!(!xml.contains("DeleteFolder"), "{xml}");
  guard_request(&xml).unwrap();
}

#[test]
fn create_rename_and_move_go_through_the_strict_server() {
  let seen = Arc::new(Mutex::new(Vec::<String>::new()));
  let log = seen.clone();
  let handler: Handler = Arc::new(move |operation, body| {
    log.lock().unwrap().push(operation.to_string());
    match operation {
      "CreateFolder" => (200, folder_answer("CreateFolder", &fx::folder_id(9), &fx::change_key(9))),
      "GetFolder" => (200, folder_answer("GetFolder", &fx::folder_id(9), &fx::change_key(10))),
      "UpdateFolder" if body.contains(&fx::change_key(10)) => (200, folder_answer("UpdateFolder", &fx::folder_id(9), &fx::change_key(11))),
      "MoveFolder" => (200, folder_answer("MoveFolder", &fx::folder_id(9), &fx::change_key(12))),
      _ => (500, fx::fault("ErrorInvalidRequest", "The request is invalid.")),
    }
  });
  let server = fx::serve(handler);
  let client = fx::client(&server.url);
  let made = run(create_folder(&client, &fx::folder_id(1), "Receipts")).unwrap();
  assert_eq!(made.id, fx::folder_id(9));
  assert_eq!(made.parent_id.as_deref(), Some(fx::folder_id(1).as_str()));
  assert_eq!(made.name, "Receipts");
  run(rename_folder(&client, &made.id, "Bills")).unwrap();
  run(move_folder(&client, &made.id, None)).unwrap();
  let ops = seen.lock().unwrap().clone();
  assert_eq!(ops, vec!["CreateFolder", "GetFolder", "UpdateFolder", "MoveFolder"]);
}

#[test]
fn a_refused_create_is_an_error() {
  let handler: Handler = Arc::new(|_, _| {
    let message = fx::error("CreateFolder", "ErrorFolderExists", "A folder with the specified name already exists.");
    (200, fx::response("CreateFolder", &[message]))
  });
  let server = fx::serve(handler);
  let err = run(create_folder(&fx::client(&server.url), &fx::folder_id(1), "Receipts")).unwrap_err();
  assert!(err.to_string().starts_with("ews:fault: ErrorFolderExists"), "{err}");
}
