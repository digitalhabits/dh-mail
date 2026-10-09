//! Tests for ews_autodiscover.rs. Each logical host (`autodiscover.example.com`,
//! `example.com`, ...) is a fake host of its own on the loopback, so the
//! requests to each can be counted: which got a password, and how many.
//! Invented example.com data only.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::ews_fixtures::*;

const EMAIL: &str = "sam@example.com";
const EWS: &str = "https://mail.example.com/EWS/Exchange.asmx";

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

/// A test world: each "scheme://host" goes to a base URL. A host not in it
/// goes to a closed port: no answer.
struct World {
  hosts: HashMap<String, String>,
  dns: Vec<std::net::SocketAddr>,
  try_ms: u64,
}

impl World {
  fn new() -> World {
    World { hosts: HashMap::new(), dns: Vec::new(), try_ms: 2000 }
  }

  fn with(mut self, origin: &str, base: &str) -> World {
    self.hosts.insert(origin.to_string(), base.to_string());
    self
  }

  fn net(&self) -> Net {
    let hosts = self.hosts.clone();
    Net {
      rewrite: Some(Arc::new(move |url: &str| {
        let parsed = url::Url::parse(url).unwrap();
        let origin = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
        let base = hosts.get(&origin).cloned().unwrap_or_else(|| "http://127.0.0.1:9".to_string());
        format!("{base}{}", parsed.path())
      })),
      dns: Some(self.dns.clone()),
      try_timeout: Duration::from_millis(self.try_ms),
      total_timeout: Duration::from_millis(self.try_ms * 6),
    }
  }
}

fn answering(body: String) -> FakeHost {
  serve_autodiscover(Arc::new(move |_| (200, Vec::new(), body.clone())))
}

fn redirecting(location: &'static str) -> FakeHost {
  serve_autodiscover(Arc::new(move |r| {
    if r.method == "GET" {
      (302, vec![("Location", location.to_string())], String::new())
    } else {
      (405, Vec::new(), String::new())
    }
  }))
}

fn search(world: &World, allow: Option<&str>) -> EwsResult<Discovery> {
  run(discover(&world.net(), EMAIL, "", "correct horse", allow))
}

#[test]
fn found_at_step_a() {
  let a = answering(ad_settings(&[("EXCH", "https://internal.example.com/EWS/Exchange.asmx"), ("EXPR", EWS)]));
  let world = World::new().with("https://autodiscover.example.com", &a.base);
  let found = search(&world, None).unwrap();
  // The external address wins: the app is used from any network.
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(found.source.as_deref(), Some("autodiscover.example.com"));
  assert_eq!(a.signed_count(), 1);
  let sent = a.requests.lock().unwrap().iter().find(|r| r.signed()).unwrap().clone();
  assert!(sent.body.contains("<EMailAddress>sam@example.com</EMailAddress>"));
  assert_eq!(sent.password.as_deref(), Some("correct horse"));
}

#[test]
fn found_at_step_b_after_a_gives_nothing() {
  let a = answering(ad_error("500", "The e-mail address cannot be found."));
  let b = answering(ad_settings(&[("EXCH", EWS)]));
  let world = World::new().with("https://autodiscover.example.com", &a.base).with("https://example.com", &b.base);
  let found = search(&world, None).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(found.source.as_deref(), Some("example.com"));
  assert_eq!((a.signed_count(), b.signed_count()), (1, 1));
}

#[test]
fn step_c_follows_the_http_redirect_with_no_password_over_http() {
  let http = redirecting("https://autodiscover.example.com.hoster.example.net/autodiscover/autodiscover.xml");
  let world = World::new().with("http://autodiscover.example.com", &http.base);
  // The redirect leaves the email's domain: the person is asked first.
  let first = search(&world, None).unwrap();
  assert_eq!(first.ask.as_deref(), Some("autodiscover.example.com.hoster.example.net"));
  assert_eq!(first.url, None);
  let seen = http.requests.lock().unwrap().clone();
  assert_eq!(seen.len(), 1);
  assert_eq!(seen[0].method, "GET");
  assert!(seen[0].auth.is_none(), "no credentials over http");

  // Allowed: the password goes there, over https, once.
  let hoster = answering(ad_settings(&[("EXPR", EWS)]));
  let world = world.with("https://autodiscover.example.com.hoster.example.net", &hoster.base);
  let found = search(&world, Some("autodiscover.example.com.hoster.example.net")).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(found.source.as_deref(), Some("http redirect"));
  assert_eq!(hoster.signed_count(), 1);
  assert!(http.requests.lock().unwrap().iter().all(|r| !r.signed()));
}

#[test]
fn an_http_redirect_inside_the_domain_needs_no_question() {
  let http = redirecting("https://mail.example.com/autodiscover/autodiscover.xml");
  let mail = answering(ad_settings(&[("EXCH", EWS)]));
  let world =
    World::new().with("http://autodiscover.example.com", &http.base).with("https://mail.example.com", &mail.base);
  let found = search(&world, None).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(mail.signed_count(), 1);
}

#[test]
fn an_http_redirect_to_http_gets_no_password() {
  let http = redirecting("http://mail.example.com/autodiscover/autodiscover.xml");
  let plain = answering(ad_settings(&[("EXCH", EWS)]));
  let world =
    World::new().with("http://autodiscover.example.com", &http.base).with("http://mail.example.com", &plain.base);
  let found = search(&world, None).unwrap();
  assert_eq!(found, Discovery::default());
  assert_eq!(plain.requests.lock().unwrap().len(), 0);
}

#[test]
fn step_d_uses_the_srv_record() {
  let host = answering(ad_settings(&[("EXCH", EWS)]));
  let mut world = World::new().with("https://exch.example.com", &host.base);
  world.dns = vec![serve_dns("_autodiscover._tcp.example.com", "exch.example.com")];
  let found = search(&world, None).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(found.source.as_deref(), Some("SRV record"));

  // An SRV host outside the domain: asked first, no password sent.
  let mut world = World::new();
  world.dns = vec![serve_dns("_autodiscover._tcp.example.com", "autodiscover.hoster.example.net")];
  assert_eq!(search(&world, None).unwrap().ask.as_deref(), Some("autodiscover.hoster.example.net"));
}

#[test]
fn redirect_addr_follows_the_new_address() {
  // An alias in the same domain: the same host is asked again, for the new
  // address, after it signed the first one in.
  let a = serve_autodiscover(Arc::new(|r| {
    let body = if r.body.contains("sam.example@example.com") {
      ad_settings(&[("EXCH", EWS)])
    } else {
      ad_redirect_addr("sam.example@example.com")
    };
    (200, Vec::new(), body)
  }));
  let world = World::new().with("https://autodiscover.example.com", &a.base);
  let found = search(&world, None).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS));
  assert_eq!(a.signed_count(), 2);
}

#[test]
fn redirect_addr_to_another_domain_asks_first() {
  let a = answering(ad_redirect_addr("sam@example.org"));
  let other = answering(ad_settings(&[("EXCH", EWS)]));
  let world =
    World::new().with("https://autodiscover.example.com", &a.base).with("https://autodiscover.example.org", &other.base);
  let found = search(&world, None).unwrap();
  assert_eq!(found.ask.as_deref(), Some("autodiscover.example.org"));
  assert_eq!(other.requests.lock().unwrap().len(), 0, "no request, so no password, to the other domain");
}

#[test]
fn redirect_url_to_another_domain_asks_first() {
  let a = answering(ad_redirect_url("https://autodiscover.example.org/autodiscover/autodiscover.xml"));
  let other = answering(ad_settings(&[("EXCH", EWS)]));
  let world =
    World::new().with("https://autodiscover.example.com", &a.base).with("https://autodiscover.example.org", &other.base);
  assert_eq!(search(&world, None).unwrap().ask.as_deref(), Some("autodiscover.example.org"));
  assert_eq!(other.requests.lock().unwrap().len(), 0);
}

#[test]
fn a_401_stops_at_once() {
  let a = answering(ad_settings(&[("EXCH", EWS)]));
  let b = answering(ad_settings(&[("EXCH", EWS)]));
  let world = World::new().with("https://autodiscover.example.com", &a.base).with("https://example.com", &b.base);
  let err = run(discover(&world.net(), EMAIL, "", "wrong", None)).unwrap_err();
  assert_eq!(err, EwsError::Refused);
  assert_eq!(a.signed_count(), 1, "one signed try");
  assert_eq!(b.requests.lock().unwrap().len(), 0, "no second host gets the password");
}

#[test]
fn a_loop_of_redirects_stops() {
  // Each answer sends the search to another path on the same host. The same
  // host and address is signed once only, so the loop ends there.
  let a = serve_autodiscover(Arc::new(|_| {
    (200, Vec::new(), ad_redirect_url("https://autodiscover.example.com/autodiscover/again.xml"))
  }));
  let world = World::new().with("https://autodiscover.example.com", &a.base);
  assert_eq!(search(&world, None).unwrap(), Discovery::default());
  assert_eq!(a.signed_count(), 1);

  // A loop of address redirects in the domain stops after MAX_STEPS.
  let hops = serve_autodiscover(Arc::new(|r| {
    let n: usize = crate::ews::element_text(&r.body, "EMailAddress")
      .and_then(|e| e.trim_start_matches("sam").split('@').next().and_then(|n| n.parse().ok()))
      .unwrap_or(0);
    (200, Vec::new(), ad_redirect_addr(&format!("sam{}@example.com", n + 1)))
  }));
  let world = World::new().with("https://autodiscover.example.com", &hops.base);
  assert_eq!(search(&world, None).unwrap(), Discovery::default());
  assert_eq!(hops.signed_count(), MAX_STEPS + 1);
}

#[test]
fn a_server_that_never_answers_times_out() {
  let silent = serve_silent();
  let b = answering(ad_settings(&[("EXCH", EWS)]));
  let mut world = World::new().with("https://autodiscover.example.com", &silent).with("https://example.com", &b.base);
  world.try_ms = 300;
  let started = std::time::Instant::now();
  let found = search(&world, None).unwrap();
  assert_eq!(found.url.as_deref(), Some(EWS), "the next host is asked after the timeout");
  assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());

  // All silent: the whole search ends by its own time.
  let mut world = World::new()
    .with("https://autodiscover.example.com", &silent)
    .with("https://example.com", &silent)
    .with("http://autodiscover.example.com", &silent);
  world.try_ms = 200;
  let started = std::time::Instant::now();
  assert_eq!(search(&world, None).unwrap(), Discovery::default());
  assert!(started.elapsed() < Duration::from_millis(1500), "{:?}", started.elapsed());
}

#[test]
fn only_https_ews_addresses_are_taken() {
  let a = answering(ad_settings(&[("EXCH", "http://mail.example.com/EWS/Exchange.asmx")]));
  let world = World::new().with("https://autodiscover.example.com", &a.base);
  assert_eq!(search(&world, None).unwrap().url, None);
}

#[test]
fn the_fake_host_refuses_what_a_real_one_does() {
  let a = answering(ad_settings(&[("EXCH", EWS)]));
  let settings = crate::ews::EwsSettings {
    url: format!("{}/autodiscover/autodiscover.xml", a.base),
    username: EMAIL.into(),
    password: "correct horse".into(),
  };
  let client = EwsClient::new(settings).unwrap();
  let no_schema = pox_request(EMAIL).replace("responseschema/2006a", "responseschema/2006");
  let (status, text) = run(client.signed(&no_schema)).unwrap();
  assert_eq!(status, 200);
  assert!(text.contains("<ErrorCode>600</ErrorCode>"), "{text}");
  assert_eq!(read_answer(&text), Answer::Nothing);
  let (_, text) = run(client.signed(&pox_request("not-an-address"))).unwrap();
  assert!(text.contains("<ErrorCode>600</ErrorCode>"));
}

#[test]
fn the_answer_is_read_as_thunderbird_reads_it() {
  assert_eq!(read_answer(&ad_settings(&[("EXCH", EWS)])), Answer::Ews(EWS.into()));
  assert_eq!(read_answer(&ad_redirect_addr("a@example.org")), Answer::RedirectAddr("a@example.org".into()));
  assert_eq!(read_answer(&ad_error("500", "Not found")), Answer::Nothing);
  assert_eq!(read_answer("not xml"), Answer::Nothing);
  // ASUrl when there is no EwsUrl.
  let as_only = ad_settings(&[("EXCH", EWS)]).replace(&format!("<EwsUrl>{EWS}</EwsUrl>"), "");
  assert_eq!(read_answer(&as_only), Answer::Ews(EWS.into()));
}

#[test]
fn nothing_is_asked_with_no_password() {
  let world = World::new();
  assert_eq!(run(discover(&world.net(), EMAIL, "", "", None)).unwrap_err().code(), "ews:invalid");
}

#[test]
fn the_srv_packet_reads_back() {
  let q = crate::ews_srv::query("_autodiscover._tcp.example.com", 7);
  assert_eq!(&q[..2], &[0, 7]);
  assert!(crate::ews_srv::read(&q, 8).is_empty(), "another id is not ours");
}
