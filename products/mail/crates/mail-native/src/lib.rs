//! The native side of Digital Habits Mail.
//!
//! Two Tauri apps host the same mail interface: the standalone Mail app
//! (`apps/mail`) and the Planner Mac app (`src-tauri` at the repository root),
//! where mail is one pane of the window. Both need the same Rust: the SQLite
//! store with tokens in the keychain, the OAuth loopback listener, the image
//! scheme, the attachment writer, and printing. This crate is that Rust, once.
//!
//! Each app still owns its own `tauri::Builder`. It calls
//! [`register_commands`]-style pieces from here: `manage` the store and the
//! listener, register the two URI schemes, and list the commands in
//! `generate_handler!`. See `setup` and `commands` below.

pub mod backdrop;
#[cfg(target_os = "macos")]
pub mod clipboard;
#[cfg(target_os = "macos")]
pub mod contacts;
pub mod actions;
pub mod db;
pub mod imap;
pub mod messages;
pub mod mime;
pub mod outbox;
pub mod smtp;
pub mod sync;
pub mod downloads;
#[cfg(target_os = "macos")]
pub mod dragout;
pub mod handover;
pub mod images;
pub mod import;
#[cfg(target_os = "macos")]
pub mod magnify;
pub mod oauth;
pub mod planner;
pub mod popout;
#[cfg(target_os = "macos")]
pub mod printing;
pub mod pending;
pub mod secrets;

/// The commands both apps register. In a module of their own, because a
/// `#[tauri::command]` at a library crate's root exports its macro twice.
pub mod commands {
  use tauri::Manager;

  use crate::{db, oauth};

  /// The one door to the local store. See `db::IMPLEMENTED` for what it answers,
  /// and `MAIL_STORE_OPERATIONS` in the mail package for the full contract.
  // Off the main thread: a store write of two hundred rows, or a body of
  // a few megabytes, holds the store's one lock for a moment, and the
  // interface asking on the main thread froze for exactly that moment.
  #[tauri::command(async)]
  pub fn mail_store_call(
    db: tauri::State<'_, db::MailDb>,
    op: String,
    args: serde_json::Value,
  ) -> Result<serde_json::Value, String> {
    db.call(&op, &args).map_err(|e| e.to_string())
  }

  /// The names and addresses Mail knows, for the planner window's pickers.
  /// Read-only, and nothing else of the mailbox. See `MailDb::planner_contacts`.
  #[tauri::command(async)]
  pub fn mail_contacts_for_planner(
    db: tauri::State<'_, db::MailDb>,
  ) -> Result<serde_json::Value, String> {
    db.planner_contacts().map_err(|e| e.to_string())
  }

  /// Take a loopback port for the redirect, and answer which one.
  #[tauri::command]
  pub fn oauth_bind(listener: tauri::State<'_, oauth::OauthListener>) -> Result<u16, String> {
    listener.bind()
  }

  /// Write a mail state snapshot from the planner into the store. One time,
  /// on the first launch with a local store. See import.rs.
  #[tauri::command]
  pub fn mail_import_snapshot(
    db: tauri::State<'_, db::MailDb>,
    snapshot: crate::import::Snapshot,
  ) -> Result<crate::import::ImportReport, String> {
    db.import_snapshot("local", &snapshot).map_err(|e| e.to_string())
  }

  /// Give up on a sign-in the browser is not going to answer, so the wait
  /// below comes back and the reader may try again.
  #[tauri::command]
  pub fn oauth_cancel(listener: tauri::State<'_, oauth::OauthListener>) {
    listener.cancel();
  }

  /// Wait for the browser to come back. Blocking, so it runs off the main thread.
  #[tauri::command]
  pub async fn oauth_await_redirect(
    app: tauri::AppHandle,
    expected_state: String,
  ) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
      let listener = app.state::<oauth::OauthListener>();
      listener.await_redirect(&expected_state)
    })
    .await
    .map_err(|e| e.to_string())?
  }
}

use tauri::Manager;

/// The keychain service name. Changing it orphans every stored token, so it
/// is written out here rather than taken from a bundle identifier. Both apps
/// use the same name on purpose: a mailbox connected in one is connected in
/// the other, on the same Mac.
pub const KEYCHAIN_SERVICE: &str = "org.digitalhabits.mail";

/// The keychain access group both apps carry in their entitlements, so the
/// data-protection keychain lets each read what the other stored. The prefix
/// is the team identifier. See secrets.rs.
pub const KEYCHAIN_ACCESS_GROUP: &str = "JD647S9RT6.org.digitalhabits.mail";

/// Open the store in the app's data directory and put it, and the OAuth
/// listener, in Tauri state. Call from `setup`. A failure here leaves the app
/// unable to remember anything, so the caller stops rather than run with no
/// store at all.
///
/// `data_dir` is the host app's data directory. The two apps have different
/// bundle identifiers and so different directories; a mailbox connected in
/// one is not automatically listed in the other. Pass a shared directory to
/// change that.
pub fn setup_store(app: &tauri::AppHandle, data_dir: std::path::PathBuf) -> Result<(), String> {
  // The directory only matters where the OS has no keychain to reach —
  // Android — and the secrets go to a file there. See secrets.rs.
  let secrets = secrets::Secrets::open_in(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_GROUP, &data_dir);
  let store = db::MailDb::open(&db::database_path(data_dir), secrets.clone())
    .map_err(|e| e.to_string())?;
  app.manage(secrets);
  app.manage(store);
  app.manage(oauth::OauthListener::default());
  app.manage(planner::PlannerSession::default());
  planner::restore(app);
  sync::setup(app);
  Ok(())
}

/// Register the two URI schemes on a builder: remote images (`images.rs`) and
/// the print document (`printing.rs`). Call before `.build()`.
pub fn register_schemes<R: tauri::Runtime>(
  builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
  let builder = builder.register_asynchronous_uri_scheme_protocol(
    images::SCHEME,
    |_ctx, request, responder| {
      let path = request.uri().path().to_string();
      tauri::async_runtime::spawn(async move {
        let answer = match images::address_from_path(&path) {
          Ok(url) => images::fetch(&url).await,
          Err(err) => Err(err),
        };
        match answer {
          // The scheme is its own origin, and the page is another — the
          // dev server's in development, `tauri://localhost` in a build —
          // so the web view runs a cross-origin check on every picture
          // and, with no answer to it, drew a broken frame in place of
          // each: "Cannot load image … due to access control checks".
          // The picture is public anyway (it was fetched with no cookie),
          // so any origin may have it.
          Ok((bytes, content_type)) => responder.respond(
            tauri::http::Response::builder()
              .status(200)
              .header("Content-Type", content_type)
              .header("Cache-Control", "private, max-age=3600")
              .header("Access-Control-Allow-Origin", "*")
              .body(bytes)
              .unwrap(),
          ),
          Err(err) => {
            log::warn!("image fetch failed: {err}");
            responder.respond(
              tauri::http::Response::builder()
                .status(502)
                .header("Content-Type", "text/plain")
                .header("Access-Control-Allow-Origin", "*")
                .body(err.into_bytes())
                .unwrap(),
            )
          }
        }
      });
    },
  );
  #[cfg(target_os = "macos")]
  let builder = builder.register_uri_scheme_protocol(printing::SCHEME, |_ctx, request| {
    match printing::document_for_path(request.uri().path()) {
      Some(html) => tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(html.into_bytes())
        .unwrap(),
      None => tauri::http::Response::builder()
        .status(404)
        .header("Content-Type", "text/plain")
        .body(b"no document".to_vec())
        .unwrap(),
    }
  });
  builder
}
