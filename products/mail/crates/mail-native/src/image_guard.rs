//! Which addresses the image proxy can reach.
//!
//! A message can name any image address. Without a check, a sender can make
//! the app fetch from the reader's own network: a router page, a printer, or
//! the cloud metadata service. The proxy fetches only from public addresses.
//!
//! Two steps do the check:
//!
//! - `is_public_ip` decides for one address. An IPv6 address that carries an
//!   IPv4 address (for example `::ffff:127.0.0.1`) is checked as that IPv4
//!   address.
//! - `PublicOnlyResolver` resolves a host name for reqwest. It refuses the
//!   name if any of its addresses is not public. reqwest then connects only
//!   to the addresses that this resolver gave. Thus a name cannot change to
//!   a local address between the check and the connection.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

/// The error text for an address that is not public.
pub const REFUSED: &str = "local and private addresses are not fetched";

/// True if the proxy can fetch from this address.
pub fn is_public_ip(ip: IpAddr) -> bool {
  match ip {
    IpAddr::V4(v4) => is_public_v4(v4),
    IpAddr::V6(v6) => is_public_v6(v6),
  }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
  let [a, b, c, _] = ip.octets();
  let refused = ip.is_unspecified()
    || ip.is_loopback()
    || ip.is_private()
    || ip.is_link_local()
    || ip.is_broadcast()
    || ip.is_multicast()
    // "This network", 0.0.0.0/8.
    || a == 0
    // Carrier-grade NAT, 100.64.0.0/10.
    || (a == 100 && (64..=127).contains(&b))
    // Protocol assignments, 192.0.0.0/24.
    || (a == 192 && b == 0 && c == 0)
    // Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24.
    || (a == 192 && b == 0 && c == 2)
    || (a == 198 && b == 51 && c == 100)
    || (a == 203 && b == 0 && c == 113)
    // Benchmark tests, 198.18.0.0/15.
    || (a == 198 && (b == 18 || b == 19))
    // Reserved, 240.0.0.0/4.
    || a >= 240;
  !refused
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
  if let Some(v4) = embedded_v4(ip) {
    return is_public_v4(v4);
  }
  let s = ip.segments();
  let refused = ip.is_unspecified()
    || ip.is_loopback()
    || ip.is_multicast()
    // Unique local, fc00::/7.
    || (s[0] & 0xfe00) == 0xfc00
    // Link local, fe80::/10, and the old site local, fec0::/10.
    || (s[0] & 0xffc0) == 0xfe80
    || (s[0] & 0xffc0) == 0xfec0
    // Documentation, 2001:db8::/32.
    || (s[0] == 0x2001 && s[1] == 0x0db8)
    // Discard only, 100::/64.
    || (s[0] == 0x0100 && s[1] == 0 && s[2] == 0 && s[3] == 0);
  !refused
}

/// The IPv4 address inside an IPv6 address, for the forms that carry one.
fn embedded_v4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
  let s = ip.segments();
  let v4 = |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
  // IPv4-mapped, ::ffff:0:0/96.
  if let Some(mapped) = ip.to_ipv4_mapped() {
    return Some(mapped);
  }
  // IPv4-compatible, ::/96. This includes :: and ::1, which then fail as
  // 0.0.0.0/8.
  if s[..6].iter().all(|x| *x == 0) {
    return Some(v4(s[6], s[7]));
  }
  // NAT64, 64:ff9b::/96.
  if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|x| *x == 0) {
    return Some(v4(s[6], s[7]));
  }
  // 6to4, 2002::/16.
  if s[0] == 0x2002 {
    return Some(v4(s[1], s[2]));
  }
  None
}

/// Ok if each resolved address is public. One local address refuses all:
/// a name that points to both is not an ordinary image host.
pub fn check_resolved(addrs: &[SocketAddr]) -> Result<(), String> {
  if addrs.is_empty() {
    return Err("the image host has no address".into());
  }
  if addrs.iter().all(|a| is_public_ip(a.ip())) {
    Ok(())
  } else {
    Err(REFUSED.into())
  }
}

/// A resolver for reqwest that gives only public addresses.
pub struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
  fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
    let host = name.as_str().to_string();
    Box::pin(async move {
      let addrs: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), 0).to_socket_addrs().map(|found| found.collect::<Vec<_>>())
      })
      .await
      .map_err(|e| std::io::Error::other(e.to_string()))??;
      check_resolved(&addrs).map_err(std::io::Error::other)?;
      let addrs: reqwest::dns::Addrs = Box::new(addrs.into_iter());
      Ok(addrs)
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn public(text: &str) -> bool {
    is_public_ip(text.parse().unwrap())
  }

  #[test]
  fn local_and_private_addresses_are_refused() {
    for ip in [
      "127.0.0.1",
      "127.8.9.10",
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.9",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.254",
      "192.0.0.8",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "240.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
    ] {
      assert!(!public(ip), "{ip} must be refused");
    }
  }

  #[test]
  fn an_ipv6_address_that_carries_a_local_ipv4_address_is_refused() {
    for ip in [
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::127.0.0.1",
      "64:ff9b::a00:1",
      "2002:7f00:1::",
      "2002:c0a8:101::1",
    ] {
      assert!(!public(ip), "{ip} must be refused");
    }
  }

  #[test]
  fn public_addresses_are_allowed() {
    for ip in [
      "93.184.215.14",
      "172.32.0.1",
      "100.128.0.1",
      "8.8.8.8",
      "2606:4700::1111",
      "::ffff:93.184.215.14",
      "64:ff9b::5db8:d70e",
    ] {
      assert!(public(ip), "{ip} must be allowed");
    }
  }

  #[test]
  fn one_local_address_refuses_the_whole_name() {
    let public: SocketAddr = "93.184.215.14:0".parse().unwrap();
    let local: SocketAddr = "10.0.0.1:0".parse().unwrap();
    assert!(check_resolved(&[public]).is_ok());
    assert!(check_resolved(&[public, local]).is_err());
    assert!(check_resolved(&[]).is_err());
  }

  #[test]
  fn the_resolver_refuses_a_name_for_this_computer() {
    use reqwest::dns::Resolve;
    let name: reqwest::dns::Name = "localhost".parse().unwrap();
    let answer = tauri::async_runtime::block_on(PublicOnlyResolver.resolve(name));
    let error = answer.err().expect("localhost is refused").to_string();
    assert!(error.contains(REFUSED) || error.contains("address"), "{error}");
  }
}
