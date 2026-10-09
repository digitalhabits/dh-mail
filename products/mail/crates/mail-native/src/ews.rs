//! Exchange Web Services: the transport for Exchange Server on-prem.
//!
//! Microsoft Graph serves only mailboxes that Microsoft hosts. A mailbox on
//! an organization's own Exchange server is reachable over EWS, a SOAP
//! service at `https://<server>/EWS/Exchange.asmx`.
//!
//! The interface cannot call EWS itself, for two reasons:
//!
//! - The server sends no CORS headers, so a request from the webview fails.
//! - NTLM signs in a TCP connection, not a single request.
//!
//! So the interface hands a SOAP body to [`commands::mail_ews_call`], and this
//! module sends it and returns the XML answer. The password stays here after
//! [`commands::mail_ews_connect`]. It is kept in the keychain and never goes
//! back to the interface.
//!
//! Sign-in is NTLM first (see `ntlm.rs`), then Basic if the server does not
//! offer NTLM. After one refused password the account stops: a second try
//! with the same password counts as a second failed sign-in, and enough of
//! those lock the account on the server. Only a new connect opens it again.
//!
//! The commands exist only with the `exchange` feature. The standalone app
//! turns it on by default, the public build included (since 2026-09-28):
//! connecting a new account needs an access code (`exchange-access.ts`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::db::MailDb;
use crate::ews_ops::FolderSummary;
use crate::ntlm;
use crate::secrets::Secrets;

/// The EWS schema version in the requests this app writes. Thunderbird
/// sends the same to Exchange 2019. See `ews_ops::VERSION`.
pub const REQUEST_SERVER_VERSION: &str = "Exchange2013_SP1";

/// What one Exchange account needs to sign in.
///
/// All three are in one keychain item. The account row also has the URL and
/// the username (`ews_url`, `ews_username`), for the interface to show. The
/// password is only in the keychain. Not `Debug`: the password must not
/// reach a log.
#[derive(Clone, Serialize, Deserialize)]
pub struct EwsSettings {
  pub url: String,
  pub username: String,
  pub password: String,
}

/// The keychain item for an account. Same form as the token items in
/// `db.rs`: `<provider>:<email>`.
pub fn keychain_account(email: &str) -> String {
  format!("exchange:{}", normalize_email(email))
}

fn normalize_email(email: &str) -> String {
  email.trim().to_lowercase()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EwsError {
  /// The server refused the password. Do not try again with it.
  Refused,
  /// The server offers neither NTLM nor Basic.
  NoScheme(String),
  /// The server is busy. Wait this long before the next call, if it said.
  Busy(Option<u64>),
  /// A SOAP fault, or a response with `ResponseClass="Error"`.
  Fault { code: String, message: String },
  /// Any other HTTP status.
  Http { status: u16, body: String },
  /// No answer: DNS, TCP, TLS, or a timeout.
  Network(String),
  /// No account with this address is connected.
  NoAccount(String),
  /// The input to a command is not usable.
  Invalid(String),
  /// An answer that the `ews` crate could not read.
  Parse(String),
}

impl EwsError {
  /// A stable code at the start of the message, so the interface can act on
  /// the kind of error without reading the words.
  pub fn code(&self) -> &'static str {
    match self {
      EwsError::Refused => "ews:refused",
      EwsError::NoScheme(_) => "ews:no-scheme",
      EwsError::Busy(_) => "ews:busy",
      EwsError::Fault { .. } => "ews:fault",
      EwsError::Http { .. } => "ews:http",
      EwsError::Network(_) => "ews:network",
      EwsError::NoAccount(_) => "ews:no-account",
      EwsError::Invalid(_) => "ews:invalid",
      EwsError::Parse(_) => "ews:parse",
    }
  }
}

impl std::fmt::Display for EwsError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let code = self.code();
    match self {
      EwsError::Refused => write!(
        f,
        "{code}: The server refused the password. Connect the account again with the current password."
      ),
      EwsError::NoScheme(offered) => write!(
        f,
        "{code}: The server offers no sign-in method that this app can use. The server offers: {offered}."
      ),
      EwsError::Busy(Some(ms)) => write!(f, "{code}: The server is busy. Try again after {ms} ms."),
      EwsError::Busy(None) => write!(f, "{code}: The server is busy. Try again later."),
      EwsError::Fault { code: fault, message } => write!(f, "{code}: {fault}: {message}"),
      EwsError::Http { status, body } => {
        let short: String = body.chars().take(300).collect();
        write!(f, "{code}: The server answered HTTP {status}. {short}")
      }
      EwsError::Network(err) => write!(f, "{code}: The server did not answer. {err}"),
      EwsError::NoAccount(email) => {
        write!(f, "{code}: No Exchange account is connected for {email}.")
      }
      EwsError::Invalid(why) => write!(f, "{code}: {why}"),
      EwsError::Parse(why) => write!(f, "{code}: {why}"),
    }
  }
}

impl std::error::Error for EwsError {}

pub type EwsResult<T> = Result<T, EwsError>;

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scheme {
  Ntlm,
  Basic,
}

/// One account's connection to its server.
///
/// Calls go one at a time, and the HTTP client keeps one idle connection.
/// The NTLM challenge and the answer must go over the same TCP connection,
/// and with one call at a time the pool has only that one to give.
pub struct EwsClient {
  settings: EwsSettings,
  http: reqwest::Client,
  /// The scheme that worked. Unknown until the first call.
  scheme: Mutex<Option<Scheme>>,
  /// Held for the whole of a call.
  turn: tauri::async_runtime::Mutex<()>,
  /// Set after a refused password. No call goes out after that.
  refused: AtomicBool,
}

impl EwsClient {
  pub fn new(settings: EwsSettings) -> EwsResult<EwsClient> {
    EwsClient::with_timeout(settings, Duration::from_secs(120))
  }

  /// A client whose each HTTP request ends after `timeout`. Autodiscover
  /// (`ews_autodiscover.rs`) gives each try a short one.
  pub fn with_timeout(settings: EwsSettings, timeout: Duration) -> EwsResult<EwsClient> {
    // The tests below run a plain HTTP server on the loopback.
    check_url(&settings.url, cfg!(test))?;
    let http = reqwest::Client::builder()
      .http1_only()
      .pool_max_idle_per_host(1)
      .pool_idle_timeout(Duration::from_secs(60))
      .connect_timeout(timeout.min(Duration::from_secs(15)))
      .timeout(timeout)
      // A redirect could carry the next Authorization header to another
      // host. EWS does not redirect, so none is followed.
      .redirect(reqwest::redirect::Policy::none())
      .user_agent(concat!("DigitalHabitsMail/", env!("CARGO_PKG_VERSION")))
      .build()
      .map_err(|e| EwsError::Network(e.to_string()))?;
    Ok(EwsClient {
      settings,
      http,
      scheme: Mutex::new(None),
      turn: tauri::async_runtime::Mutex::new(()),
      refused: AtomicBool::new(false),
    })
  }

  /// Send one SOAP body and return the XML answer.
  ///
  /// A SOAP fault, or a response whose first `ResponseClass` is `Error`,
  /// comes back as [`EwsError::Fault`]. A response with more than one
  /// message and a mix of results comes back whole: the caller reads each.
  pub async fn call(&self, body: &str) -> EwsResult<String> {
    self.send(body, true).await
  }

  /// True after the server refused the password. See [`call`].
  ///
  /// [`call`]: EwsClient::call
  pub fn is_refused(&self) -> bool {
    self.refused.load(Ordering::SeqCst)
  }

  /// Send a request with many targets, for example `GetItem` on ten items.
  /// A failed first message is not an error here: the caller reads each
  /// message. A SOAP fault and a busy server are errors, as in [`call`].
  ///
  /// [`call`]: EwsClient::call
  pub async fn call_many(&self, body: &str) -> EwsResult<String> {
    self.send(body, false).await
  }

  async fn send(&self, body: &str, first_must_succeed: bool) -> EwsResult<String> {
    guard_request(body)?;
    let (status, text) = self.signed(body).await?;
    classify(status, text, first_must_succeed)
  }

  /// One signed POST of an XML body: NTLM, or Basic when the server offers
  /// no NTLM. The status and the text, with no reading of SOAP. A refused
  /// password is `EwsError::Refused`, and the client stops. For EWS calls
  /// (`send`) and for the Autodiscover POX request (`ews_autodiscover.rs`).
  pub async fn signed(&self, body: &str) -> EwsResult<(u16, String)> {
    if self.refused.load(Ordering::SeqCst) {
      return Err(EwsError::Refused);
    }
    let _turn = self.turn.lock().await;
    // A call that waited for the turn can find the account refused.
    if self.refused.load(Ordering::SeqCst) {
      return Err(EwsError::Refused);
    }
    let scheme = *self.scheme.lock().unwrap();
    let result = match scheme {
      Some(Scheme::Basic) => self.call_basic(body).await,
      Some(Scheme::Ntlm) | None => self.call_ntlm(body, scheme.is_none()).await,
    };
    if result == Err(EwsError::Refused) {
      self.refused.store(true, Ordering::SeqCst);
      log::warn!("ews: the server refused the password, the account stops until a new connect");
    }
    result
  }

  async fn call_ntlm(&self, body: &str, may_fall_back: bool) -> EwsResult<(u16, String)> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let hello = format!("NTLM {}", b64.encode(ntlm::negotiate()));
    // The first request has no body. The server reads none before sign-in,
    // and a large message sent twice costs time on a slow network.
    let first = self.post(&hello, "").await?;
    let status = first.status().as_u16();
    let offered = www_authenticate(first.headers());
    // Read the body to its end, so the connection goes back to the pool for
    // the next request.
    let _ = first.bytes().await;
    // The status and the scheme names only: never the tokens or the password.
    log::info!(
      "ews: negotiate answered {status}, schemes on offer: {}",
      offered.iter().map(|v| scheme_name(v)).collect::<Vec<_>>().join(", ")
    );

    if status != 401 {
      return Err(EwsError::Http {
        status,
        body: "The server did not ask for sign-in.".into(),
      });
    }

    if let Some(token) = ntlm_token(&offered) {
      return self.answer_challenge(&token, body).await;
    }

    // No challenge. With NTLM on offer that is a refusal of the first
    // message; it is not a password problem, so nothing is locked.
    if offers(&offered, "ntlm") {
      return Err(EwsError::Network("the server sent NTLM with no challenge".into()));
    }
    if may_fall_back && offers(&offered, "basic") {
      *self.scheme.lock().unwrap() = Some(Scheme::Basic);
      return self.call_basic(body).await;
    }
    Err(EwsError::NoScheme(if offered.is_empty() {
      "nothing".into()
    } else {
      offered.iter().map(|v| scheme_name(v)).collect::<Vec<_>>().join(", ")
    }))
  }

  /// Step 3 of the handshake: the answer to the challenge, with the body.
  async fn answer_challenge(&self, token: &str, body: &str) -> EwsResult<(u16, String)> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let raw = b64
      .decode(token.trim())
      .map_err(|e| EwsError::Network(format!("the NTLM challenge is not base64: {e}")))?;
    let challenge = ntlm::Challenge::parse(&raw).map_err(EwsError::Network)?;
    let identity = ntlm::Identity::from_username(&self.settings.username);
    let client_challenge = ntlm::client_challenge().map_err(EwsError::Network)?;
    let answer = ntlm::authenticate(
      &challenge,
      &identity,
      &self.settings.password,
      "",
      client_challenge,
      ntlm::now_filetime(),
    );
    let response = self.post(&format!("NTLM {}", b64.encode(answer)), body).await?;
    log::info!("ews: NTLM answer got {}", response.status().as_u16());
    if response.status().as_u16() == 401 {
      return Err(EwsError::Refused);
    }
    *self.scheme.lock().unwrap() = Some(Scheme::Ntlm);
    finish(response).await
  }

  async fn call_basic(&self, body: &str) -> EwsResult<(u16, String)> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let pair = format!("{}:{}", self.settings.username, self.settings.password);
    let response = self.post(&format!("Basic {}", b64.encode(pair)), body).await?;
    if response.status().as_u16() == 401 {
      return Err(EwsError::Refused);
    }
    finish(response).await
  }

  async fn post(&self, authorization: &str, body: &str) -> EwsResult<reqwest::Response> {
    self
      .http
      .post(&self.settings.url)
      .header(reqwest::header::AUTHORIZATION, authorization)
      .header(reqwest::header::CONTENT_TYPE, "text/xml; charset=utf-8")
      .header(reqwest::header::ACCEPT, "text/xml")
      // IIS answers 411 to a POST with no Content-Length, even an empty one,
      // and this client does not add the header by itself.
      .header(reqwest::header::CONTENT_LENGTH, body.len())
      .body(body.to_string())
      .send()
      .await
      .map_err(|e| EwsError::Network(e.to_string()))
  }
}

/// The operations no request from this app may carry. There is no way here
/// to empty a folder or to delete one (section 12 of the design note).
const REFUSED_OPERATIONS: [&str; 2] = ["EmptyFolder", "DeleteFolder"];

/// Is an element called `name` in the body, with any prefix or none?
fn has_element(body: &str, name: &str) -> bool {
  body.split('<').skip(1).any(|tag| {
    let tag_name = tag.split(|c: char| c.is_whitespace() || c == '>' || c == '/').next().unwrap_or("");
    tag_name.rsplit(':').next() == Some(name)
  })
}

/// Refuse a request that empties or deletes a folder, or a `DeleteItem`
/// that names no item. Checked on every request, also the raw
/// `mail_ews_call`, before anything goes to the server.
pub fn guard_request(body: &str) -> EwsResult<()> {
  for name in REFUSED_OPERATIONS {
    if has_element(body, name) {
      return Err(EwsError::Invalid(format!("{name} is not allowed in this app. Nothing was sent to the server.")));
    }
  }
  if has_element(body, "DeleteItem") {
    let named = body.matches("ItemId Id=\"").count();
    if named == 0 || body.contains("ItemId Id=\"\"") {
      return Err(EwsError::Invalid("DeleteItem must name each item. Nothing was sent to the server.".into()));
    }
  }
  Ok(())
}

fn check_url(url: &str, allow_plain: bool) -> EwsResult<()> {
  let parsed = url::Url::parse(url.trim())
    .map_err(|_| EwsError::Invalid(format!("The server address is not a URL: {url}")))?;
  if parsed.scheme() != "https" && !(allow_plain && parsed.scheme() == "http") {
    return Err(EwsError::Invalid(
      "The server address must start with https://. The password must not go over plain HTTP.".into(),
    ));
  }
  if parsed.host_str().map_or(true, str::is_empty) {
    return Err(EwsError::Invalid(format!("The server address has no host: {url}")));
  }
  Ok(())
}

/// Every `WWW-Authenticate` value, one per scheme.
fn www_authenticate(headers: &reqwest::header::HeaderMap) -> Vec<String> {
  headers
    .get_all(reqwest::header::WWW_AUTHENTICATE)
    .iter()
    .filter_map(|v| v.to_str().ok())
    .map(|v| v.trim().to_string())
    .collect()
}

fn scheme_name(value: &str) -> String {
  value.split_whitespace().next().unwrap_or("").to_string()
}

fn offers(values: &[String], scheme: &str) -> bool {
  values.iter().any(|v| scheme_name(v).eq_ignore_ascii_case(scheme))
}

/// The base64 token after `NTLM`, if the server sent a challenge.
fn ntlm_token(values: &[String]) -> Option<String> {
  values.iter().find_map(|v| {
    let (name, rest) = v.split_once(char::is_whitespace)?;
    let rest = rest.trim();
    (name.eq_ignore_ascii_case("ntlm") && !rest.is_empty()).then(|| rest.to_string())
  })
}

async fn finish(response: reqwest::Response) -> EwsResult<(u16, String)> {
  let status = response.status().as_u16();
  let text = response.text().await.map_err(|e| EwsError::Network(e.to_string()))?;
  Ok((status, text))
}

/// Read the status and the body of an answer.
fn classify(status: u16, text: String, first_must_succeed: bool) -> EwsResult<String> {
  if status == 503 || text.contains("ErrorServerBusy") {
    return Err(EwsError::Busy(back_off_ms(&text)));
  }
  if status == 200 {
    if first_must_succeed {
      if let Some(error) = first_response_error(&text) {
        return Err(error);
      }
    }
    return Ok(text);
  }
  // EWS sends a SOAP fault with HTTP 500.
  if let Some(fault) = element_text(&text, "faultstring") {
    let code = element_text(&text, "ResponseCode")
      .or_else(|| element_text(&text, "faultcode"))
      .unwrap_or_else(|| "Fault".into());
    return Err(EwsError::Fault { code, message: fault });
  }
  Err(EwsError::Http { status, body: text })
}

/// An error in the first response message, if the first one failed.
fn first_response_error(xml: &str) -> Option<EwsError> {
  let class = attribute_value(xml, "ResponseClass")?;
  if class != "Error" {
    return None;
  }
  Some(EwsError::Fault {
    code: element_text(xml, "ResponseCode").unwrap_or_else(|| "Error".into()),
    message: element_text(xml, "MessageText").unwrap_or_default(),
  })
}

fn back_off_ms(xml: &str) -> Option<u64> {
  let at = xml.find("\"BackOffMilliseconds\"")?;
  let rest = &xml[at..];
  let start = rest.find('>')? + 1;
  let end = rest[start..].find('<')? + start;
  rest[start..end].trim().parse().ok()
}

// ---------------------------------------------------------------------------
// A little XML
//
// The transport reads only the kind of an answer: a fault, a busy server, or
// a failed first message. The `ews` crate reads the rest (ews_ops.rs).
// ---------------------------------------------------------------------------

/// The text of the first element with this local name, any prefix.
pub fn element_text(xml: &str, local: &str) -> Option<String> {
  let mut from = 0;
  while let Some(open) = xml[from..].find('<').map(|i| i + from) {
    let tag_end = xml[open..].find('>').map(|i| i + open)?;
    let tag = &xml[open + 1..tag_end];
    from = tag_end + 1;
    if tag.starts_with('/') || tag.starts_with('?') || tag.starts_with('!') {
      continue;
    }
    let name = tag.split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
    let name_local = name.rsplit(':').next().unwrap_or(name);
    if name_local != local {
      continue;
    }
    if tag.ends_with('/') {
      return Some(String::new());
    }
    let close = xml[from..].find('<').map(|i| i + from)?;
    return Some(unescape(&xml[from..close]));
  }
  None
}

/// The value of the first attribute with this name.
fn attribute_value(xml: &str, name: &str) -> Option<String> {
  let needle = format!(" {name}=\"");
  let at = xml.find(&needle)? + needle.len();
  let end = xml[at..].find('"')? + at;
  Some(unescape(&xml[at..end]))
}

fn unescape(text: &str) -> String {
  text
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")
    .replace("&amp;", "&")
}

/// The inbox name and counts, for the connect check and the debug command.
pub async fn inbox(client: &EwsClient) -> EwsResult<crate::ews_ops::FolderSummary> {
  let xml = client.call(&crate::ews_ops::inbox_request()?).await?;
  crate::ews_ops::read_inbox(&xml)
}

// ---------------------------------------------------------------------------
// The accounts, in Tauri state
// ---------------------------------------------------------------------------

/// The connected Exchange accounts, by email. Filled from the keychain on
/// first use. Cheap to clone: the clones share one map, so the store can
/// hold one to remove an account (see `MailDb::set_exchange_remover`).
#[derive(Default, Clone)]
pub struct EwsAccounts(Arc<Mutex<HashMap<String, Arc<EwsClient>>>>);

impl EwsAccounts {
  /// The URL and the username of a connected account. Never the password.
  pub fn settings_of(&self, secrets: &Secrets, email: &str) -> EwsResult<(String, String)> {
    let client = self.client(secrets, email)?;
    Ok((client.settings.url.clone(), client.settings.username.clone()))
  }

  pub fn client(&self, secrets: &Secrets, email: &str) -> EwsResult<Arc<EwsClient>> {
    let key = normalize_email(email);
    if let Some(client) = self.0.lock().unwrap().get(&key) {
      return Ok(client.clone());
    }
    let raw = secrets
      .get(&keychain_account(&key))
      .map_err(|e| EwsError::Network(format!("keychain: {e}")))?
      .ok_or_else(|| EwsError::NoAccount(key.clone()))?;
    let settings: EwsSettings = serde_json::from_str(&raw)
      .map_err(|_| EwsError::Invalid("The keychain item for this account is damaged. Connect again.".into()))?;
    let client = Arc::new(EwsClient::new(settings)?);
    // Two first calls at once can both read the keychain. The first to
    // get here wins, so both use one client.
    Ok(self.0.lock().unwrap().entry(key).or_insert(client).clone())
  }

  fn put(&self, email: &str, client: Arc<EwsClient>) {
    self.0.lock().unwrap().insert(normalize_email(email), client);
  }

  fn forget(&self, email: &str) {
    self.0.lock().unwrap().remove(&normalize_email(email));
  }

  /// Remove an account's password: the client in memory and the keychain
  /// item. The only way the password leaves the keychain.
  pub fn remove(&self, secrets: &Secrets, email: &str) -> Result<(), String> {
    self.forget(email);
    secrets.delete(&keychain_account(email))
  }
}

/// Connect: sign in with the settings, and keep them only if that worked.
pub async fn connect(
  secrets: &Secrets,
  accounts: &EwsAccounts,
  email: &str,
  settings: EwsSettings,
) -> EwsResult<FolderSummary> {
  let email = normalize_email(email);
  if !email.contains('@') {
    return Err(EwsError::Invalid("Enter the email address of the mailbox.".into()));
  }
  if settings.username.trim().is_empty() {
    return Err(EwsError::Invalid("Enter the username.".into()));
  }
  if settings.password.is_empty() {
    return Err(EwsError::Invalid("Enter the password.".into()));
  }
  let settings = EwsSettings {
    url: settings.url.trim().to_string(),
    username: settings.username.trim().to_string(),
    password: settings.password,
  };
  let client = Arc::new(EwsClient::new(settings.clone())?);
  let summary = inbox(&client).await?;
  let raw = serde_json::to_string(&settings).map_err(|e| EwsError::Invalid(e.to_string()))?;
  secrets
    .set(&keychain_account(&email), &raw)
    .map_err(|e| EwsError::Network(format!("keychain: {e}")))?;
  accounts.put(&email, client);
  log::info!("ews: connected {email}");
  Ok(summary)
}

/// The commands. Registered only with the `exchange` feature, in the
/// internal builds.
pub mod commands {
  use super::*;

  /// Sign in to an Exchange server, keep the password in the keychain, and
  /// write the account row. Returns the inbox name and counts. If sign-in
  /// fails, nothing is kept. The owner is `local` if not given, as in the
  /// standalone app.
  #[allow(clippy::too_many_arguments)]
  #[tauri::command]
  pub async fn mail_ews_connect(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    db: tauri::State<'_, MailDb>,
    email: String,
    username: String,
    password: String,
    url: String,
    owner_id: Option<String>,
  ) -> Result<FolderSummary, String> {
    let settings = EwsSettings { url, username, password };
    let summary = connect(&secrets, &accounts, &email, settings).await.map_err(|e| e.to_string())?;
    let owner = owner_id.filter(|o| !o.trim().is_empty()).unwrap_or_else(|| "local".into());
    let (url, username) = accounts.settings_of(&secrets, &email).map_err(|e| e.to_string())?;
    if let Err(err) = db.accounts_save_exchange(&normalize_email(&email), &owner, &url, &username) {
      // A password with no row is a password nobody can remove from the app.
      let _ = accounts.remove(&secrets, &email);
      return Err(format!("ews:invalid: The account row could not be written: {err}"));
    }
    Ok(summary)
  }

  /// Send one SOAP envelope for a connected account. Returns the XML answer.
  #[tauri::command]
  pub async fn mail_ews_call(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
    body: String,
  ) -> Result<String, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    client.call(&body).await.map_err(|e| e.to_string())
  }

  /// The inbox name and counts for a connected account. For the debug
  /// command in the internal build.
  #[tauri::command]
  pub async fn mail_ews_inbox(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<FolderSummary, String> {
    let client = accounts.client(&secrets, &account).map_err(|e| e.to_string())?;
    inbox(&client).await.map_err(|e| e.to_string())
  }

  /// True when the keychain has a password for the account, and the server
  /// has not refused it since the last connect. No call to the server: for
  /// the mailbox health check at start.
  #[tauri::command]
  pub fn mail_ews_ready(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<bool, String> {
    match accounts.client(&secrets, &account) {
      Ok(client) => Ok(!client.is_refused()),
      Err(EwsError::NoAccount(_)) => Ok(false),
      Err(err) => Err(err.to_string()),
    }
  }

  /// Remove the account's password from the keychain. The account row
  /// stays: `accounts.remove` in the store removes both.
  #[tauri::command]
  pub fn mail_ews_disconnect(
    secrets: tauri::State<'_, Secrets>,
    accounts: tauri::State<'_, EwsAccounts>,
    account: String,
  ) -> Result<(), String> {
    accounts.remove(&secrets, &account)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  use crate::ews_fixtures::{self as fx, FolderFixture};

  fn get_folder_ok() -> String {
    fx::get_folders(&[&FolderFixture { children: 3, ..FolderFixture::mail(1, 99, "Inbox &amp; more", 1204, 17) }])
  }

  fn get_folder_error() -> String {
    fx::response(
      "GetFolder",
      &[fx::error("GetFolder", "ErrorFolderNotFound", "The specified folder could not be found in the store.")],
    )
  }

  fn soap_fault() -> String {
    fx::fault("ErrorSchemaValidation", "The request failed schema validation.")
  }

  const BUSY: &str = r#"<s:Envelope xmlns:s="s"><s:Body><s:Fault><faultcode>a:ErrorServerBusy</faultcode><faultstring>The server cannot service this request right now. Try again later.</faultstring><detail><e:ResponseCode xmlns:e="e">ErrorServerBusy</e:ResponseCode><e:MessageXml xmlns:e="e"><t:Value xmlns:t="t" Name="BackOffMilliseconds">3000</t:Value></e:MessageXml></detail></s:Fault></s:Body></s:Envelope>"#;

  #[test]
  fn reads_the_inbox_summary() {
    let summary = crate::ews_ops::read_inbox(&classify(200, get_folder_ok(), true).unwrap()).unwrap();
    assert_eq!(
      summary,
      FolderSummary {
        display_name: "Inbox & more".into(),
        total_count: 1204,
        unread_count: 17,
        child_folder_count: 3,
      }
    );
  }

  #[test]
  fn an_error_response_is_a_fault() {
    assert_eq!(
      classify(200, get_folder_error(), true),
      Err(EwsError::Fault {
        code: "ErrorFolderNotFound".into(),
        message: "The specified folder could not be found in the store.".into(),
      })
    );
  }

  #[test]
  fn a_soap_fault_is_a_fault() {
    assert_eq!(
      classify(500, soap_fault(), true),
      Err(EwsError::Fault {
        code: "ErrorSchemaValidation".into(),
        message: "The request failed schema validation.".into(),
      })
    );
  }

  #[test]
  fn busy_carries_the_back_off() {
    assert_eq!(classify(500, BUSY.into(), true), Err(EwsError::Busy(Some(3000))));
    assert_eq!(classify(503, String::new(), false), Err(EwsError::Busy(None)));
  }

  #[test]
  fn other_status_is_http() {
    assert!(matches!(classify(404, "gone".into(), true), Err(EwsError::Http { status: 404, .. })));
  }

  #[test]
  fn a_call_with_many_targets_keeps_a_failed_first_message() {
    let xml = get_folder_error();
    assert_eq!(classify(200, xml.clone(), false), Ok(xml));
  }

  #[test]
  fn reads_the_schemes_on_offer() {
    let offered = vec![
      "Negotiate".to_string(),
      "NTLM".to_string(),
      "Basic realm=\"mail.example.com\"".to_string(),
    ];
    assert!(offers(&offered, "ntlm"));
    assert!(offers(&offered, "basic"));
    assert!(!offers(&offered, "bearer"));
    assert_eq!(ntlm_token(&offered), None);
    let challenge = vec!["NTLM TlRMTVNTUAACAAAA".to_string()];
    assert_eq!(ntlm_token(&challenge).as_deref(), Some("TlRMTVNTUAACAAAA"));
  }

  #[test]
  fn refuses_a_plain_http_server() {
    assert!(matches!(
      check_url("http://mail.example.com/EWS/Exchange.asmx", false),
      Err(EwsError::Invalid(_))
    ));
    assert!(matches!(check_url("not a url", false), Err(EwsError::Invalid(_))));
    assert!(check_url("https://mail.example.com/EWS/Exchange.asmx", false).is_ok());
  }

  #[test]
  fn the_envelope_names_the_version() {
    let xml = crate::ews_ops::inbox_request().unwrap();
    assert!(xml.contains(&format!(r#"Version="{REQUEST_SERVER_VERSION}""#)));
    assert!(xml.contains(r#"<t:DistinguishedFolderId Id="inbox"/>"#), "{xml}");
  }

  #[test]
  fn error_messages_start_with_the_code() {
    assert!(EwsError::Refused.to_string().starts_with("ews:refused: "));
    assert!(EwsError::NoAccount("a@example.com".into()).to_string().starts_with("ews:no-account: "));
  }

  #[test]
  fn keychain_item_is_per_address() {
    assert_eq!(keychain_account(" Someone@Example.COM "), "exchange:someone@example.com");
  }

  // -------------------------------------------------------------------------
  // A fake EWS server on the loopback
  // -------------------------------------------------------------------------

  use hmac::{Hmac, Mac};
  use std::sync::atomic::AtomicUsize;

  const PASSWORD: &str = "correct horse";
  const USERNAME: &str = "someone@example.com";
  const SERVER_CHALLENGE: [u8; 8] = [9, 8, 7, 6, 5, 4, 3, 2];

  #[derive(Clone, Copy, PartialEq)]
  enum Offer {
    Ntlm,
    Basic,
    NegotiateOnly,
  }

  struct FakeServer {
    url: String,
    requests: Arc<AtomicUsize>,
  }

  fn header(request: &tiny_http::Request, name: &str) -> Option<String> {
    request
      .headers()
      .iter()
      .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
      .map(|h| h.value.as_str().to_string())
  }

  fn challenge_message() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"NTLMSSP\0");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0, 48, 0, 0, 0]);
    out.extend_from_slice(&0xa288_8205u32.to_le_bytes());
    out.extend_from_slice(&SERVER_CHALLENGE);
    out.extend_from_slice(&[0u8; 8]);
    // Target info: only the end marker.
    out.extend_from_slice(&[4, 0, 4, 0, 48, 0, 0, 0]);
    out.extend_from_slice(&[0u8; 4]);
    out
  }

  /// Check the NTLMv2 proof in an AUTHENTICATE message, as a server does.
  fn proof_is_good(message: &[u8]) -> bool {
    let field = |index: usize| {
      let at = 12 + index * 8;
      let len = u16::from_le_bytes([message[at], message[at + 1]]) as usize;
      let offset = u32::from_le_bytes(message[at + 4..at + 8].try_into().unwrap()) as usize;
      message[offset..offset + len].to_vec()
    };
    let nt = field(1);
    let user: Vec<u16> = field(3).chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let identity = ntlm::Identity { domain: String::new(), user: String::from_utf16(&user).unwrap() };
    let key = ntlm::ntowf_v2(PASSWORD, &identity);
    let mut mac = Hmac::<md5::Md5>::new_from_slice(&key).unwrap();
    mac.update(&SERVER_CHALLENGE);
    mac.update(&nt[16..]);
    mac.finalize().into_bytes().as_slice() == &nt[..16]
  }

  fn respond(request: tiny_http::Request, status: u16, www: &[&str], body: &str) {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    for value in www {
      response.add_header(tiny_http::Header::from_bytes("WWW-Authenticate", *value).unwrap());
    }
    let _ = request.respond(response);
  }

  fn serve(offer: Offer) -> FakeServer {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    std::thread::spawn(move || {
      let b64 = base64::engine::general_purpose::STANDARD;
      // The client port of the connection that got the challenge.
      let mut challenged: Option<std::net::SocketAddr> = None;
      for mut request in server.incoming_requests() {
        count.fetch_add(1, Ordering::SeqCst);
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);
        let auth = header(&request, "Authorization").unwrap_or_default();
        let peer = request.remote_addr().copied();
        // Like IIS: a POST with no Content-Length gets 411, even with no body.
        if header(&request, "Content-Length").is_none() {
          respond(request, 411, &[], "");
          continue;
        }
        match offer {
          Offer::NegotiateOnly => respond(request, 401, &["Negotiate"], ""),
          Offer::Basic => {
            let good = format!("Basic {}", b64.encode(format!("{USERNAME}:{PASSWORD}")));
            if auth == good && body.contains("GetFolder") {
              respond(request, 200, &[], &get_folder_ok());
            } else {
              respond(request, 401, &["Basic realm=\"mail.example.com\""], "");
            }
          }
          Offer::Ntlm => {
            let token = auth.strip_prefix("NTLM ").map(|t| b64.decode(t).unwrap());
            match token {
              Some(message) if message[8] == 1 => {
                challenged = peer;
                let value = format!("NTLM {}", b64.encode(challenge_message()));
                respond(request, 401, &[&value], "");
              }
              // Same connection as the challenge, a good proof, and a body.
              Some(message)
                if message[8] == 3 && peer == challenged && proof_is_good(&message) && body.contains("GetFolder") =>
              {
                respond(request, 200, &[], &get_folder_ok());
              }
              _ => respond(request, 401, &["Negotiate", "NTLM"], ""),
            }
          }
        }
      }
    });
    FakeServer { url: format!("http://127.0.0.1:{port}/EWS/Exchange.asmx"), requests }
  }

  fn client(url: &str, password: &str) -> EwsClient {
    EwsClient::new(EwsSettings { url: url.into(), username: USERNAME.into(), password: password.into() }).unwrap()
  }

  #[test]
  fn signs_in_with_ntlm_on_one_connection() {
    let server = serve(Offer::Ntlm);
    let client = client(&server.url, PASSWORD);
    tauri::async_runtime::block_on(async {
      assert_eq!(inbox(&client).await.unwrap().display_name, "Inbox & more");
      // A second call does the handshake again and works again.
      assert_eq!(inbox(&client).await.unwrap().unread_count, 17);
    });
    assert_eq!(server.requests.load(Ordering::SeqCst), 4);
  }

  #[test]
  fn a_wrong_password_stops_the_account() {
    let server = serve(Offer::Ntlm);
    let client = client(&server.url, "wrong");
    tauri::async_runtime::block_on(async {
      assert_eq!(inbox(&client).await, Err(EwsError::Refused));
      assert_eq!(inbox(&client).await, Err(EwsError::Refused));
    });
    // Negotiate and one answer. The second call sent nothing.
    assert_eq!(server.requests.load(Ordering::SeqCst), 2);
  }

  #[test]
  fn falls_back_to_basic() {
    let server = serve(Offer::Basic);
    let client = client(&server.url, PASSWORD);
    tauri::async_runtime::block_on(async {
      assert_eq!(inbox(&client).await.unwrap().total_count, 1204);
      // Basic from now on: one request per call.
      inbox(&client).await.unwrap();
    });
    assert_eq!(server.requests.load(Ordering::SeqCst), 3);
  }

  #[test]
  fn a_wrong_password_over_basic_stops_the_account() {
    let server = serve(Offer::Basic);
    let client = client(&server.url, "wrong");
    tauri::async_runtime::block_on(async {
      assert_eq!(inbox(&client).await, Err(EwsError::Refused));
      assert_eq!(inbox(&client).await, Err(EwsError::Refused));
    });
    assert_eq!(server.requests.load(Ordering::SeqCst), 2);
  }

  #[test]
  fn says_when_no_scheme_fits() {
    let server = serve(Offer::NegotiateOnly);
    let client = client(&server.url, PASSWORD);
    let result = tauri::async_runtime::block_on(inbox(&client));
    assert_eq!(result, Err(EwsError::NoScheme("Negotiate".into())));
  }
}
