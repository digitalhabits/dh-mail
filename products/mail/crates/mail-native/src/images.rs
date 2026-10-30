//! Remote images in the message view.
//!
//! A message frame runs under `img-src 'self'`, so it cannot load a sender's
//! image directly, and relaxing that would also fail: plenty of senders set
//! Cross-Origin-Resource-Policy, which blocks a cross-origin embed whatever the
//! page allows.
//!
//! A server host solves this with a same-origin proxy route. This build has no
//! server, so native code fetches instead, under a scheme of its own. Nothing
//! in a message can reach it except through a rewritten `img` tag, and every
//! address is checked before a request goes out.
//!
//! Requests carry no cookies and no referrer, so a sender learns nothing beyond
//! the fact that an image was fetched.

use std::time::Duration;

/// `dhmail://localhost/<base64url of the remote address>`
pub const SCHEME: &str = "dhmail";

/// Newsletters send their banners full size: an Oxford Edge banner was
/// 5.4 MB, past the 5 MB this was, and showed as a broken frame where
/// Gmail (which shrinks pictures on its own servers) showed it (2026-10-30).
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(12);

/// A remote address taken from a protocol request path.
///
/// The path is base64url so a query string cannot be mistaken for the app's
/// own, and so no character needs escaping twice.
pub fn address_from_path(path: &str) -> Result<String, String> {
  let encoded = path.trim_start_matches('/');
  if encoded.is_empty() {
    return Err("no image address".into());
  }
  let decoded = base64_url_decode(encoded)?;
  let url = String::from_utf8(decoded).map_err(|_| "address is not text".to_string())?;
  check_address(&url)?;
  Ok(url)
}

/// Only remote http(s). Anything else is a way into the machine.
///
/// A private range is a property of an address, not of a name. Matching on the
/// text of the host refuses `10.example.org`, which is a perfectly ordinary
/// name, so the host is parsed first and only a literal address is range
/// checked here. A name is checked when it is resolved: see image_guard.rs.
pub(crate) fn check_address(url: &str) -> Result<(), String> {
  let parsed = url::Url::parse(url).map_err(|_| "not a valid address".to_string())?;
  if parsed.scheme() != "http" && parsed.scheme() != "https" {
    return Err("only http and https images are fetched".into());
  }
  let refused = || Err(crate::image_guard::REFUSED.to_string());
  match parsed.host() {
    None => Err("address has no host".into()),
    Some(url::Host::Ipv4(v4)) if !crate::image_guard::is_public_ip(v4.into()) => refused(),
    Some(url::Host::Ipv6(v6)) if !crate::image_guard::is_public_ip(v6.into()) => refused(),
    Some(url::Host::Domain(name)) => {
      // A name. Only the ones that mean this machine, or its cloud metadata.
      let host = name.to_lowercase();
      let host = host.trim_end_matches('.');
      if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".internal")
        || host.ends_with(".local")
      {
        return refused();
      }
      Ok(())
    }
    Some(_) => Ok(()),
  }
}

fn base64_url_decode(input: &str) -> Result<Vec<u8>, String> {
  const TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let mut acc: u32 = 0;
  let mut bits = 0;
  let mut out = Vec::new();
  for byte in input.bytes() {
    if byte == b'=' {
      break;
    }
    let value = TABLE
      .iter()
      .position(|c| *c == byte)
      .ok_or_else(|| "address is not base64url".to_string())? as u32;
    acc = (acc << 6) | value;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      out.push((acc >> bits) as u8);
    }
  }
  Ok(out)
}

/// Fetch one image. Answers the bytes and the content type.
pub async fn fetch(url: &str) -> Result<(Vec<u8>, String), String> {
  check_address(url)?;
  let client = reqwest::Client::builder()
    .timeout(TIMEOUT)
    // Each redirect is followed here, so that each hop is checked.
    .redirect(reqwest::redirect::Policy::none())
    // A proxy resolves the name itself, out of reach of the check.
    .no_proxy()
    .dns_resolver(std::sync::Arc::new(crate::image_guard::PublicOnlyResolver))
    .build()
    .map_err(|e| e.to_string())?;
  fetch_with(&client, url, check_address).await
}

/// Follow at most this many redirects for one image.
const MAX_REDIRECTS: usize = 5;

/// The fetch, with the check for each redirect as an argument, for tests.
async fn fetch_with(
  client: &reqwest::Client,
  url: &str,
  check: fn(&str) -> Result<(), String>,
) -> Result<(Vec<u8>, String), String> {
  let mut current = url.to_string();
  let mut redirects = 0;
  let response = loop {
    // The error text leaves out the address: the log must not hold it.
    let response = image_request(client, &current)
      .send()
      .await
      .map_err(describe)?;
    if !response.status().is_redirection() {
      break response;
    }
    redirects += 1;
    if redirects > MAX_REDIRECTS {
      return Err("the image server sent too many redirects".into());
    }
    let next = redirect_target(&current, &response)?;
    check(&next)?;
    current = next;
  };
  read_image(response).await
}

/// A reqwest error with its causes, but without the address: the log must
/// not hold it. A refusal from the resolver is one of the causes.
fn describe(error: reqwest::Error) -> String {
  let error = error.without_url();
  let mut text = error.to_string();
  let mut cause = std::error::Error::source(&error);
  while let Some(inner) = cause {
    text.push_str(": ");
    text.push_str(&inner.to_string());
    cause = inner.source();
  }
  text
}

/// The absolute address that a redirect points to.
fn redirect_target(current: &str, response: &reqwest::Response) -> Result<String, String> {
  let location = response
    .headers()
    .get(reqwest::header::LOCATION)
    .and_then(|v| v.to_str().ok())
    .ok_or_else(|| format!("the image server answered {} with no new address", response.status()))?;
  let base = url::Url::parse(current).map_err(|_| "not a valid address".to_string())?;
  let next = base.join(location).map_err(|_| "the redirect is not a valid address".to_string())?;
  Ok(next.to_string())
}

fn image_request(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
  client
    .get(url)
    .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
    // The user agent of the browser this app is built on.
    //
    // The honest one — "compatible; DigitalHabitsMail" — reads as a crawler to
    // the firewalls big senders put in front of their images, and they answer
    // it with a block page rather than the picture. Lloyds does exactly that:
    // the same URL returns 92kB of HTML to that name and a 132-byte PNG to
    // this one. Nothing is being fetched here that the reader did not already
    // receive, and every other mail client asks the same way.
    .header(
      "User-Agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
       (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    )
    // The rest of what a browser sends with an image request.
    //
    // British Airways answers a request without them with a 200 and an
    // "Information Page" in HTML, so every picture in an e-ticket was a
    // broken frame. Measured 2026-09-17: the language, an encoding and
    // Sec-Fetch-Dest together get the GIF, and any one of them missing gets
    // the page. `identity` is enough for the encoding, so the bytes arrive
    // as they are and nothing here has to unpack them.
    .header("Accept-Language", "en-GB,en;q=0.9")
    .header("Accept-Encoding", "identity")
    .header("Sec-Fetch-Dest", "image")
    .header("Sec-Fetch-Mode", "no-cors")
    .header("Sec-Fetch-Site", "cross-site")
}

async fn read_image(mut response: reqwest::Response) -> Result<(Vec<u8>, String), String> {
  if !response.status().is_success() {
    return Err(format!("the image server answered {}", response.status()));
  }
  if let Some(length) = response.content_length() {
    if length > MAX_BYTES {
      return Err("that image is too large".into());
    }
  }
  let declared = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .map(|v| v.split(';').next().unwrap_or(v).trim().to_lowercase());

  // A page where a picture should be. Servers answer a refused image with one
  // and a 200, and passing it on as bytes left the reader a broken frame and
  // nothing in any log to say why. Say so instead.
  if let Some(kind) = declared.as_deref() {
    if kind.starts_with("text/") {
      return Err(format!("the image server answered with {kind}"));
    }
  }

  // Anything else is taken as sent: a server that mislabels a real image
  // should not cost the reader the image.
  let content_type = declared
    .filter(|v| v.starts_with("image/"))
    .unwrap_or_else(|| "application/octet-stream".to_string());

  // Read chunk by chunk, and stop as soon as the body is too large. A
  // chunked body gives no length before it starts.
  let mut bytes = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(describe)? {
    if bytes.len() as u64 + chunk.len() as u64 > MAX_BYTES {
      return Err("that image is too large".into());
    }
    bytes.extend_from_slice(&chunk);
  }
  Ok((bytes, content_type))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn encode(value: &str) -> String {
    const TABLE: &[u8; 64] =
      b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bytes = value.as_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
      let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
      let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
      for i in 0..4 {
        if i <= chunk.len() {
          out.push(TABLE[((n >> (18 - i * 6)) & 63) as usize] as char);
        }
      }
    }
    out
  }

  #[test]
  fn it_reads_a_remote_address_from_the_path() {
    let url = "https://cdn.example.org/a/b.png?x=1&y=2";
    let path = format!("/{}", encode(url));
    assert_eq!(address_from_path(&path).unwrap(), url);
  }

  #[test]
  fn it_refuses_a_local_address() {
    for host in [
      "http://localhost/a.png",
      "http://127.0.0.1/a.png",
      "http://10.0.0.5/a.png",
      "http://192.168.1.9/a.png",
      "http://172.16.0.1/a.png",
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/x",
    ] {
      let path = format!("/{}", encode(host));
      assert!(
        address_from_path(&path).is_err(),
        "{host} must not be fetched"
      );
    }
  }

  #[test]
  fn it_allows_a_public_address_that_looks_similar() {
    // 172.32 is public, and 10.example.org is a name rather than a network.
    for host in ["http://172.32.0.1/a.png", "https://10.example.org/a.png"] {
      let path = format!("/{}", encode(host));
      assert!(address_from_path(&path).is_ok(), "{host} must be allowed");
    }
  }

  #[test]
  fn it_refuses_other_schemes() {
    for bad in ["file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://x/a"] {
      let path = format!("/{}", encode(bad));
      assert!(address_from_path(&path).is_err(), "{bad} must be refused");
    }
  }

  #[test]
  fn it_refuses_an_empty_or_broken_path() {
    assert!(address_from_path("/").is_err());
    assert!(address_from_path("/not base64!").is_err());
  }

  #[test]
  fn it_refuses_a_local_address_in_any_spelling() {
    for url in [
      "http://[::ffff:127.0.0.1]/a.png",
      "http://[::1]/a.png",
      "http://[fd00::1]/a.png",
      "http://2130706433/a.png",
      "http://0x7f.1/a.png",
      "http://100.64.1.1/a.png",
      "http://printer.local/a.png",
      "http://localhost./a.png",
    ] {
      assert!(check_address(url).is_err(), "{url} must not be fetched");
    }
  }

  /// A server on this computer that answers each path as `answer` says.
  /// Answers the address of the server and a count of its requests.
  fn local_server(
    answer: fn(&str) -> tiny_http::Response<Box<dyn std::io::Read + Send>>,
  ) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr().to_ip().unwrap());
    let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = std::sync::Arc::clone(&count);
    std::thread::spawn(move || {
      for request in server.incoming_requests() {
        seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let response = answer(request.url());
        let _ = request.respond(response);
      }
    });
    (base, count)
  }

  fn redirect(to: &str) -> tiny_http::Response<Box<dyn std::io::Read + Send>> {
    let header = tiny_http::Header::from_bytes("Location", to).unwrap();
    tiny_http::Response::new(tiny_http::StatusCode(302), vec![header], Box::new(std::io::empty()), Some(0), None)
  }

  fn png(body: Box<dyn std::io::Read + Send>, length: Option<usize>) -> tiny_http::Response<Box<dyn std::io::Read + Send>> {
    let header = tiny_http::Header::from_bytes("Content-Type", "image/png").unwrap();
    tiny_http::Response::new(tiny_http::StatusCode(200), vec![header], body, length, None)
  }

  /// The test server is on 127.0.0.1. Allow it, and check all else.
  fn allow_the_test_server(url: &str) -> Result<(), String> {
    if url.starts_with("http://127.0.0.1:") {
      return Ok(());
    }
    check_address(url)
  }

  fn test_fetch(url: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
      .redirect(reqwest::redirect::Policy::none())
      .no_proxy()
      .timeout(Duration::from_secs(10))
      .build()
      .unwrap();
    tauri::async_runtime::block_on(fetch_with(&client, url, allow_the_test_server))
  }

  #[test]
  fn a_redirect_to_a_local_address_is_refused() {
    let (base, _) = local_server(|path| match path {
      "/metadata" => redirect("http://169.254.169.254/latest/meta-data"),
      "/mapped" => redirect("http://[::ffff:10.0.0.1]/a.png"),
      _ => redirect("http://localhost/a.png"),
    });
    for path in ["/metadata", "/mapped", "/name"] {
      let error = test_fetch(&format!("{base}{path}")).unwrap_err();
      assert_eq!(error, crate::image_guard::REFUSED, "{path}");
    }
  }

  #[test]
  fn redirects_are_followed_to_a_limit() {
    let (base, _) = local_server(|path| match path {
      "/one" => redirect("/two"),
      "/two" => redirect("/image.png"),
      "/image.png" => png(Box::new(std::io::Cursor::new(b"\x89PNG".to_vec())), Some(4)),
      // Each step of the loop points one further, with no end.
      other => {
        let n: usize = other.trim_start_matches("/loop").parse().unwrap_or(0);
        redirect(&format!("/loop{}", n + 1))
      }
    });
    let (bytes, kind) = test_fetch(&format!("{base}/one")).unwrap();
    assert_eq!(bytes, b"\x89PNG");
    assert_eq!(kind, "image/png");
    let error = test_fetch(&format!("{base}/loop0")).unwrap_err();
    assert!(error.contains("too many redirects"), "{error}");
  }

  #[test]
  fn a_chunked_body_stops_as_soon_as_it_is_too_large() {
    let (base, _) = local_server(|_| {
      // No length, so the server sends chunks. The body has no end.
      png(Box::new(std::io::repeat(7)), None)
    });
    let error = test_fetch(&format!("{base}/endless.png")).unwrap_err();
    assert!(error.contains("too large"), "{error}");
  }

  #[test]
  fn a_local_address_is_refused_before_a_request_goes_out() {
    let (base, count) = local_server(|_| png(Box::new(std::io::empty()), Some(0)));
    let error = tauri::async_runtime::block_on(fetch(&format!("{base}/a.png"))).unwrap_err();
    assert_eq!(error, crate::image_guard::REFUSED);
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 0);
  }

  /// Asks the real servers. Run by hand: `cargo test -- --ignored live`.
  #[test]
  #[ignore]
  fn live_it_fetches_a_british_airways_image() {
    let url = "https://www.britishairways.com/cms/global/assets/images/email_images/vsg/headerfooter/baBrandingLogo620.gif";
    let (bytes, kind) = tauri::async_runtime::block_on(fetch(url)).expect("the image");
    assert_eq!(kind, "image/gif");
    assert!(bytes.starts_with(b"GIF8"));
  }
}
