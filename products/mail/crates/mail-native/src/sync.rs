//! The sync worker: one thread per Gmail mailbox, filling the local copy
//! over IMAP and keeping it current.
//!
//! Four phases, per docs/mail-local-store.md. `full` reads every message's
//! headers from All Mail once, newest first, in batches, and records how
//! far it got so a restart continues. `live` waits in IDLE for the server
//! to speak, then reads what is new above the highest UID and what changed
//! since the highest modseq. `expired` is a changed UIDVALIDITY: the rows go,
//! the bodies stay, and `full` runs again. `paused` is a refusal the worker
//! cannot fix — a token that needs the reader — and a back-off before the
//! next try.
//!
//! The worker holds the app handle and reads the store and the OAuth config
//! from Tauri state, the way the pane watchdog does. Rust refreshes the
//! access token itself, with the client id the interface hands over once at
//! start, so the copy stays current with the pane closed.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::actions::{flush_actions, Folders};
use crate::smtp::{Smtp, SmtpError, SMTP_HOST, SMTP_PORT};
use crate::db::MailDb;
use crate::imap::{self, Client, Fetched, Item};
use crate::messages::{Address, MessageRow, SyncState, DRAFT, IMPORTANT, INBOX, SENT, SPAM, STARRED, TRASH};

/// Emitted with the sync state as JSON whenever it changes.
pub const STATE_EVENT: &str = "mail-sync-state";
/// Emitted with `{ account }` when rows changed and the list should look again.
pub const CHANGED_EVENT: &str = "mail-sync-changed";
/// Emitted with `{ account, threadId, kind, error }` when the server refused
/// an action for good.
pub const ACTION_FAILED_EVENT: &str = "mail-sync-action-failed";
/// Emitted with `{ account, id, subject, error }` when a message in the
/// outbox was refused for good and given back.
pub const SEND_FAILED_EVENT: &str = "mail-sync-send-failed";
/// Emitted with `{ account, id, threadId }` when a message left the outbox.
pub const SENT_EVENT: &str = "mail-sync-sent";

const IMAP_HOST: &str = "imap.gmail.com";
const IMAP_PORT: u16 = 993;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Messages per UID FETCH during the full sync.
const FETCH_BATCH: usize = 200;
/// How long one IDLE waits before the worker looks around anyway. Short,
/// so a stop or a wake is felt within the minute.
const IDLE_WAIT: Duration = Duration::from_secs(60);
/// How often the worker asks for every UID to find deletions.
const DELETION_SWEEP: Duration = Duration::from_secs(3600);
/// How far back the worker fetches bodies on its own: the retention
/// window in docs/mail-local-store.md. Older mail is read on open.
const BODY_WINDOW_MS: i64 = 365 * 24 * 3600 * 1000;
/// Bodies per pass. Small, so a wake or a stop is felt between batches.
const BODY_BATCH: usize = 20;
/// Seconds before the next try after a session fails, by failure count.
const BACKOFF_SECS: [u64; 4] = [10, 30, 60, 300];
const HEADER_FIELDS: &str =
  "From To Cc Bcc Subject Date Message-ID In-Reply-To References Content-Type Content-Transfer-Encoding";
const SNIPPET_BYTES: usize = 2048;
const SNIPPET_CHARS: usize = 200;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOauth {
  pub client_id: String,
  pub client_secret: String,
  pub token_endpoint: String,
}

/// What the worker needs from the interface: the OAuth client, handed over once.
#[derive(Default)]
pub struct SyncConfig {
  google: Mutex<Option<GoogleOauth>>,
  /// Access tokens by mailbox, with when they stop being good. A token
  /// lasts an hour; every on-demand fetch would otherwise buy a new one.
  tokens: Mutex<HashMap<String, (String, Instant)>>,
}

const TOKEN_KEEP: Duration = Duration::from_secs(50 * 60);

/// How long an on-demand connection is kept for the next request.
///
/// Opening one costs a TLS handshake, a sign-in, and a LIST: a few seconds
/// the reader felt on every file and every "show original". Kept idle a
/// while and used again; dropped once it has sat longer than this.
const ON_DEMAND_KEEP: Duration = Duration::from_secs(4 * 60);
/// How long an on-demand request waits for an answer. The worker's own
/// connection waits five minutes, which is right for IDLE; a reader
/// waiting for a file is not, and a kept connection that died quietly
/// while the machine slept should be found out in seconds.
const ON_DEMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Signed-in connections for on-demand fetches, one per mailbox, waiting
/// for the next request. Taken out while in use, so two requests at once
/// each get their own.
#[derive(Default)]
pub struct OnDemandPool {
  idle: Mutex<HashMap<String, (Client, Vec<imap::MailboxName>, Instant)>>,
}

struct WorkerFlags {
  stop: Arc<AtomicBool>,
  wake: Arc<AtomicBool>,
}

/// The running workers, by mailbox.
#[derive(Default)]
pub struct SyncSupervisor {
  workers: Mutex<HashMap<String, WorkerFlags>>,
}

/// Put the config and the supervisor in state. Call from `setup_store`.
pub fn setup(app: &AppHandle) {
  app.manage(SyncConfig::default());
  app.manage(SyncSupervisor::default());
  app.manage(OnDemandPool::default());
}

/// Hand the worker the OAuth client it refreshes tokens with.
#[tauri::command]
pub fn mail_sync_configure(app: AppHandle, google: GoogleOauth) -> Result<(), String> {
  let config = app.state::<SyncConfig>();
  *config.google.lock().unwrap() = Some(google);
  Ok(())
}

/// Start a worker for each mailbox that has none. Idempotent.
#[tauri::command]
pub fn mail_sync_start(app: AppHandle, accounts: Vec<String>) -> Result<Vec<String>, String> {
  {
    let config = app.state::<SyncConfig>();
    if config.google.lock().unwrap().is_none() {
      return Err("the sync worker has no OAuth client yet; configure it first".into());
    }
  }
  let mut started = Vec::new();
  for account in accounts {
    let email = account.trim().to_lowercase();
    if email.is_empty() {
      continue;
    }
    if start_account(&app, email.clone()) {
      started.push(email);
    }
  }
  Ok(started)
}

/// Ask a worker to stop after its current step. The list hears at once
/// that the mailbox is no longer being read; the thread ends when it next
/// looks at the flag, within a batch or an IDLE.
#[tauri::command(async)]
pub fn mail_sync_stop(app: AppHandle, account: String) -> Result<(), String> {
  // A kept on-demand connection goes with the worker: a disconnected
  // mailbox must not stay signed in from the last file it served.
  {
    let pool = app.state::<OnDemandPool>();
    pool.idle.lock().unwrap().remove(&account.trim().to_lowercase());
  }
  let email = account.to_lowercase();
  let supervisor = app.state::<SyncSupervisor>();
  if let Some(flags) = supervisor.workers.lock().unwrap().get(&email) {
    flags.stop.store(true, Ordering::SeqCst);
  }
  set_phase(&app, &email, "none");
  Ok(())
}

/// Ask a worker to look at the server now rather than at the end of its IDLE.
#[tauri::command]
pub fn mail_sync_wake(app: AppHandle, account: String) -> Result<(), String> {
  let supervisor = app.state::<SyncSupervisor>();
  if let Some(flags) = supervisor.workers.lock().unwrap().get(&account.to_lowercase()) {
    flags.wake.store(true, Ordering::SeqCst);
  }
  Ok(())
}

// ---------------------------------------------------------------------------
// On demand: bodies, files, and the source, fetched when the reader asks
// ---------------------------------------------------------------------------

/// A signed-in connection for one request, and the folder names to select.
fn on_demand_session(app: &AppHandle, email: &str) -> Result<(Client, Vec<imap::MailboxName>), String> {
  let token = access_token(app, email).map_err(|e| match e {
    SyncError::Failed(s) | SyncError::Transient(s) => s,
    SyncError::Stopped => "stopped".into(),
  })?;
  let mut client = Client::connect(IMAP_HOST, IMAP_PORT, CONNECT_TIMEOUT).map_err(|e| e.to_string())?;
  if let Err(e) = client.authenticate_xoauth2(email, &token) {
    forget_token(app, email);
    return Err(auth_refusal_reason(&e).unwrap_or_else(|| e.to_string()));
  }
  client.set_read_timeout(ON_DEMAND_TIMEOUT).map_err(|e| e.to_string())?;
  let boxes = client.list().map_err(|e| e.to_string())?;
  Ok((client, boxes))
}

/// Run one on-demand request on a kept connection, or on a new one.
///
/// A kept connection may have been closed by the server while it sat; a
/// request that fails on it is made once more on a fresh one. The
/// connection goes back to the pool when the request is done.
fn with_on_demand<T>(
  app: &AppHandle,
  email: &str,
  mut request: impl FnMut(&mut Client, &[imap::MailboxName]) -> Result<T, String>,
) -> Result<T, String> {
  let pool = app.state::<OnDemandPool>();
  let kept = pool
    .idle
    .lock()
    .unwrap()
    .remove(email)
    .filter(|(_, _, at)| at.elapsed() < ON_DEMAND_KEEP);
  let keep = |client: Client, boxes: Vec<imap::MailboxName>| {
    // Only for a mailbox that is still connected: a request that was in
    // flight while the mailbox was disconnected must not leave it signed
    // in from the pool.
    let supervisor = app.state::<SyncSupervisor>();
    if supervisor.workers.lock().unwrap().contains_key(email) {
      pool.idle.lock().unwrap().insert(email.to_string(), (client, boxes, Instant::now()));
    }
  };
  if let Some((mut client, boxes, _)) = kept {
    match request(&mut client, &boxes) {
      Ok(value) => {
        keep(client, boxes);
        return Ok(value);
      }
      Err(err) => {
        log::info!("[mail-sync] {email}: the kept connection did not serve ({err}); opening a new one");
      }
    }
  }
  let (mut client, boxes) = on_demand_session(app, email)?;
  let value = request(&mut client, &boxes)?;
  keep(client, boxes);
  Ok(value)
}

/// Keep the bodies of these messages, in the folder now selected.
///
/// By the message's structure, not the whole message: the server is
/// asked what the parts are, the text and the small inline pictures are
/// fetched, and every file is only listed by name, type, size, and
/// section — fetched when the reader asks for it. Reading whole
/// messages meant downloading every attachment to keep a paragraph, and
/// skipping any message over five megabytes, text and all.
///
/// Returns how many bodies were kept. A message whose structure the
/// server will not give is marked skipped.
fn keep_bodies(
  db: &MailDb,
  client: &mut Client,
  email: &str,
  wanted: &[(String, i64)],
) -> Result<usize, imap::ImapError> {
  let mut kept = 0;
  for chunk in wanted.chunks(10) {
    let set = chunk.iter().map(|(_, uid)| uid.to_string()).collect::<Vec<_>>().join(",");
    let structures = client.uid_fetch(&set, "UID BODYSTRUCTURE", None)?;
    for (message_id, uid) in chunk {
      let structure = structures
        .iter()
        .find(|f| f.uid().map(|u| u as i64 == *uid).unwrap_or(false))
        .and_then(|f| f.get("BODYSTRUCTURE"));
      let Some(structure) = structure else {
        let _ = db.messages_body_skipped(email, message_id);
        continue;
      };
      let plan = crate::mime::plan_parts(&crate::mime::structure_parts(structure));
      let sections: Vec<String> = plan
        .text
        .iter()
        .chain(plan.html.iter())
        .chain(plan.inline.iter())
        .map(|p| p.section.clone())
        .collect();
      let mut fetched: HashMap<String, Vec<u8>> = HashMap::new();
      if !sections.is_empty() {
        let items = sections.iter().map(|s| format!("BODY.PEEK[{s}]")).collect::<Vec<_>>().join(" ");
        let parts = client.uid_fetch(&uid.to_string(), &format!("UID {items}"), None)?;
        if let Some(f) = parts.first() {
          for section in &sections {
            // By exact name: "BODY[1.1]" is a prefix of "BODY[1.12]".
            let name = format!("BODY[{section}]");
            if let Some(bytes) = f.get(&name).and_then(Item::as_bytes) {
              fetched.insert(section.clone(), bytes);
            }
          }
        }
      }
      let parsed = crate::mime::assemble(&plan, &fetched);
      let body = crate::messages::BodyRow {
        text: parsed.text,
        html: parsed.html,
        inline_images: serde_json::to_value(&parsed.inline_images).unwrap_or(json!({})),
        attachments: serde_json::to_value(&parsed.attachments).unwrap_or(json!([])),
      };
      if let Err(e) = db.bodies_put(email, message_id, &body) {
        log::warn!("[mail-sync] {email}: could not keep a body: {e}");
        continue;
      }
      kept += 1;
    }
  }
  Ok(kept)
}

/// Select the folder a row's UID belongs to: All Mail, Trash, or Junk.
fn select_logical(client: &mut Client, boxes: &[imap::MailboxName], logical: &str) -> Result<(), String> {
  let attr = match logical {
    "trash" => "\\Trash",
    "spam" => "\\Junk",
    _ => "\\All",
  };
  let raw = boxes
    .iter()
    .find(|b| b.attributes.iter().any(|a| a.eq_ignore_ascii_case(attr)))
    .map(|b| b.raw.clone())
    .unwrap_or_else(|| "[Gmail]/All Mail".to_string());
  client.select(&raw).map_err(|e| e.to_string())?;
  Ok(())
}

/// Read these messages in full, parse them, and keep their bodies. Returns
/// how many were kept. Messages the copy does not know are skipped.
#[tauri::command]
pub async fn mail_sync_fetch_bodies(
  app: AppHandle,
  account: String,
  message_ids: Vec<String>,
) -> Result<usize, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let email = account.trim().to_lowercase();
    let db = app.state::<MailDb>();
    let uids = db.messages_uids_for(&email, &message_ids).map_err(|e| e.to_string())?;
    if uids.is_empty() {
      return Ok(0);
    }
    // By folder, since a UID means nothing outside its own.
    let mut by_folder: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (id, uid, folder) in uids {
      by_folder.entry(folder).or_default().push((id, uid));
    }
    let kept = with_on_demand(&app, &email, |client, boxes| {
      let mut kept = 0;
      for (folder, uids) in &by_folder {
        select_logical(client, boxes, folder)?;
        kept += keep_bodies(&db, client, &email, uids).map_err(|e| e.to_string())?;
      }
      Ok(kept)
    })?;
    log::info!("[mail-sync] {email}: kept {kept} bodies on demand");
    Ok(kept)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// One file of a message, by its IMAP section: the bytes, base64, with the
/// type and name the part's own headers give.
#[tauri::command]
pub async fn mail_sync_fetch_part(
  app: AppHandle,
  account: String,
  message_id: String,
  section: String,
) -> Result<serde_json::Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let email = account.trim().to_lowercase();
    if section.is_empty() || !section.chars().all(|c| c.is_ascii_digit() || c == '.') {
      return Err("bad section".into());
    }
    let db = app.state::<MailDb>();
    let uids = db.messages_uids_for(&email, std::slice::from_ref(&message_id)).map_err(|e| e.to_string())?;
    let Some((_, uid, folder)) = uids.first() else {
      return Err("the message is not in the local copy".into());
    };
    let items = format!("UID BODY.PEEK[{section}.MIME] BODY.PEEK[{section}]");
    let fetched = with_on_demand(&app, &email, |client, boxes| {
      select_logical(client, boxes, folder)?;
      client.uid_fetch(&uid.to_string(), &items, None).map_err(|e| e.to_string())
    })?;
    let Some(f) = fetched.first() else {
      return Err("the server had no such part".into());
    };
    let mime_head = f
      .body_section(&format!("BODY[{section}.MIME]"))
      .and_then(Item::as_bytes)
      .unwrap_or_default();
    let body = f
      .body_section(&format!("BODY[{section}]"))
      .and_then(Item::as_bytes)
      .unwrap_or_default();
    let (bytes, mime_type, filename) = crate::mime::decode_fetched_part(&mime_head, &body);
    Ok(json!({
      "bytesBase64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes),
      "mimeType": mime_type,
      "filename": filename,
    }))
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The message as it arrived, headers and all, base64.
#[tauri::command]
pub async fn mail_sync_fetch_source(
  app: AppHandle,
  account: String,
  message_id: String,
) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let email = account.trim().to_lowercase();
    let db = app.state::<MailDb>();
    let uids = db.messages_uids_for(&email, std::slice::from_ref(&message_id)).map_err(|e| e.to_string())?;
    let Some((_, uid, folder)) = uids.first() else {
      return Err("the message is not in the local copy".into());
    };
    let fetched = with_on_demand(&app, &email, |client, boxes| {
      select_logical(client, boxes, folder)?;
      client.uid_fetch(&uid.to_string(), "UID BODY.PEEK[]", None).map_err(|e| e.to_string())
    })?;
    let raw = fetched
      .first()
      .and_then(|f| f.body_section("BODY[]"))
      .and_then(Item::as_bytes)
      .ok_or_else(|| "the server sent no message".to_string())?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &raw))
  })
  .await
  .map_err(|e| e.to_string())?
}

/// An action on a thread: applied to the copy now, carried to the server
/// by the worker on its next pass, which this wakes.
#[tauri::command(async)]
pub fn mail_sync_action(
  app: AppHandle,
  account: String,
  thread_id: String,
  kind: String,
  payload: Option<serde_json::Value>,
) -> Result<i64, String> {
  let email = account.trim().to_lowercase();
  let db = app.state::<MailDb>();
  let id = db
    .actions_apply_and_enqueue(&email, &thread_id, &kind, &payload.unwrap_or(json!({})))
    .map_err(|e| e.to_string())?;
  let _ = app.emit(CHANGED_EVENT, json!({ "account": email }));
  let supervisor = app.state::<SyncSupervisor>();
  if let Some(flags) = supervisor.workers.lock().unwrap().get(&email) {
    flags.wake.store(true, Ordering::SeqCst);
  }
  Ok(id)
}

/// A message to send: into the outbox now, out over SMTP as soon as the
/// worker is woken — between two batches of a first sync if that is where
/// it is — or at `send_at` when one is given.
#[tauri::command(async)]
pub fn mail_sync_send(
  app: AppHandle,
  account: String,
  thread_id: Option<String>,
  recipients: Vec<String>,
  raw: String,
  subject: Option<String>,
  to: Option<Vec<String>>,
  send_at: Option<i64>,
  draft_message_id: Option<String>,
) -> Result<i64, String> {
  let email = account.trim().to_lowercase();
  if recipients.is_empty() {
    return Err("a message needs a recipient".into());
  }
  // An address goes on the wire inside RCPT TO:<…>; one carrying a line
  // break or an angle bracket would end that command and start another.
  if let Some(bad) = recipients.iter().find(|r| {
    r.chars().any(|c| c.is_whitespace() || c.is_control() || c == '<' || c == '>')
  }) {
    return Err(format!("\"{bad}\" is not an address"));
  }
  let db = app.state::<MailDb>();
  let id = db
    .outbox_enqueue(
      &email,
      thread_id.as_deref(),
      &recipients,
      &raw,
      subject.as_deref().unwrap_or(""),
      to.as_deref().unwrap_or(&[]),
      send_at,
      draft_message_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
  wake(&app, &email);
  Ok(id)
}

/// What the outbox holds for a mailbox, without the messages' source.
#[tauri::command(async)]
pub fn mail_sync_outbox(app: AppHandle, account: String) -> Result<Vec<serde_json::Value>, String> {
  let db = app.state::<MailDb>();
  let rows = db.outbox_list(&account.trim().to_lowercase()).map_err(|e| e.to_string())?;
  Ok(rows.iter().map(crate::outbox::row_json).collect())
}

#[tauri::command(async)]
pub fn mail_sync_outbox_cancel(app: AppHandle, account: String, id: i64) -> Result<bool, String> {
  let db = app.state::<MailDb>();
  db.outbox_cancel(&account.trim().to_lowercase(), id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn mail_sync_outbox_send_now(app: AppHandle, account: String, id: i64) -> Result<bool, String> {
  let email = account.trim().to_lowercase();
  let db = app.state::<MailDb>();
  let found = db.outbox_send_now(&email, id).map_err(|e| e.to_string())?;
  wake(&app, &email);
  Ok(found)
}

fn wake(app: &AppHandle, email: &str) {
  let supervisor = app.state::<SyncSupervisor>();
  let workers = supervisor.workers.lock().unwrap();
  if let Some(flags) = workers.get(email) {
    flags.wake.store(true, Ordering::SeqCst);
  }
}

/// The mailboxes with a worker running.
#[tauri::command]
pub fn mail_sync_running(app: AppHandle) -> Result<Vec<String>, String> {
  let supervisor = app.state::<SyncSupervisor>();
  let mut names: Vec<String> = supervisor.workers.lock().unwrap().keys().cloned().collect();
  names.sort();
  Ok(names)
}

fn start_account(app: &AppHandle, email: String) -> bool {
  let supervisor = app.state::<SyncSupervisor>();
  let mut workers = supervisor.workers.lock().unwrap();
  if workers.contains_key(&email) {
    return false;
  }
  let stop = Arc::new(AtomicBool::new(false));
  let wake = Arc::new(AtomicBool::new(false));
  workers.insert(email.clone(), WorkerFlags { stop: stop.clone(), wake: wake.clone() });
  let handle = app.clone();
  thread::Builder::new()
    .name(format!("mail-sync {email}"))
    .spawn(move || run_worker(handle, email, stop, wake))
    .expect("spawn sync worker");
  true
}

fn run_worker(app: AppHandle, email: String, stop: Arc<AtomicBool>, wake: Arc<AtomicBool>) {
  let mut failures: usize = 0;
  let mut transient: usize = 0;
  while !stop.load(Ordering::SeqCst) {
    match session(&app, &email, &stop, &wake) {
      Ok(()) => {
        failures = 0;
        transient = 0;
      }
      Err(SyncError::Stopped) => break,
      Err(SyncError::Transient(reason)) => {
        // The connection went quiet or away. The next session picks up
        // where this one stopped, so the reader is told only when it
        // keeps happening.
        transient += 1;
        log::info!("[mail-sync] {email}: {reason}; reconnecting ({transient})");
        if transient >= 3 {
          set_paused(&app, &email, &format!("{reason} — reconnecting"));
        }
        let wait = if transient >= 3 { 30 } else { 2 };
        for _ in 0..wait {
          if stop.load(Ordering::SeqCst) {
            break;
          }
          thread::sleep(Duration::from_secs(1));
        }
      }
      Err(SyncError::Failed(reason)) => {
        log::warn!("[mail-sync] {email}: {reason}");
        set_paused(&app, &email, &reason);
        let wait = BACKOFF_SECS[failures.min(BACKOFF_SECS.len() - 1)];
        failures += 1;
        for _ in 0..wait {
          if stop.load(Ordering::SeqCst) {
            break;
          }
          thread::sleep(Duration::from_secs(1));
        }
      }
    }
  }
  let supervisor = app.state::<SyncSupervisor>();
  supervisor.workers.lock().unwrap().remove(&email);
  set_phase(&app, &email, "none");
  log::info!("[mail-sync] {email}: worker stopped");
}

/// Record and announce a phase with nothing else changed. "none" is the
/// worker not running; the next start reads what is missing and goes live.
fn set_phase(app: &AppHandle, email: &str, phase: &str) {
  let db = app.state::<MailDb>();
  let mut state = db.sync_state_get(email, "").ok().flatten().unwrap_or_else(|| SyncState {
    account: email.to_string(),
    ..Default::default()
  });
  state.phase = phase.into();
  let _ = publish(Some(app), &db, &state);
}

#[derive(Debug)]
enum SyncError {
  Stopped,
  Failed(String),
  /// A dropped or silent connection: try again at once, and say nothing
  /// unless it keeps happening.
  Transient(String),
}

impl From<imap::ImapError> for SyncError {
  fn from(e: imap::ImapError) -> Self {
    if let Some(reason) = auth_refusal_reason(&e) {
      return SyncError::Failed(reason);
    }
    match e {
      imap::ImapError::Io(_) | imap::ImapError::Closed => SyncError::Transient(e.to_string()),
      other => SyncError::Failed(other.to_string()),
    }
  }
}

/// A refused sign-in, in the reader's terms.
///
/// The server's own line — `[AUTHENTICATIONFAILED] Invalid credentials` and
/// a block of JSON — was what the list showed, and nobody reading it knew
/// that the remedy was Reconnect. The interface looks for the word
/// "reconnect" to offer that button, so every refusal of the grant says it.
/// Gmail names the scope it wanted when the grant is short of it, which is
/// a grant made with the full-mail box unticked on Google's sign-in page:
/// that one says what to tick.
fn auth_refusal_reason(e: &imap::ImapError) -> Option<String> {
  let imap::ImapError::Refused { command, text } = e else {
    return None;
  };
  if !command.eq_ignore_ascii_case("AUTHENTICATE") {
    return None;
  }
  Some(if text.contains("mail.google.com") {
    "needs reconnect: the grant does not allow full access to the mailbox — connect again and tick every permission".to_string()
  } else {
    "needs reconnect: the mail server refused the grant".to_string()
  })
}

impl From<crate::db::DbError> for SyncError {
  fn from(e: crate::db::DbError) -> Self {
    SyncError::Failed(format!("store: {e}"))
  }
}

fn check_stop(stop: &AtomicBool) -> Result<(), SyncError> {
  if stop.load(Ordering::SeqCst) {
    Err(SyncError::Stopped)
  } else {
    Ok(())
  }
}

/// One connection's worth of work: sign in, select All Mail, fill or catch
/// up, then wait and watch until the connection or the worker ends.
/// A folder the worker keeps in the copy.
#[derive(Clone, Debug)]
pub(crate) struct SyncFolder {
  /// "" for All Mail, else "trash" or "spam": the store's key.
  logical: String,
  /// As the server names it, for SELECT.
  raw: String,
  /// The label a row from this folder carries. Gmail's X-GM-LABELS leaves
  /// out the selected folder's own, so the worker adds it.
  inject: Option<&'static str>,
}

/// How often the side folders are looked at between wakes.
const SIDE_EVERY: Duration = Duration::from_secs(300);

fn session(app: &AppHandle, email: &str, stop: &AtomicBool, wake: &AtomicBool) -> Result<(), SyncError> {
  let db = app.state::<MailDb>();
  let token = access_token(app, email)?;
  let mut client = Client::connect(IMAP_HOST, IMAP_PORT, CONNECT_TIMEOUT)?;
  if let Err(e) = client.authenticate_xoauth2(email, &token) {
    forget_token(app, email);
    return Err(e.into());
  }
  let boxes = client.list()?;
  let named = |attr: &str| {
    boxes
      .iter()
      .find(|b| b.attributes.iter().any(|a| a.eq_ignore_ascii_case(attr)))
      .map(|b| b.raw.clone())
  };
  let all_mail = named("\\All").unwrap_or_else(|| "[Gmail]/All Mail".to_string());
  let folders = Folders {
    all_mail: all_mail.clone(),
    trash: named("\\Trash"),
    junk: named("\\Junk"),
    drafts: named("\\Drafts"),
  };
  let mut targets = vec![SyncFolder { logical: String::new(), raw: all_mail.clone(), inject: None }];
  if let Some(raw) = folders.trash.clone() {
    targets.push(SyncFolder { logical: "trash".into(), raw, inject: Some(TRASH) });
  }
  if let Some(raw) = folders.junk.clone() {
    targets.push(SyncFolder { logical: "spam".into(), raw, inject: Some(SPAM) });
  }

  /*
    What the reader wrote goes out before anything is read.

    The first read of a mailbox takes as long as the mailbox is big — an
    hour is ordinary — and the outbox used to wait for it: a message sent
    in that hour was shown as sent and went nowhere, and nothing said so.
    SMTP needs no IMAP state, so the outbox is emptied here, before the
    catch-up, and again between its batches whenever a send wakes the
    worker. A message that went out mid-sync is then read back from the
    server at once, so it stands at the top of Sent while the rest of the
    mailbox is still coming in.
  */
  flush_outbox(app, &db, email);
  let mut between = || wake.swap(false, Ordering::SeqCst) && flush_outbox(app, &db, email) > 0;

  // Each folder caught up in turn, All Mail first; then All Mail is the
  // one selected, and the one IDLE watches.
  let mut states: Vec<SyncState> = Vec::new();
  for folder in &targets {
    states.push(catch_up(Some(app), &db, &mut client, folder, email, stop, Some(&mut between))?);
  }
  client.select(&all_mail)?;

  let mut last_sweep = Instant::now();
  let mut side_at = Instant::now();
  let mut sweep_now = true;
  let mut look_aside = true;
  loop {
    check_stop(stop)?;
    // What the reader wrote goes out first, then what the reader did, so
    // the pass that follows reads the server as it now is.
    let sent = flush_outbox(app, &db, email);
    let report = flush_actions(&db, &mut client, email, &folders)?;
    let mut reread = false;
    for (action, error) in report.given_up {
      log::warn!("[mail-sync] {email}: gave up on {} for {}: {error}", action.kind, action.thread_id);
      let _ = app.emit(
        ACTION_FAILED_EVENT,
        json!({ "account": email, "threadId": action.thread_id, "kind": action.kind, "error": error }),
      );
      // A refused "delete forever" took rows from the copy that the server
      // still has. The folder is read again, by a session that starts over.
      if let Some(folder) = crate::actions::purged_folder(&action) {
        db.messages_restart_folder(email, folder)?;
        reread = true;
      }
    }
    if reread {
      let _ = app.emit(CHANGED_EVENT, json!({ "account": email }));
      return Ok(());
    }
    let mut changed = live_pass(&db, &mut client, &targets[0], &mut states[0], email, &mut last_sweep, sweep_now)?
      || report.delivered > 0
      || sent > 0;
    sweep_now = false;
    states[0].phase = "live".into();
    states[0].last_ok_at = Some(crate::db::now_ms());
    publish(Some(app), &db, &states[0])?;

    // Trash and Junk: small, and looked at now and then, or when the
    // reader just did something that may have moved mail there.
    if look_aside || side_at.elapsed() >= SIDE_EVERY {
      for i in 1..targets.len() {
        client.select(&targets[i].raw)?;
        let mut sweep = Instant::now() - DELETION_SWEEP; // a side folder always checks deletions
        if live_pass(&db, &mut client, &targets[i], &mut states[i], email, &mut sweep, true)? {
          changed = true;
        }
        states[i].phase = "live".into();
        states[i].last_ok_at = Some(crate::db::now_ms());
        publish(Some(app), &db, &states[i])?;
      }
      client.select(&all_mail)?;
      side_at = Instant::now();
      look_aside = false;
    }

    if changed {
      let _ = app.emit(CHANGED_EVENT, json!({ "account": email }));
    }
    if wake.swap(false, Ordering::SeqCst) {
      look_aside = true;
      continue;
    }
    // Bodies for the last year, a batch at a time while nothing else is
    // asked of the session. While some remain the loop goes straight
    // round, since a live pass is cheap; IDLE waits only once they are
    // all in.
    check_stop(stop)?;
    if prefetch_bodies(&db, &mut client, email)? == BODY_BATCH {
      continue;
    }
    match client.idle(IDLE_WAIT)? {
      imap::IdleEvent::Expunge(_) => {
        sweep_now = true;
        look_aside = true;
      }
      _ => {}
    }
    if client.pending.iter().any(|e| matches!(e, imap::IdleEvent::Expunge(_))) {
      sweep_now = true;
      look_aside = true;
    }
    client.pending.clear();
  }
}

/// One batch of bodies the copy lacks, newest first within the window.
/// All Mail must be selected. Returns how many were asked for; a batch
/// that comes back full means there are more.
fn prefetch_bodies(db: &MailDb, client: &mut Client, email: &str) -> Result<usize, SyncError> {
  let since = crate::db::now_ms() - BODY_WINDOW_MS;
  let wanted = db.messages_bodies_missing(email, since, i64::MAX, BODY_BATCH)?;
  if wanted.is_empty() {
    return Ok(0);
  }
  let asked = wanted.len();
  let kept = keep_bodies(db, client, email, &wanted).map_err(SyncError::from)?;
  if asked < BODY_BATCH {
    log::info!("[mail-sync] {email}: the last year's bodies are in ({kept} of {asked} in the last batch)");
  } else {
    log::debug!("[mail-sync] {email}: kept {kept} of {asked} bodies in the background");
  }
  Ok(asked)
}

/// What the worker does between two batches of a full sync, when it has
/// anything to do: empty the outbox if a send woke it. Answers true when a
/// message went out, so the sync reads the sent copy from the server at
/// once rather than at the end.
type BetweenBatches<'a> = &'a mut dyn FnMut() -> bool;

/// Select the folder, check its identity, and fill it if it is not live.
fn catch_up(
  app: Option<&AppHandle>,
  db: &MailDb,
  client: &mut Client,
  folder: &SyncFolder,
  email: &str,
  stop: &AtomicBool,
  between: Option<BetweenBatches<'_>>,
) -> Result<SyncState, SyncError> {
  let info = client.select(&folder.raw)?;
  let mut state = db.sync_state_get(email, &folder.logical)?.unwrap_or_else(|| SyncState {
    account: email.to_string(),
    folder: folder.logical.clone(),
    phase: "none".into(),
    ..Default::default()
  });
  state.last_error = None;

  // The server rebuilt the folder: every UID is new, and the rows are worthless.
  let validity = info.uid_validity.map(|v| v as i64);
  if state.uid_validity.is_some() && validity.is_some() && state.uid_validity != validity {
    log::info!("[mail-sync] {email}: UIDVALIDITY of {} changed, starting over", folder.raw);
    db.messages_clear_folder(email, &folder.logical)?;
    state.phase = "expired".into();
    state.highest_uid = None;
    state.highest_modseq = None;
    state.full_sync_cursor = None;
    state.full_sync_done = None;
    state.full_sync_total = None;
  }
  state.uid_validity = validity;

  if state.phase != "live" {
    full_sync(app, db, client, folder, &mut state, email, stop, between)?;
    /*
      The baseline for "what changed since" is the folder's modseq as it
      was when it was selected, before any of the fetching. The largest
      modseq among the rows fetched is not safe: a message fetched early
      and changed during the minutes the full sync took carries an old
      modseq in the copy, and a later batch can raise the baseline past
      the change. Reading a few changes twice costs nothing.
    */
    if let Some(at_select) = info.highest_modseq {
      state.highest_modseq = Some(at_select as i64);
    }
  }
  Ok(state)
}

#[allow(clippy::too_many_arguments)]
fn full_sync(
  app: Option<&AppHandle>,
  db: &MailDb,
  client: &mut Client,
  folder: &SyncFolder,
  state: &mut SyncState,
  email: &str,
  stop: &AtomicBool,
  mut between: Option<BetweenBatches<'_>>,
) -> Result<(), SyncError> {
  let mut uids = client.uid_search("ALL")?;
  uids.sort_unstable_by(|a, b| b.cmp(a));
  // Everything the search returned is at or below this. What the worker
  // sends while the batches run is filed by Gmail above it.
  let top_uid = uids.first().map(|u| *u as i64).unwrap_or(0);
  let known: HashSet<i64> = db.messages_known_uids(email, &folder.logical)?.into_iter().collect();
  let todo: Vec<u32> = uids.iter().copied().filter(|u| !known.contains(&(*u as i64))).collect();
  state.phase = "full".into();
  state.full_sync_total = Some(uids.len() as i64);
  state.full_sync_done = Some(known.len() as i64);
  publish(app, db, state)?;
  log::info!("[mail-sync] {email}: full sync of {}, {} of {} to read", folder.raw, todo.len(), uids.len());

  for chunk in todo.chunks(FETCH_BATCH) {
    check_stop(stop)?;
    let set = chunk.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
    let fetched = client.uid_fetch(&set, &fetch_items(), None)?;
    let rows: Vec<MessageRow> = fetched.iter().filter_map(|f| row_from(f, folder)).collect();
    db.messages_upsert(email, &rows)?;
    state.full_sync_done = Some(state.full_sync_done.unwrap_or(0) + chunk.len() as i64);
    state.full_sync_cursor = chunk.last().map(|u| *u as i64);
    publish(app, db, state)?;
    // A send that arrived during the batch goes out now, and its copy
    // comes in now: the reader sees it at the top of Sent, over a list
    // that is still filling.
    if let Some(between) = between.as_mut() {
      if between() {
        fetch_new_above(db, client, folder, email, top_uid)?;
      }
    }
    if let Some(app) = app {
      let _ = app.emit(CHANGED_EVENT, json!({ "account": email }));
    }
  }

  let (high_uid, high_modseq) = db.messages_high_water(email, &folder.logical)?;
  state.highest_uid = high_uid;
  state.highest_modseq = high_modseq;
  state.phase = "live".into();
  state.last_ok_at = Some(crate::db::now_ms());
  publish(app, db, state)?;
  Ok(())
}

/// The messages above a UID, into the copy. True when there were any.
/// `n:*` also returns the last message when nothing is above n, so the
/// UID is checked.
fn fetch_new_above(
  db: &MailDb,
  client: &mut Client,
  folder: &SyncFolder,
  email: &str,
  high_uid: i64,
) -> Result<bool, SyncError> {
  let fetched = client.uid_fetch(&format!("{}:*", high_uid + 1), &fetch_items(), None)?;
  let rows: Vec<MessageRow> = fetched
    .iter()
    .filter(|f| f.uid().map(|u| u as i64 > high_uid).unwrap_or(false))
    .filter_map(|f| row_from(f, folder))
    .collect();
  if rows.is_empty() {
    return Ok(false);
  }
  db.messages_upsert(email, &rows)?;
  Ok(true)
}

/// What is new above the highest UID, what changed since the highest
/// modseq, and now and then what is gone. True when rows changed.
fn live_pass(
  db: &MailDb,
  client: &mut Client,
  folder: &SyncFolder,
  state: &mut SyncState,
  email: &str,
  last_sweep: &mut Instant,
  sweep_now: bool,
) -> Result<bool, SyncError> {
  let high_uid = state.highest_uid.unwrap_or(0);
  let mut changed = fetch_new_above(db, client, folder, email, high_uid)?;

  // Flags and labels that moved.
  if let Some(modseq) = state.highest_modseq {
    let moved = client.uid_fetch("1:*", "UID FLAGS X-GM-LABELS MODSEQ", Some(modseq as u64))?;
    let mut unknown: Vec<u32> = Vec::new();
    for f in &moved {
      let Some(uid) = f.uid() else { continue };
      if uid as i64 > high_uid {
        continue; // already read above
      }
      let flags = f.flags();
      let mut labels = labels_from(f, &flags);
      if let Some(l) = folder.inject {
        if !labels.iter().any(|x| x == l) {
          labels.push(l.into());
        }
      }
      let known = db.messages_set_flags(
        email,
        &folder.logical,
        uid as i64,
        Some(!flags.iter().any(|x| x.eq_ignore_ascii_case("\\Seen"))),
        Some(flags.iter().any(|x| x.eq_ignore_ascii_case("\\Flagged"))),
        Some(&labels),
        f.get("MODSEQ").and_then(Item::as_u64).map(|m| m as i64),
      )?;
      if known {
        changed = true;
      } else {
        unknown.push(uid);
      }
    }
    if !unknown.is_empty() {
      let set = unknown.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
      let fetched = client.uid_fetch(&set, &fetch_items(), None)?;
      let rows: Vec<MessageRow> = fetched.iter().filter_map(|f| row_from(f, folder)).collect();
      if !rows.is_empty() {
        db.messages_upsert(email, &rows)?;
        changed = true;
      }
    }
  }

  // Deletions, by comparing every UID now and then.
  if sweep_now || last_sweep.elapsed() >= DELETION_SWEEP {
    let present: HashSet<i64> = client.uid_search("ALL")?.into_iter().map(|u| u as i64).collect();
    let gone: Vec<i64> = db
      .messages_known_uids(email, &folder.logical)?
      .into_iter()
      .filter(|u| !present.contains(u))
      .collect();
    if !gone.is_empty() {
      db.messages_delete_uids(email, &folder.logical, &gone)?;
      changed = true;
    }
    *last_sweep = Instant::now();
  }

  let (high_uid, high_modseq) = db.messages_high_water(email, &folder.logical)?;
  state.highest_uid = high_uid.or(state.highest_uid);
  state.highest_modseq = match (high_modseq, state.highest_modseq) {
    (Some(a), Some(b)) => Some(a.max(b)),
    (a, b) => a.or(b),
  };
  Ok(changed)
}

/// Every message in the outbox whose time has come, over SMTP. Returns how
/// many went. A connection that fails is tried again next pass; a refusal
/// gives the message back to the reader with the server's words.
fn flush_outbox(app: &AppHandle, db: &MailDb, email: &str) -> usize {
  let now = crate::db::now_ms();
  let due = match db.outbox_due(email, now) {
    Ok(rows) => rows,
    Err(e) => {
      log::warn!("[mail-sync] {email}: could not read the outbox: {e}");
      return 0;
    }
  };
  if due.is_empty() {
    return 0;
  }
  let token = match access_token(app, email) {
    Ok(t) => t,
    Err(_) => return 0,
  };
  let mut smtp = match Smtp::connect(SMTP_HOST, SMTP_PORT, CONNECT_TIMEOUT)
    .and_then(|mut s| s.authenticate_xoauth2(email, &token).map(|_| s))
  {
    Ok(s) => s,
    Err(e) => {
      log::warn!("[mail-sync] {email}: could not reach the mail server to send: {e}");
      if e.is_auth() {
        forget_token(app, email);
        set_paused(app, email, "needs reconnect: the mail server refused the grant");
      }
      return 0;
    }
  };
  let mut sent = 0;
  for (row, raw) in due {
    match smtp.send(email, &row.recipients, raw.as_bytes()) {
      Ok(_) => {
        let _ = db.outbox_done(row.id);
        sent += 1;
        // The draft it was written from goes now, not when the send was
        // queued: a message refused for good used to take its only copy
        // with it.
        if let Some(draft) = &row.draft_message_id {
          let thread = row.thread_id.clone().unwrap_or_default();
          if let Err(e) = db.actions_apply(email, &thread, "discardDraft", &json!({ "messageId": draft }), true) {
            log::warn!("[mail-sync] {email}: could not discard the sent draft: {e}");
          }
        }
        log::info!("[mail-sync] {email}: sent \"{}\" to {}", row.subject, row.recipients.join(", "));
        let _ = app.emit(SENT_EVENT, json!({ "account": email, "id": row.id, "threadId": row.thread_id }));
      }
      Err(e) => {
        let permanent = e.is_permanent();
        log::warn!("[mail-sync] {email}: send of \"{}\" failed: {e}", row.subject);
        match db.outbox_failed(row.id, &e.to_string(), permanent) {
          Ok(true) => {
            let _ = app.emit(
              SEND_FAILED_EVENT,
              json!({ "account": email, "id": row.id, "subject": row.subject, "error": e.to_string() }),
            );
          }
          Ok(false) => {}
          Err(err) => log::warn!("[mail-sync] {email}: could not record a failed send: {err}"),
        }
        if matches!(e, SmtpError::Io(_) | SmtpError::Protocol(_) | SmtpError::Unconfirmed(_)) {
          break; // the connection is gone; the rest wait for the next pass
        }
      }
    }
  }
  smtp.quit();
  sent
}

fn fetch_items() -> String {
  format!(
    "UID FLAGS X-GM-MSGID X-GM-THRID X-GM-LABELS MODSEQ RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})] BODY.PEEK[TEXT]<0.{SNIPPET_BYTES}>"
  )
}

/// A fetched message as a row. None when Gmail's ids are missing, which
/// means the reply was not a message.
pub(crate) fn row_from(f: &Fetched, folder: &SyncFolder) -> Option<MessageRow> {
  let uid = f.uid()?;
  let msgid = f.get("X-GM-MSGID").and_then(Item::as_u64)?;
  let thrid = f.get("X-GM-THRID").and_then(Item::as_u64).unwrap_or(msgid);
  let flags = f.flags();
  let mut labels = labels_from(f, &flags);
  if let Some(l) = folder.inject {
    if !labels.iter().any(|x| x == l) {
      labels.push(l.into());
    }
  }
  let header_block = f.body_section("BODY[HEADER").and_then(Item::as_bytes).unwrap_or_default();
  let headers = imap::parse_headers(&header_block);
  let from = imap::header(&headers, "from").map(imap::parse_address_list).unwrap_or_default();
  let addresses = |name: &str| -> Vec<Address> {
    imap::header(&headers, name)
      .map(imap::parse_address_list)
      .unwrap_or_default()
      .into_iter()
      .map(|m| Address { name: m.name, email: m.email })
      .collect()
  };
  let content_type = imap::header(&headers, "content-type").unwrap_or("text/plain").to_string();
  let cte = imap::header(&headers, "content-transfer-encoding").unwrap_or("7bit").to_string();
  let text = f.body_section("BODY[TEXT]").and_then(Item::as_bytes).unwrap_or_default();
  let snippet = imap::snippet_from_body(&text, &content_type, &cte, SNIPPET_CHARS);
  let sent_at = f
    .get("INTERNALDATE")
    .and_then(Item::as_str)
    .and_then(|s| imap::parse_internal_date(&s))
    .unwrap_or_else(crate::db::now_ms);
  let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
  Some(MessageRow {
    message_id: format!("{msgid:x}"),
    thread_id: format!("{thrid:x}"),
    folder: folder.logical.clone(),
    uid: Some(uid as i64),
    modseq: f.get("MODSEQ").and_then(Item::as_u64).map(|m| m as i64),
    rfc_message_id: imap::header(&headers, "message-id").map(str::to_string),
    in_reply_to: imap::header(&headers, "in-reply-to").map(str::to_string),
    references: imap::header(&headers, "references").map(str::to_string),
    from_name: from.first().map(|m| m.name.clone()).unwrap_or_default(),
    from_email: from.first().map(|m| m.email.clone()).unwrap_or_default(),
    to: addresses("to"),
    cc: addresses("cc"),
    bcc: addresses("bcc"),
    subject: imap::header(&headers, "subject").map(imap::decode_encoded_words).unwrap_or_default(),
    snippet,
    sent_at,
    size_estimate: f.get("RFC822.SIZE").and_then(Item::as_u64).map(|n| n as i64),
    has_attachments: mime == "multipart/mixed",
    unread: !flags.iter().any(|x| x.eq_ignore_ascii_case("\\Seen")),
    starred: flags.iter().any(|x| x.eq_ignore_ascii_case("\\Flagged")),
    is_draft: flags.iter().any(|x| x.eq_ignore_ascii_case("\\Draft")),
    labels,
  })
}

/// Gmail's labels as the store names them. System labels map to the
/// constants; the rest keep their name, decoded from modified UTF-7.
pub fn labels_from(f: &Fetched, flags: &[String]) -> Vec<String> {
  let mut out: Vec<String> = f
    .get("X-GM-LABELS")
    .map(|l| l.as_list().iter().filter_map(Item::as_str).collect::<Vec<_>>())
    .unwrap_or_default()
    .iter()
    .filter_map(|raw| map_label(raw))
    .collect();
  if flags.iter().any(|x| x.eq_ignore_ascii_case("\\Flagged")) && !out.iter().any(|l| l == STARRED) {
    out.push(STARRED.into());
  }
  if flags.iter().any(|x| x.eq_ignore_ascii_case("\\Draft")) && !out.iter().any(|l| l == DRAFT) {
    out.push(DRAFT.into());
  }
  out
}

pub fn map_label(raw: &str) -> Option<String> {
  let lower = raw.to_ascii_lowercase();
  Some(match lower.as_str() {
    "\\inbox" => INBOX.into(),
    "\\sent" => SENT.into(),
    "\\starred" => STARRED.into(),
    "\\important" => IMPORTANT.into(),
    "\\draft" | "\\drafts" => DRAFT.into(),
    "\\trash" => TRASH.into(),
    "\\spam" | "\\junk" => SPAM.into(),
    "\\all" | "\\muted" => return None,
    _ => imap::decode_modified_utf7(raw),
  })
}

/// Write the state and tell the interface. Without an app — the tests
/// drive the worker's steps against a scripted server — only written.
fn publish(app: Option<&AppHandle>, db: &MailDb, state: &SyncState) -> Result<(), SyncError> {
  db.sync_state_set(state)?;
  if let Some(app) = app {
    let _ = app.emit(STATE_EVENT, state);
  }
  Ok(())
}

fn set_paused(app: &AppHandle, email: &str, reason: &str) {
  let db = app.state::<MailDb>();
  let mut state = db.sync_state_get(email, "").ok().flatten().unwrap_or_else(|| SyncState {
    account: email.to_string(),
    ..Default::default()
  });
  state.phase = "paused".into();
  state.last_error = Some(reason.to_string());
  let _ = publish(Some(app), &db, &state);
}

/// An access token for the mailbox: the cached one while it is good,
/// else a fresh one from the stored refresh token.
/// Drop a cached token the server has just refused, so the next try
/// buys a new one instead of presenting the same dead token for the
/// rest of the hour — after the reader has already reconnected.
fn forget_token(app: &AppHandle, email: &str) {
  let config = app.state::<SyncConfig>();
  config.tokens.lock().unwrap().remove(email);
}

fn access_token(app: &AppHandle, email: &str) -> Result<String, SyncError> {
  let config = app.state::<SyncConfig>();
  if let Some((token, until)) = config.tokens.lock().unwrap().get(email) {
    if Instant::now() < *until {
      return Ok(token.clone());
    }
  }
  let token = fresh_access_token(app, email)?;
  config
    .tokens
    .lock()
    .unwrap()
    .insert(email.to_string(), (token.clone(), Instant::now() + TOKEN_KEEP));
  Ok(token)
}

fn fresh_access_token(app: &AppHandle, email: &str) -> Result<String, SyncError> {
  let google = {
    let config = app.state::<SyncConfig>();
    let guard = config.google.lock().unwrap();
    guard.clone().ok_or_else(|| SyncError::Failed("no OAuth client configured".into()))?
  };
  let db = app.state::<MailDb>();
  let refresh = db
    .refresh_token("gmail", email)?
    .ok_or_else(|| SyncError::Failed("needs reconnect: no refresh token stored".into()))?;
  let mut form = HashMap::new();
  form.insert("client_id".to_string(), google.client_id);
  form.insert("client_secret".to_string(), google.client_secret);
  form.insert("refresh_token".to_string(), refresh);
  form.insert("grant_type".to_string(), "refresh_token".to_string());
  let reply = tauri::async_runtime::block_on(crate::oauth::oauth_token_request(google.token_endpoint, form))
    .map_err(SyncError::Failed)?;
  let status = reply.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
  if status != 200 {
    let error = reply
      .pointer("/body/error")
      .and_then(|e| e.as_str())
      .unwrap_or("token refresh failed")
      .to_string();
    let reason = if error == "invalid_grant" {
      "needs reconnect: the grant was revoked or expired".to_string()
    } else {
      format!("token refresh failed ({status}): {error}")
    };
    return Err(SyncError::Failed(reason));
  }
  reply
    .pointer("/body/access_token")
    .and_then(|t| t.as_str())
    .map(str::to_string)
    .ok_or_else(|| SyncError::Failed("token reply had no access token".into()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn system_labels_map_and_user_labels_decode() {
    assert_eq!(map_label("\\Inbox"), Some(INBOX.into()));
    assert_eq!(map_label("\\Sent"), Some(SENT.into()));
    assert_eq!(map_label("\\Important"), Some(IMPORTANT.into()));
    assert_eq!(map_label("\\All"), None);
    assert_eq!(map_label("&AOY-blesag"), Some("æblesag".into()));
    assert_eq!(map_label("Work"), Some("Work".into()));
  }

  #[test]
  fn a_refused_sign_in_says_reconnect() {
    let short = imap::ImapError::Refused {
      command: "AUTHENTICATE".into(),
      text: "[AUTHENTICATIONFAILED] Invalid credentials (Failure) ({\"status\":\"400\",\"schemes\":\"Bearer\",\"scope\":\"https://mail.google.com/\"})".into(),
    };
    let reason = auth_refusal_reason(&short).unwrap();
    assert!(reason.starts_with("needs reconnect:"), "{reason}");
    assert!(reason.contains("tick every permission"), "{reason}");
    let plain = imap::ImapError::Refused { command: "AUTHENTICATE".into(), text: "[AUTHENTICATIONFAILED] no".into() };
    assert_eq!(auth_refusal_reason(&plain).as_deref(), Some("needs reconnect: the mail server refused the grant"));
    let other = imap::ImapError::Refused { command: "SELECT".into(), text: "[NONEXISTENT] gone".into() };
    assert!(auth_refusal_reason(&other).is_none());
    match SyncError::from(short) {
      SyncError::Failed(s) => assert!(s.starts_with("needs reconnect:"), "{s}"),
      other => panic!("{other:?}"),
    }
  }

  #[test]
  fn a_fetched_message_becomes_a_row() {
    let headers = b"From: \"Ann\" <ann@sender.test>\r\nTo: vera@example.com, Bo <bo@x.test>\r\nSubject: =?utf-8?Q?Hej_=C3=B8?=\r\nMessage-ID: <one@sender.test>\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n".to_vec();
    let text = b"--b\r\nContent-Type: text/plain\r\n\r\nFirst words here\r\n--b--".to_vec();
    let f = Fetched {
      seq: 1,
      attributes: vec![
        ("UID".into(), Item::Num(42)),
        ("FLAGS".into(), Item::List(vec![Item::Str("\\Flagged".into())])),
        ("X-GM-MSGID".into(), Item::Num(0x1a2b)),
        ("X-GM-THRID".into(), Item::Num(0x1a20)),
        ("X-GM-LABELS".into(), Item::List(vec![Item::Str("\\Inbox".into()), Item::Str("Work".into())])),
        ("MODSEQ".into(), Item::List(vec![Item::Num(77)])),
        ("RFC822.SIZE".into(), Item::Num(1234)),
        ("INTERNALDATE".into(), Item::Str("03-Sep-2026 14:20:34 +0000".into())),
        ("BODY[HEADER.FIELDS (FROM TO)]".into(), Item::Bytes(headers)),
        ("BODY[TEXT]".into(), Item::Bytes(text)),
      ],
    };
    let folder = SyncFolder { logical: String::new(), raw: "[Gmail]/All Mail".into(), inject: None };
    let row = row_from(&f, &folder).unwrap();
    assert_eq!(row.message_id, "1a2b");
    assert_eq!(row.thread_id, "1a20");
    assert_eq!(row.uid, Some(42));
    assert_eq!(row.modseq, Some(77));
    assert_eq!(row.from_name, "Ann");
    assert_eq!(row.to[1].email, "bo@x.test");
    assert_eq!(row.subject, "Hej ø");
    assert_eq!(row.snippet, "First words here");
    assert!(row.unread, "no \\Seen means unread");
    assert!(row.starred);
    assert!(row.has_attachments);
    assert_eq!(row.labels, vec![INBOX.to_string(), "Work".to_string(), STARRED.to_string()]);
    assert_eq!(row.sent_at, 1_788_445_234_000);
  }

  // -------------------------------------------------------------------------
  // The worker's steps against a scripted server. What the tests above
  // check one function at a time, these check as the worker does it: a
  // full sync, a live pass with a new message, a changed flag and a
  // deletion, a folder rebuilt, bodies fetched by structure, and an
  // action the server refuses for good.
  // -------------------------------------------------------------------------

  use crate::imap::fake_server;
  use std::sync::atomic::AtomicBool;

  const ME: &str = "vera@example.com";

  fn all_mail() -> SyncFolder {
    SyncFolder { logical: String::new(), raw: "[Gmail]/All Mail".into(), inject: None }
  }

  /// One message as the full sync's FETCH returns it, with the header
  /// block and the text as literals.
  fn fetched(seq: u32, uid: u32, msgid: u64, thrid: u64, seen: bool, modseq: u64, subject: &str) -> String {
    let headers = format!(
      "From: Ann <ann@sender.test>\r\nTo: {ME}\r\nSubject: {subject}\r\nMessage-ID: <{uid}@sender.test>\r\n\r\n"
    );
    let text = format!("Words of message {uid}");
    let flags = if seen { "\\Seen" } else { "" };
    format!(
      "* {seq} FETCH (UID {uid} FLAGS ({flags}) X-GM-MSGID {msgid} X-GM-THRID {thrid} X-GM-LABELS (\"\\\\Inbox\") MODSEQ ({modseq}) RFC822.SIZE 100 INTERNALDATE \"03-Sep-2026 14:20:34 +0000\" BODY[HEADER.FIELDS (From To Cc Bcc Subject Date Message-ID In-Reply-To References Content-Type Content-Transfer-Encoding)] {{{}}}\r\n{}BODY[TEXT]<0> {{{}}}\r\n{})\r\n",
      headers.len(),
      headers,
      text.len(),
      text
    )
  }

  fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
  }

  fn select_reply(validity: u32, modseq: u64) -> &'static str {
    leak(format!(
      "* 2 EXISTS\r\n* OK [UIDVALIDITY {validity}] UIDs valid\r\n* OK [HIGHESTMODSEQ {modseq}]\r\n{{tag}} OK [READ-WRITE] selected\r\n"
    ))
  }

  fn uids_of(db: &MailDb) -> Vec<i64> {
    let mut uids = db.messages_known_uids(ME, "").unwrap();
    uids.sort();
    uids
  }

  #[test]
  fn a_full_sync_then_a_live_pass_with_a_new_message_a_read_flag_and_a_deletion() {
    let db = MailDb::open_in_memory().unwrap();
    let folder = all_mail();
    let stop = AtomicBool::new(false);
    let stream = fake_server(vec![
      ("SELECT", select_reply(7, 100)),
      ("UID SEARCH ALL", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      // Newest first.
      ("UID FETCH 2,1", leak(format!("{}{}{{tag}} OK\r\n", fetched(2, 2, 0x22, 0x20, false, 90, "Second"), fetched(1, 1, 0x11, 0x10, false, 80, "First")))),
      // The live pass: one new message above the high-water mark …
      ("UID FETCH 3:*", leak(format!("{}{{tag}} OK\r\n", fetched(3, 3, 0x33, 0x30, false, 120, "Third")))),
      // … the first one read since the baseline …
      ("CHANGEDSINCE", "* 1 FETCH (UID 1 FLAGS (\\Seen) X-GM-LABELS (\"\\\\Inbox\") MODSEQ (150))\r\n{tag} OK\r\n"),
      // … and the sweep finds the second one gone.
      ("UID SEARCH ALL", "* SEARCH 1 3\r\n{tag} OK\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();

    let mut state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
    assert_eq!(state.phase, "live");
    assert_eq!(state.uid_validity, Some(7));
    assert_eq!(state.highest_uid, Some(2));
    // The baseline is the folder's modseq at SELECT, not the rows' largest.
    assert_eq!(state.highest_modseq, Some(100));
    assert_eq!(uids_of(&db), vec![1, 2]);
    assert_eq!(state.full_sync_done, Some(2));

    let mut last_sweep = Instant::now();
    let changed = live_pass(&db, &mut client, &folder, &mut state, ME, &mut last_sweep, true).unwrap();
    assert!(changed);
    assert_eq!(uids_of(&db), vec![1, 3], "the new message is in and the deleted one is gone");
    assert_eq!(state.highest_uid, Some(3));
    assert_eq!(state.highest_modseq, Some(150));
    let listed = db
      .messages_list(&json!({ "accounts": [ME], "view": "all", "limit": 10 }))
      .unwrap();
    let threads = listed["threads"].as_array().unwrap();
    let first = threads.iter().find(|t| t["subject"] == "First").unwrap();
    assert_eq!(first["unread"], false, "the flag change was read");
    assert!(threads.iter().any(|t| t["subject"] == "Third"));
    assert!(!threads.iter().any(|t| t["subject"] == "Second"));
  }

  #[test]
  fn a_rebuilt_folder_is_read_again_from_nothing() {
    let db = MailDb::open_in_memory().unwrap();
    let folder = all_mail();
    let stop = AtomicBool::new(false);
    let first = fake_server(vec![
      ("SELECT", select_reply(7, 100)),
      ("UID SEARCH ALL", "* SEARCH 1\r\n{tag} OK\r\n"),
      ("UID FETCH 1", leak(format!("{}{{tag}} OK\r\n", fetched(1, 1, 0x11, 0x10, false, 80, "Old")))),
    ]);
    let mut client = Client::connect_plain(first).unwrap();
    let state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
    assert_eq!(uids_of(&db), vec![1]);
    db.sync_state_set(&state).unwrap();

    // The same folder with a new UIDVALIDITY: the rows are worthless.
    let second = fake_server(vec![
      ("SELECT", select_reply(8, 5)),
      ("UID SEARCH ALL", "* SEARCH 10\r\n{tag} OK\r\n"),
      ("UID FETCH 10", leak(format!("{}{{tag}} OK\r\n", fetched(1, 10, 0x11, 0x10, false, 3, "Old")))),
    ]);
    let mut client = Client::connect_plain(second).unwrap();
    let state = catch_up(None, &db, &mut client, &folder, ME, &stop, None).unwrap();
    assert_eq!(state.uid_validity, Some(8));
    assert_eq!(uids_of(&db), vec![10]);
    assert_eq!(state.phase, "live");
  }

  #[test]
  fn a_message_sent_during_the_first_sync_is_read_in_before_the_sync_goes_on() {
    let db = MailDb::open_in_memory().unwrap();
    let folder = all_mail();
    let stop = AtomicBool::new(false);
    let stream = fake_server(vec![
      ("SELECT", select_reply(7, 100)),
      ("UID SEARCH ALL", "* SEARCH 1 2\r\n{tag} OK\r\n"),
      ("UID FETCH 2,1", leak(format!("{}{}{{tag}} OK\r\n", fetched(2, 2, 0x22, 0x20, false, 90, "Second"), fetched(1, 1, 0x11, 0x10, false, 80, "First")))),
      // The batch is done, a send went out between batches, and the copy
      // Gmail filed is read from above everything the search returned.
      ("UID FETCH 3:*", leak(format!("{}{{tag}} OK\r\n", fetched(3, 3, 0x33, 0x30, true, 120, "To my parents")))),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();

    let mut sends = 0;
    let mut between = || {
      sends += 1;
      true
    };
    let state = catch_up(None, &db, &mut client, &folder, ME, &stop, Some(&mut between)).unwrap();
    assert_eq!(sends, 1, "asked once, after the one batch");
    assert_eq!(uids_of(&db), vec![1, 2, 3], "the sent copy is in with the rest");
    assert_eq!(state.phase, "live");
    assert_eq!(state.highest_uid, Some(3), "and the high-water mark counts it");
    let listed = db
      .messages_list(&json!({ "accounts": [ME], "view": "all", "limit": 10 }))
      .unwrap();
    assert!(listed["threads"].as_array().unwrap().iter().any(|t| t["subject"] == "To my parents"));
  }

  #[test]
  fn bodies_are_fetched_by_structure_and_only_once() {
    let db = MailDb::open_in_memory().unwrap();
    let now = crate::db::now_ms();
    db.messages_upsert(
      ME,
      &[MessageRow {
        message_id: "aa".into(),
        thread_id: "a0".into(),
        folder: String::new(),
        uid: Some(5),
        from_name: "Ann".into(),
        from_email: "ann@sender.test".into(),
        subject: "Hello".into(),
        sent_at: now,
        labels: vec![INBOX.into()],
        ..Default::default()
      }],
    )
    .unwrap();
    let stream = fake_server(vec![
      (
        "BODYSTRUCTURE",
        "* 1 FETCH (UID 5 BODYSTRUCTURE ((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"UTF-8\") NIL NIL \"7BIT\" 11 1 NIL NIL NIL NIL)(\"APPLICATION\" \"PDF\" (\"NAME\" \"big.pdf\") NIL NIL \"BASE64\" 8000000 NIL (\"ATTACHMENT\" (\"FILENAME\" \"big.pdf\")) NIL NIL) \"MIXED\" (\"BOUNDARY\" \"b\") NIL NIL NIL))\r\n{tag} OK\r\n",
      ),
      // Only the text part is asked for; the eight-megabyte file is not.
      ("BODY.PEEK[1]", "* 1 FETCH (UID 5 BODY[1] {11}\r\nHello there)\r\n{tag} OK\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    assert_eq!(prefetch_bodies(&db, &mut client, ME).unwrap(), 1);
    let hit = db.messages_search(&json!({ "accounts": [ME], "q": "there", "limit": 5 })).unwrap();
    assert_eq!(hit["threads"].as_array().unwrap().len(), 1, "the body is in the index");
    let thread = db.messages_thread(&json!({ "account": ME, "threadId": "a0" })).unwrap();
    let files = thread["messages"][0]["body"]["attachments"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["filename"], "big.pdf");
    assert_eq!(files[0]["section"], "2");
    // Nothing left to fetch: the server is not asked again.
    assert_eq!(prefetch_bodies(&db, &mut client, ME).unwrap(), 0);
  }

  #[test]
  fn an_action_the_server_refuses_for_good_puts_the_rows_back() {
    let db = MailDb::open_in_memory().unwrap();
    db.messages_upsert(
      ME,
      &[MessageRow {
        message_id: "1a2b".into(),
        thread_id: "1a".into(),
        folder: String::new(),
        uid: Some(7),
        from_email: "ann@sender.test".into(),
        subject: "Keep me".into(),
        sent_at: 1_000,
        labels: vec![INBOX.into()],
        ..Default::default()
      }],
    )
    .unwrap();
    db.actions_apply_and_enqueue(ME, "1a", "trash", &json!({})).unwrap();
    let inbox = |db: &MailDb| {
      db.messages_counts(&json!({ "accounts": [ME], "view": "inbox" })).unwrap()["threads"].as_i64().unwrap()
    };
    assert_eq!(inbox(&db), 0, "hidden while the move is on its way");

    let mut script = Vec::new();
    for _ in 0..crate::actions::MAX_ATTEMPTS {
      script.push(("UID SEARCH X-GM-THRID 26", "* SEARCH 7\r\n{tag} OK\r\n"));
      script.push(("UID MOVE 7", "{tag} NO [CANNOT] Not allowed\r\n"));
    }
    let stream = fake_server(script);
    let mut client = Client::connect_plain(stream).unwrap();
    let folders = Folders {
      all_mail: "[Gmail]/All Mail".into(),
      trash: Some("[Gmail]/Bin".into()),
      junk: None,
      drafts: None,
    };
    let mut given_up = 0;
    for _ in 0..crate::actions::MAX_ATTEMPTS {
      let report = flush_actions(&db, &mut client, ME, &folders).unwrap();
      given_up += report.given_up.len();
    }
    assert_eq!(given_up, 1);
    assert!(db.actions_pending(ME).unwrap().is_empty());
    assert_eq!(inbox(&db), 1, "back in the inbox with the labels it had");
  }
}
