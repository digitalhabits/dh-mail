//! One DNS SRV lookup over UDP, for Autodiscover step d
//! (`ews_autodiscover.rs`). Written here, with no DNS crate: the app needs
//! one record type, once, at connect.
//!
//! The query asks for `SRV` with recursion. The answer's records are read,
//! with name compression. Of the records, the one with the lowest priority
//! wins, and among those the highest weight (RFC 2782 picks by weight at
//! random; one answer is enough here). A truncated answer (`TC`) is taken as
//! it is: no second try over TCP.

use std::net::{SocketAddr, UdpSocket};
use std::time::Duration;

const TYPE_SRV: u16 = 33;
const CLASS_IN: u16 = 1;

/// The query for `name`, with this id.
pub fn query(name: &str, id: u16) -> Vec<u8> {
  let mut q = Vec::with_capacity(64);
  q.extend_from_slice(&id.to_be_bytes());
  // Recursion desired; one question.
  q.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
  for label in name.trim_end_matches('.').split('.') {
    q.push(label.len().min(63) as u8);
    q.extend_from_slice(&label.as_bytes()[..label.len().min(63)]);
  }
  q.push(0);
  q.extend_from_slice(&TYPE_SRV.to_be_bytes());
  q.extend_from_slice(&CLASS_IN.to_be_bytes());
  q
}

fn u16_at(p: &[u8], at: usize) -> Option<u16> {
  Some(u16::from_be_bytes([*p.get(at)?, *p.get(at + 1)?]))
}

/// A name at `at`: its text, and where the bytes after it start.
fn name_at(p: &[u8], mut at: usize) -> Option<(String, usize)> {
  let mut labels = Vec::new();
  let mut end = None;
  for _ in 0..64 {
    let len = *p.get(at)? as usize;
    if len & 0xC0 == 0xC0 {
      end.get_or_insert(at + 2);
      at = (u16_at(p, at)? & 0x3FFF) as usize;
      continue;
    }
    if len == 0 {
      return Some((labels.join("."), end.unwrap_or(at + 1)));
    }
    labels.push(String::from_utf8_lossy(p.get(at + 1..at + 1 + len)?).to_string());
    at += 1 + len;
  }
  None
}

/// The SRV records of an answer to the query `id`: (priority, weight, host).
pub fn read(p: &[u8], id: u16) -> Vec<(u16, u16, String)> {
  let mut out = Vec::new();
  if u16_at(p, 0) != Some(id) || p.get(3).is_none_or(|flags| flags & 0x0F != 0) {
    return out;
  }
  let (Some(questions), Some(answers)) = (u16_at(p, 4), u16_at(p, 6)) else { return out };
  let mut at = 12;
  for _ in 0..questions {
    let Some((_, next)) = name_at(p, at) else { return out };
    at = next + 4;
  }
  for _ in 0..answers {
    let Some((_, next)) = name_at(p, at) else { return out };
    let (Some(kind), Some(len)) = (u16_at(p, next), u16_at(p, next + 8)) else { return out };
    let data = next + 10;
    if kind == TYPE_SRV {
      if let (Some(priority), Some(weight), Some((host, _))) = (u16_at(p, data), u16_at(p, data + 2), name_at(p, data + 6)) {
        if !host.is_empty() {
          out.push((priority, weight, host.to_lowercase()));
        }
      }
    }
    at = data + len as usize;
  }
  out
}

/// The best host for `name`, from the first server that answers.
pub fn lookup(name: &str, servers: &[SocketAddr], timeout: Duration) -> Option<String> {
  let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
  socket.set_read_timeout(Some(timeout)).ok()?;
  let mut id = [0u8; 2];
  getrandom::getrandom(&mut id).ok()?;
  let id = u16::from_be_bytes(id);
  let packet = query(name, id);
  for server in servers {
    if socket.send_to(&packet, server).is_err() {
      continue;
    }
    let mut buf = [0u8; 1500];
    let Ok((len, from)) = socket.recv_from(&mut buf) else { continue };
    if from != *server {
      continue;
    }
    let mut records = read(&buf[..len], id);
    records.sort_by_key(|(priority, weight, _)| (*priority, std::cmp::Reverse(*weight)));
    return records.into_iter().next().map(|(_, _, host)| host);
  }
  None
}
