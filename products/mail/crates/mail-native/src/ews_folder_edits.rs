//! Folder edits of an Exchange account: create, rename, move, and "delete".
//!
//! Delete is a move to Deleted Items, with the folder's mail in it, as
//! Outlook does. It can be undone from there. The app never sends
//! `DeleteFolder`: the transport refuses it (`guard_request` in ews.rs).
//!
//! A rename sends the folder's `ChangeKey`, which it asks for first with a
//! `GetFolder`. The KU server refuses item writes with no `ChangeKey`
//! (section 10 of `docs/mail-exchange-ews.md`), and the kept folder tree
//! holds none.

use ews::create_folder::{CreateFolder, CreateFolderResponse};
use ews::get_folder::{GetFolder, GetFolderResponse};
use ews::move_folder::{MoveFolder, MoveFolderResponse};
use ews::update_folder::{FolderChange, FolderChanges, UpdateFolder, UpdateFolderResponse, Updates};
use ews::{BaseFolderId, BaseShape, CopyMoveFolderData, Folder, FolderShape, PathToElement};

use crate::ews::{EwsAccounts, EwsClient, EwsError, EwsResult};
use crate::ews_ops::{distinguished, document, folder_info, folder_ref, only, read, FolderInfo};
use crate::secrets::Secrets;

/// The class of a mail folder. Without it the server makes a folder that
/// Outlook does not show as a mail folder.
const MAIL_FOLDER_CLASS: &str = "IPF.Note";

fn check_id(id: &str, what: &str) -> EwsResult<()> {
  if id.trim().is_empty() {
    return Err(EwsError::Invalid(format!("No {what} was named. Nothing was sent to the server.")));
  }
  Ok(())
}

/// A folder name: not empty, and no `/`, which the app uses between the
/// parts of a path.
fn check_name(name: &str) -> EwsResult<String> {
  let name = name.trim();
  if name.is_empty() {
    return Err(EwsError::Invalid("The folder needs a name. Nothing was sent to the server.".into()));
  }
  if name.contains('/') {
    return Err(EwsError::Invalid("A folder name cannot hold \"/\". Nothing was sent to the server.".into()));
  }
  Ok(name.to_string())
}

/// A plain folder with only a name, and a class when it is new.
fn named_folder(name: &str, class: Option<&str>) -> Folder {
  Folder::Folder {
    folder_id: None,
    parent_folder_id: None,
    folder_class: class.map(str::to_string),
    display_name: Some(name.to_string()),
    total_count: None,
    child_folder_count: None,
    extended_property: None,
    unread_count: None,
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

pub fn create_request(parent_id: &str, name: &str) -> EwsResult<String> {
  check_id(parent_id, "parent folder")?;
  let name = check_name(name)?;
  document(CreateFolder {
    parent_folder_id: folder_ref(parent_id),
    folders: vec![named_folder(&name, Some(MAIL_FOLDER_CLASS))],
  })
}

/// `GetFolder`, `IdOnly`: the answer holds the folder's `ChangeKey`.
pub fn change_key_request(folder_id: &str) -> EwsResult<String> {
  check_id(folder_id, "folder")?;
  document(GetFolder { folder_shape: FolderShape { base_shape: BaseShape::IdOnly }, folder_ids: vec![folder_ref(folder_id)] })
}

pub fn rename_request(folder_id: &str, change_key: &str, name: &str) -> EwsResult<String> {
  check_id(folder_id, "folder")?;
  let name = check_name(name)?;
  document(UpdateFolder {
    folder_changes: FolderChanges {
      folder_change: FolderChange {
        folder_id: BaseFolderId::FolderId { id: folder_id.to_string(), change_key: Some(change_key.to_string()) },
        updates: Updates::SetFolderField {
          field_URI: PathToElement::FieldURI { field_URI: "folder:DisplayName".to_string() },
          folder: named_folder(&name, None),
        },
      },
    },
  })
}

/// `MoveFolder` to a folder by id, or to Deleted Items with `to` as None.
pub fn move_request(folder_id: &str, to: Option<&str>) -> EwsResult<String> {
  check_id(folder_id, "folder")?;
  let to_folder_id = match to {
    Some(id) => {
      check_id(id, "folder to move to")?;
      folder_ref(id)
    }
    None => distinguished("deleteditems"),
  };
  document(MoveFolder { inner: CopyMoveFolderData { to_folder_id, folder_ids: vec![folder_ref(folder_id)] } })
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/// The new folder. The answer names only its id, so the parent and the
/// name come from the request.
pub fn read_created(xml: &str, parent_id: &str, name: &str) -> EwsResult<FolderInfo> {
  let message = only(read::<CreateFolderResponse>(xml)?)?;
  let folder = message.folders.inner.first().map(folder_info).filter(|f| !f.id.is_empty());
  let mut info = folder.ok_or_else(|| EwsError::Parse("The answer to CreateFolder has no folder in it.".into()))?;
  info.parent_id = Some(parent_id.to_string());
  info.name = name.trim().to_string();
  info.folder_class = Some(MAIL_FOLDER_CLASS.to_string());
  Ok(info)
}

pub fn read_change_key(xml: &str) -> EwsResult<String> {
  let message = only(read::<GetFolderResponse>(xml)?)?;
  let key = message.folders.inner.first().and_then(|folder| match folder {
    Folder::Folder { folder_id, .. }
    | Folder::CalendarFolder { folder_id, .. }
    | Folder::ContactsFolder { folder_id, .. }
    | Folder::SearchFolder { folder_id, .. }
    | Folder::TasksFolder { folder_id, .. } => folder_id.as_ref().and_then(|f| f.change_key.clone()),
  });
  key.ok_or_else(|| EwsError::Parse("The answer to GetFolder has no ChangeKey in it.".into()))
}

pub fn read_renamed(xml: &str) -> EwsResult<()> {
  only(read::<UpdateFolderResponse>(xml)?).map(|_| ())
}

pub fn read_moved(xml: &str) -> EwsResult<()> {
  only(read::<MoveFolderResponse>(xml)?).map(|_| ())
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

pub async fn create_folder(client: &EwsClient, parent_id: &str, name: &str) -> EwsResult<FolderInfo> {
  let xml = client.call(&create_request(parent_id, name)?).await?;
  read_created(&xml, parent_id, name)
}

pub async fn rename_folder(client: &EwsClient, folder_id: &str, name: &str) -> EwsResult<()> {
  let key = read_change_key(&client.call(&change_key_request(folder_id)?).await?)?;
  read_renamed(&client.call(&rename_request(folder_id, &key, name)?).await?)
}

pub async fn move_folder(client: &EwsClient, folder_id: &str, to: Option<&str>) -> EwsResult<()> {
  read_moved(&client.call(&move_request(folder_id, to)?).await?)
}

/// The commands. Registered with the `exchange` feature.
pub mod commands {
  use super::*;

  /// Make a mail folder under a folder. Answers the new folder.
  #[tauri::command]
  pub async fn mail_ews_create_folder(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    parent_id: String,
    name: String,
  ) -> Result<FolderInfo, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    create_folder(&client, &parent_id, &name).await.map_err(|e| e.to_string())
  }

  /// Give a folder a new name.
  #[tauri::command]
  pub async fn mail_ews_rename_folder(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    folder_id: String,
    name: String,
  ) -> Result<(), String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    rename_folder(&client, &folder_id, &name).await.map_err(|e| e.to_string())
  }

  /// Move a folder under another folder, or to Deleted Items when
  /// `to_folder_id` is null. Never deletes a folder.
  #[tauri::command]
  pub async fn mail_ews_move_folder(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    folder_id: String,
    to_folder_id: Option<String>,
  ) -> Result<(), String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    move_folder(&client, &folder_id, to_folder_id.as_deref()).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_folder_edits_tests.rs"]
mod tests;
