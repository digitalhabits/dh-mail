//! Remote images in the message view.
//!
//! A message frame runs under `img-src 'self'`, so it cannot load a sender's
//! image directly, and relaxing that would also fail: plenty of senders set
//! Cross-Origin-Resource-Policy, which blocks a cross-origin embed whatever the
//! page allows.
//!
//! The planner solves this with a same-origin proxy route. This build has no
//! server, so native code fetches instead, under a scheme of its own. Nothing
//! in a message can reach it except through a rewritten `img` tag, and every
//! address is checked before a request goes out.
//!
//! Requests carry no cookies and no referrer, so a sender learns nothing beyond
//! the fact that an image was fetched.

use std::time::Duration;

/// `dhmail://localhost/<base64url of the remote address>`
pub const SCHEME: &str = "dhmail";

const MAX_BYTES: u64 = 5 * 1024 * 1024;
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
/// checked.
fn check_address(url: &str) -> Result<(), String> {
  let parsed = url::Url::parse(url).map_err(|_| "not a valid address".to_string())?;
  if parsed.scheme() != "http" && parsed.scheme() != "https" {
    return Err("only http and https images are fetched".into());
  }
  let host = parsed.host_str().unwrap_or("").to_lowercase();
  if host.is_empty() {
    return Err("address has no host".into());
  }

  // url keeps the brackets on a literal IPv6 host.
  let bare = host.trim_start_matches('[').trim_end_matches(']');
  if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
    let refuse = match ip {
      std::net::IpAddr::V4(v4) => {
        let octets = v4.octets();
        v4.is_loopback()
          || v4.is_private()
          || v4.is_link_local()
          || v4.is_unspecified()
          || v4.is_broadcast()
          // Carrier-grade NAT, 100.64.0.0/10.
          || (octets[0] == 100 && (64..=127).contains(&octets[1]))
      }
      std::net::IpAddr::V6(v6) => {
        let first = v6.segments()[0];
        v6.is_loopback()
          || v6.is_unspecified()
          // Unique local, fc00::/7, and link local, fe80::/10.
          || (first & 0xfe00) == 0xfc00
          || (first & 0xffc0) == 0xfe80
      }
    };
    if refuse {
      return Err("local and private addresses are not fetched".into());
    }
    return Ok(());
  }

  // A name. Only the ones that mean this machine, or its cloud metadata.
  if host == "localhost"
    || host.ends_with(".localhost")
    || host == "metadata.google.internal"
    || host.ends_with(".internal")
  {
    return Err("local and private addresses are not fetched".into());
  }
  Ok(())
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
  let client = reqwest::Client::builder()
    .timeout(TIMEOUT)
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
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
    .send()
    .await
    .map_err(|e| e.to_string())?;

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

  let bytes = response.bytes().await.map_err(|e| e.to_string())?;
  if bytes.len() as u64 > MAX_BYTES {
    return Err("that image is too large".into());
  }
  Ok((bytes.to_vec(), content_type))
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
