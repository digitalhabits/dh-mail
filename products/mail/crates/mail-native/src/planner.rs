//! The mail interface's way to the planner server.
//!
//! The interface runs in a webview with no browser session — the pane in the
//! Planner Mac app, or the standalone Mail app in its internal flavor. A
//! device token stands in for the session: the planner mints one for the
//! signed-in person (`POST /api/agent/device-token`), the token comes here
//! with the site's origin (`planner_session_set`), and from then on the
//! interface calls `planner_fetch`, which makes the request with the token
//! as a bearer key.
//!
//! In the Planner Mac app the signed-in page hands the token over. In the
//! standalone app the interface signs in once through the browser and the
//! loopback listener (see `apps/mail/src/planner-login.ts`), and the token
//! is kept in the keychain so the next launch has it.
//!
//! Only `/api/agent/` paths are proxied. The token acts as the signed-in
//! person on those routes and nowhere else.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::secrets::Secrets;

#[derive(Default)]
pub struct PlannerSession(Mutex<Option<Session>>);

#[derive(Clone, Serialize, Deserialize)]
struct Session {
  origin: String,
  token: String,
}

/// The keychain item that keeps the session across launches.
const KEYCHAIN_ACCOUNT: &str = "planner-session";

/// Bring back the session the keychain holds, if any. Call from setup, after
/// `Secrets` is in state.
pub fn restore(app: &tauri::AppHandle) {
  let Some(secrets) = app.try_state::<Secrets>() else { return };
  let Ok(Some(raw)) = secrets.get(KEYCHAIN_ACCOUNT) else { return };
  if let Ok(session) = serde_json::from_str::<Session>(&raw) {
    if allowed_origin(&session.origin) && !session.token.is_empty() {
      if let Some(state) = app.try_state::<PlannerSession>() {
        *state.0.lock().unwrap() = Some(session);
        log::info!("planner session restored from the keychain");
      }
    }
  }
}

fn allowed_origin(origin: &str) -> bool {
  origin.starts_with("https://plan.digitalhabits.org")
    || origin.starts_with("http://localhost:3470")
    || origin.starts_with("http://127.0.0.1:3470")
}

/// The main window hands over the site's origin and a device token. With
/// `persist`, the keychain keeps it for the next launch — the standalone
/// app wants that; the Planner Mac app gets a fresh one from its page.
#[tauri::command]
pub fn planner_session_set(
  webview: tauri::Webview,
  state: tauri::State<'_, PlannerSession>,
  secrets: tauri::State<'_, Secrets>,
  origin: String,
  token: String,
  persist: Option<bool>,
) -> Result<(), String> {
  // A `Webview`, not a `WebviewWindow`: the Planner Mac app's main window
  // holds two webviews once the pane exists, and is then no WebviewWindow.
  if webview.label() != "main" {
    return Err("Only the main window sets the planner session".into());
  }
  let origin = origin.trim().trim_end_matches('/').to_string();
  if !allowed_origin(&origin) {
    return Err(format!("Not a planner origin: {origin}"));
  }
  if token.trim().is_empty() {
    return Err("Empty token".into());
  }
  let session = Session {
    origin,
    token: token.trim().to_string(),
  };
  if persist.unwrap_or(false) {
    if let Ok(raw) = serde_json::to_string(&session) {
      if let Err(err) = secrets.set(KEYCHAIN_ACCOUNT, &raw) {
        log::warn!("planner session not kept in the keychain: {err}");
      }
    }
  }
  *state.0.lock().map_err(|e| e.to_string())? = Some(session);
  log::info!("planner session set");
  Ok(())
}

/// Forget the session, in memory and in the keychain. Sign-out.
#[tauri::command]
pub fn planner_session_clear(
  webview: tauri::Webview,
  state: tauri::State<'_, PlannerSession>,
  secrets: tauri::State<'_, Secrets>,
) -> Result<(), String> {
  if webview.label() != "main" {
    return Ok(());
  }
  *state.0.lock().map_err(|e| e.to_string())? = None;
  let _ = secrets.delete(KEYCHAIN_ACCOUNT);
  Ok(())
}

/// The origin of the current session, so the interface can name the
/// planner it talks to. None when there is no session.
#[tauri::command]
pub fn planner_session_origin(state: tauri::State<'_, PlannerSession>) -> Option<String> {
  state.0.lock().ok().and_then(|s| s.as_ref().map(|s| s.origin.clone()))
}

/// Is there a session? The pane asks before it offers CRM actions.
#[tauri::command]
pub fn planner_session_ready(state: tauri::State<'_, PlannerSession>) -> bool {
  state.0.lock().map(|s| s.is_some()).unwrap_or(false)
}

#[derive(Serialize)]
pub struct PlannerResponse {
  status: u16,
  content_type: String,
  body: String,
}

#[derive(Deserialize)]
pub struct PlannerRequest {
  path: String,
  #[serde(default = "default_method")]
  method: String,
  #[serde(default)]
  body: Option<String>,
}

fn default_method() -> String {
  "GET".into()
}

/// One request to the planner, as the signed-in person. `path` must start
/// with `/api/agent/`; the body, when given, is JSON text.
#[tauri::command]
pub async fn planner_fetch(
  app: tauri::AppHandle,
  request: PlannerRequest,
) -> Result<PlannerResponse, String> {
  let session = {
    let state = app.state::<PlannerSession>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.clone()
  };
  let Some(session) = session else {
    // No token yet. In the Planner Mac app the page can mint one: say so,
    // the same as after a 401, so the first request after launch is what
    // gets the session going. Nothing listens in the standalone.
    {
      use tauri::Emitter;
      let _ = app.emit_to("main", "dh-planner-session-needed", ());
    }
    return Err("Not signed in to the planner. Open the planner window and sign in.".into());
  };
  if !request.path.starts_with("/api/agent/") || request.path.contains("..") {
    return Err(format!("Path not allowed: {}", request.path));
  }
  let method = match request.method.to_ascii_uppercase().as_str() {
    "GET" => reqwest::Method::GET,
    "POST" => reqwest::Method::POST,
    "DELETE" => reqwest::Method::DELETE,
    other => return Err(format!("Method not allowed: {other}")),
  };
  let url = format!("{}{}", session.origin, request.path);
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(190))
    .build()
    .map_err(|e| e.to_string())?;
  let mut req = client
    .request(method, &url)
    .header("Authorization", format!("Bearer {}", session.token))
    .header("Accept", "application/json");
  if let Some(body) = request.body {
    req = req.header("Content-Type", "application/json").body(body);
  }
  let response = req.send().await.map_err(|e| format!("Planner request failed: {e}"))?;
  let status = response.status().as_u16();
  // The token is not good any more (revoked, expired, minted before the
  // sign-in landed). Tell the page that can mint another; it listens for
  // this in the Planner Mac app. Nothing listens in the standalone, where
  // the reader signs in again from the strip.
  if status == 401 {
    use tauri::Emitter;
    let _ = app.emit_to("main", "dh-planner-session-needed", ());
  }
  let content_type = response
    .headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();
  let body = response.text().await.map_err(|e| e.to_string())?;
  Ok(PlannerResponse {
    status,
    content_type,
    body,
  })
}

/// Show one CRM record in the planner. The standalone app has no planner
/// window, so this opens the record's tab in the browser at the session's
/// origin. (The Planner Mac app registers its own command of this name,
/// which tells its planner page instead.)
#[tauri::command]
pub fn planner_show_record(
  app: tauri::AppHandle,
  state: tauri::State<'_, PlannerSession>,
  source: String,
  record_id: String,
) -> Result<(), String> {
  let origin = state
    .0
    .lock()
    .ok()
    .and_then(|s| s.as_ref().map(|s| s.origin.clone()))
    .ok_or_else(|| "Not signed in to the planner".to_string())?;
  let source: String = source
    .chars()
    .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
    .collect();
  let url = format!(
    "{origin}/{source}?record={}",
    urlencoding::encode(&record_id)
  );
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(url, None::<&str>)
    .map_err(|e| e.to_string())
}
