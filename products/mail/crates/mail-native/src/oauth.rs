//! The loopback half of the OAuth flow.
//!
//! An installed app has no server to redirect to, so it becomes one for a
//! moment. Google calls this the loopback flow, and it is the recommended way
//! for a desktop app: bind a port on 127.0.0.1, send the user to the browser,
//! and catch the redirect when it comes back.
//!
//! No secret takes part. The webview holds a PKCE verifier and proves it at the
//! exchange. See `products/mail/packages/mail/lib/mail/pkce.ts`.
//!
//! Three commands, because the port has to exist before the authorization URL
//! can name it: `oauth_bind` takes a port and holds it, `oauth_await_redirect`
//! waits on it, and `oauth_cancel` gives up on a wait the browser is never
//! going to answer — a user who closed the tab, or changed their mind.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tiny_http::{Header, Response, Server};

#[derive(Default)]
pub struct OauthListener {
  /// Held behind an `Arc` rather than moved out to wait on, so that `cancel`
  /// can still reach the listener while a thread is blocked inside it.
  server: Mutex<Option<Arc<Server>>>,
}

/// Shown in the browser tab the user is left looking at.
const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8>\
<title>Digital Habits: Mail</title>\
<body style=\"font:16px -apple-system,sans-serif;padding:3rem;text-align:center\">\
<p>Mailbox connected. You can close this tab.</p>";

impl OauthListener {
  /// Bind a free port on the loopback address, and keep it.
  pub fn bind(&self) -> Result<u16, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
      .server_addr()
      .to_ip()
      .ok_or_else(|| "loopback address has no port".to_string())?
      .port();
    *self.server.lock().unwrap() = Some(Arc::new(server));
    Ok(port)
  }

  /// Give up on a wait, so the thread in `await_redirect` comes back.
  ///
  /// Nothing else could end it: `recv` blocks until a request arrives, and
  /// none is coming once the user has closed the browser tab or decided
  /// against connecting the mailbox at all. Without this the thread was held
  /// for the life of the app, the port with it, and the interface had no
  /// honest way to offer the reader a way out.
  ///
  /// Does nothing when no wait is in flight, so calling it twice is safe.
  pub fn cancel(&self) {
    if let Some(server) = self.server.lock().unwrap().take() {
      server.unblock();
    }
  }

  /// Wait for the redirect, and answer what it carried.
  ///
  /// The state must match the one that started the flow. A mismatch means this
  /// redirect belongs to a different request, so it is refused.
  pub fn await_redirect(&self, expected_state: &str) -> Result<Value, String> {
    // Cloned, not taken: `cancel` needs to find it here while this waits.
    let server = self
      .server
      .lock()
      .unwrap()
      .clone()
      .ok_or_else(|| "no listener is bound".to_string())?;

    let received = server.recv();
    // Done with it either way — the port goes back, and a cancel arriving
    // after this finds nothing to unblock rather than the next flow's
    // listener.
    self.server.lock().unwrap().take();
    let request = received.map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1{}", request.url());
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in parsed.query_pairs() {
      match key.as_ref() {
        "code" => code = Some(value.to_string()),
        "state" => state = Some(value.to_string()),
        "error" => error = Some(value.to_string()),
        _ => {}
      }
    }

    let header: Header = "Content-Type: text/html; charset=utf-8".parse().unwrap();
    let _ = request.respond(Response::from_string(DONE_PAGE).with_header(header));

    if let Some(error) = error {
      return Err(format!("the authorization was refused: {error}"));
    }
    if state.as_deref() != Some(expected_state) {
      return Err("the redirect did not match this request".to_string());
    }
    match code {
      Some(code) => Ok(json!({ "code": code })),
      None => Err("the redirect carried no code".to_string()),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;

  fn get(port: u16, query: &str) {
    use std::io::Write;
    use std::net::TcpStream;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "GET /callback?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("write");
  }

  #[test]
  fn it_catches_the_code_from_the_redirect() {
    let listener = OauthListener::default();
    let port = listener.bind().expect("bind");
    std::thread::spawn(move || get(port, "code=the-code&state=st8"));
    let result = listener.await_redirect("st8").expect("redirect");
    assert_eq!(result["code"], json!("the-code"));
  }

  #[test]
  fn it_refuses_a_redirect_for_another_request() {
    let listener = OauthListener::default();
    let port = listener.bind().expect("bind");
    std::thread::spawn(move || get(port, "code=the-code&state=someone-else"));
    let err = listener.await_redirect("st8").unwrap_err();
    assert!(err.contains("did not match"), "{err}");
  }

  #[test]
  fn it_reports_a_refusal_from_the_user() {
    let listener = OauthListener::default();
    let port = listener.bind().expect("bind");
    std::thread::spawn(move || get(port, "error=access_denied&state=st8"));
    let err = listener.await_redirect("st8").unwrap_err();
    assert!(err.contains("access_denied"), "{err}");
  }

  #[test]
  fn waiting_with_nothing_bound_says_so() {
    let listener = OauthListener::default();
    let err = listener.await_redirect("st8").unwrap_err();
    assert!(err.contains("no listener"), "{err}");
  }

  #[test]
  fn each_bind_takes_its_own_port() {
    let a = OauthListener::default();
    let b = OauthListener::default();
    assert_ne!(a.bind().unwrap(), b.bind().unwrap());
  }

  #[test]
  fn a_cancelled_wait_comes_back() {
    let listener = Arc::new(OauthListener::default());
    listener.bind().expect("bind");

    let waiting = Arc::clone(&listener);
    let thread = std::thread::spawn(move || waiting.await_redirect("state-1"));
    // Let the wait get as far as recv before it is called off.
    std::thread::sleep(Duration::from_millis(50));
    listener.cancel();

    let result = thread.join().expect("the wait ended");
    assert!(result.is_err(), "a cancelled wait answers with an error");
  }

  #[test]
  fn cancelling_when_nothing_waits_is_harmless() {
    let listener = OauthListener::default();
    listener.cancel();
    listener.bind().expect("bind");
    listener.cancel();
    listener.cancel();
  }

  #[test]
  fn a_new_sign_in_may_start_after_a_cancel() {
    let listener = OauthListener::default();
    let first = listener.bind().expect("bind");
    listener.cancel();
    let second = listener.bind().expect("bind again");
    assert_ne!(first, second, "the second sign-in takes a port of its own");
  }
}

/// Hosts this app will post a token request to.
///
/// The command below makes a request that no page could make for itself: from
/// the app process, with no origin and no same-origin rules. That is the point,
/// and it is also why the address is not the caller's to choose. Script that
/// found its way into the webview would otherwise have a way to send anything
/// anywhere, carrying a client secret.
const TOKEN_HOSTS: &[&str] = &["login.microsoftonline.com", "oauth2.googleapis.com"];

/// Post a form to a provider's token endpoint, from outside the browser.
///
/// **Microsoft refuses a token request that carries an `Origin` header.** A
/// webview sends one on every `fetch`, so the exchange fails with AADSTS90023:
/// cross-origin token redemption is for single-page apps, and a single-page app
/// gets refresh tokens that last a day. This app is a native client, and a
/// native client is expected to make this request itself.
///
/// The status comes back with the body so the caller reads a refusal the same
/// way it would read one from `fetch`.
#[tauri::command]
pub async fn oauth_token_request(
  endpoint: String,
  form: HashMap<String, String>,
) -> Result<Value, String> {
  let parsed = url::Url::parse(&endpoint).map_err(|e| format!("bad endpoint: {e}"))?;
  if parsed.scheme() != "https" {
    return Err("a token endpoint must be https".to_string());
  }
  let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
  if !TOKEN_HOSTS.contains(&host.as_str()) {
    return Err(format!("{host} is not a token endpoint this app uses"));
  }

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .post(parsed)
    .form(&form)
    .send()
    .await
    .map_err(|e| format!("the token request failed: {e}"))?;

  let status = response.status().as_u16();
  let text = response.text().await.unwrap_or_default();
  // A gateway can answer HTML. The caller needs the status either way, so a
  // body that will not parse is reported rather than thrown away.
  let body: Value = serde_json::from_str(&text).unwrap_or(json!({ "error": text }));
  Ok(json!({ "status": status, "body": body }))
}

#[cfg(test)]
mod token_request_tests {
  use super::*;

  fn refuse(endpoint: &str) -> String {
    tauri::async_runtime::block_on(oauth_token_request(
      endpoint.to_string(),
      HashMap::new(),
    ))
    .unwrap_err()
  }

  #[test]
  fn it_posts_only_to_the_providers_it_knows() {
    assert!(refuse("https://evil.example.com/token").contains("not a token endpoint"));
    // A host that merely ends with an allowed one is a different host.
    assert!(refuse("https://login.microsoftonline.com.evil.test/t")
      .contains("not a token endpoint"));
  }

  #[test]
  fn it_refuses_anything_that_is_not_https() {
    assert!(refuse("http://login.microsoftonline.com/token").contains("https"));
    assert!(refuse("file:///etc/passwd").contains("https"));
    assert!(refuse("not a url").contains("bad endpoint"));
  }

}
