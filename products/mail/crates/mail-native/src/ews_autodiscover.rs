//! Exchange Autodiscover: find the EWS address of a mailbox from its email
//! address, as Thunderbird does (section 16.7 of `docs/mail-exchange-ews.md`;
//! Thunderbird's `ExchangeAutoDiscover.sys.mjs`).
//!
//! The POX request (`autodiscover.xml`) goes to these, in this order:
//!
//! a. `https://autodiscover.<domain>/autodiscover/autodiscover.xml`, signed
//! b. `https://<domain>/autodiscover/autodiscover.xml`, signed
//! c. `http://autodiscover.<domain>/autodiscover/autodiscover.xml`, a GET
//!    with no credentials, only to learn the https address it redirects to
//! d. the host in the DNS SRV record `_autodiscover._tcp.<domain>`
//!
//! Thunderbird sends the four at once and takes the first answer. This app
//! asks them one at a time, because of the rules below. KU locks an account
//! after repeated failed sign-ins (section 4.7):
//!
//! - The password goes over https only.
//! - A host outside the email's own domain gets no password until the person
//!   agrees: the search stops and answers `ask` with that host. Thunderbird
//!   asks the same for an address from an http redirect or from SRV.
//! - At most one signed request to each host for each address. A second one
//!   goes to a host only after a `redirectAddr` to another address in the
//!   same domain, and only after that host signed the first one in. A 401
//!   from a host that answered means the username or the password is wrong:
//!   the search stops at once with `ews:refused`, and no other host gets
//!   that password.
//! - Each try ends after `try_timeout`, and the whole search after
//!   `total_timeout`.
//! - The log has each host tried and its result. Never the password, a
//!   request, or an answer's body.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::ews::{element_text, EwsClient, EwsError, EwsResult, EwsSettings};
use crate::ews_xml::{all_inner, escape, inner};

/// Redirects of any kind, in one search. Thunderbird stops address
/// redirects at 2; this counts every step.
pub const MAX_STEPS: usize = 10;

/// Where the requests go, and how long they may take. `real()` in the app;
/// the tests send each host to a fake server on the loopback.
pub struct Net {
  /// A logical URL to the URL that is really asked. None: as it is.
  pub rewrite: Option<Arc<dyn Fn(&str) -> String + Send + Sync>>,
  /// The DNS servers for the SRV lookup. None: those of the system.
  pub dns: Option<Vec<SocketAddr>>,
  pub try_timeout: Duration,
  pub total_timeout: Duration,
}

impl Net {
  pub fn real() -> Net {
    Net { rewrite: None, dns: None, try_timeout: Duration::from_secs(10), total_timeout: Duration::from_secs(30) }
  }

  fn target(&self, url: &str) -> String {
    self.rewrite.as_ref().map_or_else(|| url.to_string(), |f| f(url))
  }
}

/// What the search found. `url` and `source` when found; `ask` with a host
/// when the next step would send the password outside the email's domain;
/// all empty when nothing was found.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Discovery {
  pub url: Option<String>,
  pub source: Option<String>,
  pub ask: Option<String>,
}

/// What one step gave.
#[derive(Debug, PartialEq, Eq)]
enum Step {
  Found(Discovery),
  Ask(String),
  /// Autodiscover for another address (`redirectAddr`).
  Address(String),
  Nothing,
}

/// What an Autodiscover answer says.
#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
  Ews(String),
  RedirectAddr(String),
  RedirectUrl(String),
  Nothing,
}

pub fn domain_of(email: &str) -> String {
  email.rsplit_once('@').map(|(_, d)| d.trim().trim_end_matches('.').to_lowercase()).unwrap_or_default()
}

fn host_of(url: &str) -> Option<String> {
  url::Url::parse(url).ok()?.host_str().map(str::to_lowercase)
}

/// The host is the domain, or under it.
fn inside(host: &str, domain: &str) -> bool {
  host == domain || host.ends_with(&format!(".{domain}"))
}

/// The POX request, as Thunderbird writes it.
pub fn pox_request(email: &str) -> String {
  format!(
    concat!(
      r#"<?xml version="1.0" encoding="utf-8"?>"#,
      r#"<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">"#,
      "<Request><EMailAddress>{email}</EMailAddress>",
      "<AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a",
      "</AcceptableResponseSchema></Request></Autodiscover>"
    ),
    email = escape(email.trim())
  )
}

/// The EWS address in an `Account`: `EwsUrl`, else `ASUrl`, of the
/// external protocol (`EXPR`) first, as the app is used from any network,
/// then the internal one (`EXCH`), then `EXHTTP`. Only an https address.
fn ews_url(account: &str) -> Option<String> {
  let protocols = all_inner(account, "Protocol");
  ["EXPR", "EXCH", "EXHTTP"].iter().find_map(|kind| {
    protocols.iter().filter(|p| element_text(p, "Type").as_deref() == Some(kind)).find_map(|p| {
      let url = element_text(p, "EwsUrl").filter(|u| !u.trim().is_empty()).or_else(|| element_text(p, "ASUrl"))?;
      let url = url.trim().to_string();
      url.to_lowercase().starts_with("https://").then_some(url)
    })
  })
}

/// Read an Autodiscover answer. An error answer (`Error`, for example code
/// 500 "the address cannot be found") is `Nothing`.
pub fn read_answer(xml: &str) -> Answer {
  let Some(account) = inner(xml, "Account") else { return Answer::Nothing };
  let action = element_text(account, "Action").unwrap_or_default().to_lowercase();
  let field = |name: &str| element_text(account, name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
  match action.as_str() {
    "redirectaddr" => field("RedirectAddr").map_or(Answer::Nothing, Answer::RedirectAddr),
    "redirecturl" => field("RedirectUrl").map_or(Answer::Nothing, Answer::RedirectUrl),
    _ => ews_url(account).map_or(Answer::Nothing, Answer::Ews),
  }
}

/// One search. Not `Debug`: it holds the password.
struct Search<'a> {
  net: &'a Net,
  username: String,
  password: String,
  /// The domain of the address the person typed. The password stays in it.
  own: String,
  /// A host the person allowed, after an `ask`.
  allowed: Option<String>,
  /// (host, address) pairs already asked.
  signed: HashSet<(String, String)>,
  steps: usize,
  deadline: Instant,
}

impl Search<'_> {
  /// The time a try may take now. None: the search is out of time.
  fn time_left(&self) -> Option<Duration> {
    let left = self.deadline.saturating_duration_since(Instant::now());
    (!left.is_zero()).then(|| left.min(self.net.try_timeout))
  }

  /// One signed POST to `url`, within the rules. `Err` only for a refused
  /// password, which stops the whole search.
  async fn follow(&mut self, url: &str, email: &str, source: &str) -> EwsResult<Step> {
    let Some(host) = host_of(url) else { return Ok(Step::Nothing) };
    if !url.to_lowercase().starts_with("https://") {
      log::info!("ews: autodiscover {source}: {host}: not https, no password sent");
      return Ok(Step::Nothing);
    }
    if !inside(&host, &self.own) && self.allowed.as_deref() != Some(host.as_str()) {
      log::info!("ews: autodiscover {source}: {host} is outside the email's domain, the person is asked");
      return Ok(Step::Ask(host));
    }
    if !self.signed.insert((host.clone(), email.to_lowercase())) {
      log::info!("ews: autodiscover {source}: {host}: asked already, not again");
      return Ok(Step::Nothing);
    }
    let Some(timeout) = self.time_left() else { return Ok(Step::Nothing) };
    let settings =
      EwsSettings { url: self.net.target(url), username: self.username.clone(), password: self.password.clone() };
    let client = EwsClient::with_timeout(settings, timeout)?;
    match client.signed(&pox_request(email)).await {
      Err(EwsError::Refused) => {
        log::warn!("ews: autodiscover {source}: {host}: 401 after sign-in, the search stops");
        Err(EwsError::Refused)
      }
      Err(e) => {
        log::info!("ews: autodiscover {source}: {host}: no answer ({})", e.code());
        Ok(Step::Nothing)
      }
      Ok((status, text)) => Box::pin(self.read(status, &text, &host, email, source)).await,
    }
  }

  /// What a signed answer leads to.
  async fn read(&mut self, status: u16, text: &str, host: &str, email: &str, source: &str) -> EwsResult<Step> {
    if status != 200 {
      log::info!("ews: autodiscover {source}: {host}: HTTP {status}");
      return Ok(Step::Nothing);
    }
    match read_answer(text) {
      Answer::Ews(url) => {
        log::info!("ews: autodiscover {source}: {host}: found the EWS address");
        let found = Discovery { url: Some(url), source: Some(source.to_string()), ask: None };
        Ok(Step::Found(found))
      }
      Answer::RedirectUrl(next) if self.step() => {
        log::info!("ews: autodiscover {source}: {host}: redirect to host {}", host_of(&next).unwrap_or_default());
        self.follow(&next, email, "redirectUrl").await
      }
      Answer::RedirectAddr(next) if self.step() => {
        log::info!("ews: autodiscover {source}: {host}: redirect to the domain {}", domain_of(&next));
        Ok(Step::Address(next))
      }
      Answer::Nothing => {
        log::info!("ews: autodiscover {source}: {host}: no EWS address in the answer");
        Ok(Step::Nothing)
      }
      _ => Ok(Step::Nothing),
    }
  }

  /// Count a redirect. False past `MAX_STEPS`.
  fn step(&mut self) -> bool {
    self.steps += 1;
    if self.steps > MAX_STEPS {
      log::warn!("ews: autodiscover: more than {MAX_STEPS} redirects, the search stops");
    }
    self.steps <= MAX_STEPS
  }

  /// Steps a to d for one address.
  async fn domain_search(&mut self, email: &str) -> EwsResult<Step> {
    let domain = domain_of(email);
    let a = format!("https://autodiscover.{domain}/autodiscover/autodiscover.xml");
    let b = format!("https://{domain}/autodiscover/autodiscover.xml");
    for (url, source) in [(a, format!("autodiscover.{domain}")), (b, domain.clone())] {
      match self.follow(&url, email, &source).await? {
        Step::Nothing => continue,
        other => return Ok(other),
      }
    }
    if let Some(url) = self.http_redirect(&domain).await {
      match self.follow(&url, email, "http redirect").await? {
        Step::Nothing => {}
        other => return Ok(other),
      }
    }
    if let Some(host) = self.srv(&domain).await {
      let url = format!("https://{host}/autodiscover/autodiscover.xml");
      return self.follow(&url, email, "SRV record").await;
    }
    Ok(Step::Nothing)
  }

  /// Step c: the https address that `http://autodiscover.<domain>` sends a
  /// GET with no credentials to. Nothing else is read from it.
  async fn http_redirect(&self, domain: &str) -> Option<String> {
    let url = format!("http://autodiscover.{domain}/autodiscover/autodiscover.xml");
    let host = format!("autodiscover.{domain}");
    let timeout = self.time_left()?;
    let http = reqwest::Client::builder()
      .redirect(reqwest::redirect::Policy::none())
      .timeout(timeout)
      .connect_timeout(timeout)
      .build()
      .ok()?;
    let response = match http.get(self.net.target(&url)).send().await {
      Ok(r) => r,
      Err(_) => {
        log::info!("ews: autodiscover http: {host}: no answer");
        return None;
      }
    };
    let status = response.status().as_u16();
    let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).map(str::to_string);
    match location.filter(|l| (300..400).contains(&status) && l.to_lowercase().starts_with("https://")) {
      Some(next) => {
        log::info!("ews: autodiscover http: {host}: redirect to host {}", host_of(&next).unwrap_or_default());
        Some(next)
      }
      None => {
        log::info!("ews: autodiscover http: {host}: HTTP {status}, no https redirect");
        None
      }
    }
  }

  /// Step d: the host of the SRV record, if there is one.
  async fn srv(&self, domain: &str) -> Option<String> {
    let timeout = self.time_left()?;
    let servers = self.net.dns.clone().unwrap_or_else(system_dns);
    let name = format!("_autodiscover._tcp.{domain}");
    let found = tauri::async_runtime::spawn_blocking(move || crate::ews_srv::lookup(&name, &servers, timeout))
      .await
      .ok()
      .flatten();
    log::info!("ews: autodiscover SRV: _autodiscover._tcp.{domain}: {}", found.as_deref().unwrap_or("no record"));
    found
  }
}

/// The name servers of the system, from `/etc/resolv.conf` (macOS writes it
/// for the resolver it uses). None found: no SRV step.
fn system_dns() -> Vec<SocketAddr> {
  let text = std::fs::read_to_string("/etc/resolv.conf").unwrap_or_default();
  text
    .lines()
    .filter_map(|l| l.trim().strip_prefix("nameserver"))
    .filter_map(|ip| ip.trim().parse::<std::net::IpAddr>().ok())
    .map(|ip| SocketAddr::new(ip, 53))
    .collect()
}

/// Find the EWS address for `email`. `username` empty: the email signs in.
/// `allow_host`: a host the person allowed after an `ask`.
pub async fn discover(
  net: &Net,
  email: &str,
  username: &str,
  password: &str,
  allow_host: Option<&str>,
) -> EwsResult<Discovery> {
  let own = domain_of(email);
  if own.is_empty() || password.is_empty() {
    return Err(EwsError::Invalid("Type the email address and the password first.".into()));
  }
  let mut search = Search {
    net,
    username: if username.trim().is_empty() { email.trim().to_string() } else { username.trim().to_string() },
    password: password.to_string(),
    own,
    allowed: allow_host.map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty()),
    signed: HashSet::new(),
    steps: 0,
    deadline: Instant::now() + net.total_timeout,
  };
  let mut address = email.trim().to_string();
  loop {
    match search.domain_search(&address).await? {
      Step::Found(found) => return Ok(found),
      Step::Ask(host) => return Ok(Discovery { ask: Some(host), ..Discovery::default() }),
      Step::Address(next) => address = next,
      Step::Nothing => {
        log::info!("ews: autodiscover: nothing found");
        return Ok(Discovery::default());
      }
    }
  }
}

pub mod commands {
  use super::*;

  /// Find the EWS address of a mailbox. The password is used for this
  /// search only, and is not kept.
  #[tauri::command]
  pub async fn mail_ews_autodiscover(
    email: String,
    username: String,
    password: String,
    allow_host: Option<String>,
  ) -> Result<Discovery, String> {
    discover(&Net::real(), &email, &username, &password, allow_host.as_deref()).await.map_err(|e| e.to_string())
  }
}

#[cfg(test)]
#[path = "ews_autodiscover_tests.rs"]
mod tests;
