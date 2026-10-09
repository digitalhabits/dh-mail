//! NTLMv2 messages for HTTP sign-in, as MS-NLMP describes them.
//!
//! Exchange Server on-prem signs in EWS clients with NTLM, and reqwest has
//! no NTLM. The three messages are small, so they are written here with the
//! `md4`, `md-5` and `hmac` crates rather than taken from a crate that
//! brings its own HTTP client.
//!
//! Only what HTTP needs is here: no signing, no sealing, no key exchange,
//! no MIC. The connection is TLS, and the server does not ask for more. The
//! handshake is three steps on one TCP connection:
//!
//! 1. The client sends [`negotiate`].
//! 2. The server answers `401` with a challenge, read by [`Challenge::parse`].
//! 3. The client sends [`authenticate`] with the request body.
//!
//! LM and NTLMv1 are not here. The server gets NTLMv2 or nothing.

use hmac::{Hmac, Mac};
use md4::{Digest, Md4};
use md5::Md5;

type HmacMd5 = Hmac<Md5>;

const SIGNATURE: &[u8; 8] = b"NTLMSSP\0";

const NEGOTIATE_UNICODE: u32 = 0x0000_0001;
const NEGOTIATE_OEM: u32 = 0x0000_0002;
const REQUEST_TARGET: u32 = 0x0000_0004;
const NEGOTIATE_NTLM: u32 = 0x0000_0200;
const NEGOTIATE_ALWAYS_SIGN: u32 = 0x0000_8000;
const NEGOTIATE_EXTENDED_SESSIONSECURITY: u32 = 0x0008_0000;
const NEGOTIATE_TARGET_INFO: u32 = 0x0080_0000;
const NEGOTIATE_128: u32 = 0x2000_0000;
const NEGOTIATE_56: u32 = 0x8000_0000;

/// The flags the client asks for. The answer carries the ones both sides have.
const CLIENT_FLAGS: u32 = NEGOTIATE_UNICODE
  | NEGOTIATE_OEM
  | REQUEST_TARGET
  | NEGOTIATE_NTLM
  | NEGOTIATE_ALWAYS_SIGN
  | NEGOTIATE_EXTENDED_SESSIONSECURITY
  | NEGOTIATE_TARGET_INFO
  | NEGOTIATE_128
  | NEGOTIATE_56;

/// The AV pair that holds the server's clock (MS-NLMP 2.2.2.1).
const AV_TIMESTAMP: u16 = 7;
const AV_EOL: u16 = 0;

/// Seconds from 1601-01-01 (the Windows epoch) to 1970-01-01.
const EPOCH_GAP_SECS: u64 = 11_644_473_600;

/// Message 1: the client says that it wants NTLM. No domain and no
/// workstation: the server does not need them to send a challenge.
pub fn negotiate() -> Vec<u8> {
  let mut out = Vec::with_capacity(32);
  out.extend_from_slice(SIGNATURE);
  out.extend_from_slice(&1u32.to_le_bytes());
  out.extend_from_slice(&CLIENT_FLAGS.to_le_bytes());
  // Domain and workstation: empty security buffers.
  out.extend_from_slice(&[0u8; 16]);
  out
}

/// Message 2, as the server sent it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Challenge {
  pub flags: u32,
  pub server_challenge: [u8; 8],
  pub target_info: Vec<u8>,
}

impl Challenge {
  pub fn parse(bytes: &[u8]) -> Result<Challenge, String> {
    if bytes.len() < 32 || &bytes[0..8] != SIGNATURE {
      return Err("the NTLM challenge has no NTLMSSP signature".into());
    }
    if u32_at(bytes, 8) != 2 {
      return Err("the NTLM message from the server is not a challenge".into());
    }
    let flags = u32_at(bytes, 20);
    let mut server_challenge = [0u8; 8];
    server_challenge.copy_from_slice(&bytes[24..32]);
    // The target info buffer is at 40. A server that sends none is too old
    // for NTLMv2 with a timestamp, but the response works without it.
    let target_info = if bytes.len() >= 48 {
      let len = u16_at(bytes, 40) as usize;
      let offset = u32_at(bytes, 44) as usize;
      if len == 0 {
        Vec::new()
      } else if offset.checked_add(len).map_or(true, |end| end > bytes.len()) {
        return Err("the NTLM challenge has a target info field out of bounds".into());
      } else {
        bytes[offset..offset + len].to_vec()
      }
    } else {
      Vec::new()
    };
    Ok(Challenge { flags, server_challenge, target_info })
  }

  /// The server's clock from the target info, in Windows file time.
  pub fn timestamp(&self) -> Option<u64> {
    let info = &self.target_info;
    let mut at = 0usize;
    while at + 4 <= info.len() {
      let id = u16_at(info, at);
      let len = u16_at(info, at + 2) as usize;
      let value = at + 4;
      if id == AV_EOL || value + len > info.len() {
        return None;
      }
      if id == AV_TIMESTAMP && len == 8 {
        let mut raw = [0u8; 8];
        raw.copy_from_slice(&info[value..value + 8]);
        return Some(u64::from_le_bytes(raw));
      }
      at = value + len;
    }
    None
  }
}

/// Who signs in. `domain` is empty for a user principal name
/// (`name@example.com`), which the server resolves itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
  pub domain: String,
  pub user: String,
}

impl Identity {
  /// Split `DOMAIN\user`. Any other form goes whole into `user`.
  pub fn from_username(username: &str) -> Identity {
    match username.split_once('\\') {
      Some((domain, user)) if !domain.is_empty() && !user.is_empty() => Identity {
        domain: domain.to_string(),
        user: user.to_string(),
      },
      _ => Identity { domain: String::new(), user: username.to_string() },
    }
  }
}

/// The current time in Windows file time: 100 ns steps since 1601.
pub fn now_filetime() -> u64 {
  let unix = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default();
  (unix.as_secs() + EPOCH_GAP_SECS) * 10_000_000 + u64::from(unix.subsec_nanos() / 100)
}

/// Eight random bytes for the client challenge.
pub fn client_challenge() -> Result<[u8; 8], String> {
  let mut out = [0u8; 8];
  getrandom::getrandom(&mut out).map_err(|e| format!("no random bytes for NTLM: {e}"))?;
  Ok(out)
}

/// NTOWFv2: the key made from the password, the user and the domain.
pub fn ntowf_v2(password: &str, identity: &Identity) -> [u8; 16] {
  let nt_hash = Md4::digest(utf16le(password));
  let mut mac = HmacMd5::new_from_slice(&nt_hash).expect("HMAC takes any key length");
  mac.update(&utf16le(&identity.user.to_uppercase()));
  mac.update(&utf16le(&identity.domain));
  mac.finalize().into_bytes().into()
}

/// The NTLMv2 response: NTProofStr, then the blob it signs.
pub fn nt_v2_response(
  key: &[u8; 16],
  server_challenge: &[u8; 8],
  client_challenge: &[u8; 8],
  timestamp: u64,
  target_info: &[u8],
) -> Vec<u8> {
  let mut blob = Vec::with_capacity(28 + target_info.len() + 4);
  blob.extend_from_slice(&[1, 1, 0, 0, 0, 0, 0, 0]);
  blob.extend_from_slice(&timestamp.to_le_bytes());
  blob.extend_from_slice(client_challenge);
  blob.extend_from_slice(&[0u8; 4]);
  blob.extend_from_slice(target_info);
  blob.extend_from_slice(&[0u8; 4]);

  let mut mac = HmacMd5::new_from_slice(key).expect("HMAC takes any key length");
  mac.update(server_challenge);
  mac.update(&blob);
  let proof = mac.finalize().into_bytes();

  let mut out = Vec::with_capacity(16 + blob.len());
  out.extend_from_slice(&proof);
  out.extend_from_slice(&blob);
  out
}

/// The LMv2 response. Sent only when the server gave no timestamp; with a
/// timestamp, MS-NLMP asks for 24 zero bytes in its place.
pub fn lm_v2_response(key: &[u8; 16], server_challenge: &[u8; 8], client_challenge: &[u8; 8]) -> Vec<u8> {
  let mut mac = HmacMd5::new_from_slice(key).expect("HMAC takes any key length");
  mac.update(server_challenge);
  mac.update(client_challenge);
  let mut out = mac.finalize().into_bytes().to_vec();
  out.extend_from_slice(client_challenge);
  out
}

/// Message 3: the answer to the challenge.
///
/// `client_challenge` and `now` are arguments so that tests can fix them.
/// The server's own timestamp, if it sent one, wins over `now`.
pub fn authenticate(
  challenge: &Challenge,
  identity: &Identity,
  password: &str,
  workstation: &str,
  client_challenge: [u8; 8],
  now: u64,
) -> Vec<u8> {
  let key = ntowf_v2(password, identity);
  let server_time = challenge.timestamp();
  let timestamp = server_time.unwrap_or(now);
  let nt = nt_v2_response(&key, &challenge.server_challenge, &client_challenge, timestamp, &challenge.target_info);
  let lm = if server_time.is_some() {
    vec![0u8; 24]
  } else {
    lm_v2_response(&key, &challenge.server_challenge, &client_challenge)
  };

  let domain = utf16le(&identity.domain);
  let user = utf16le(&identity.user);
  let host = utf16le(workstation);

  // Keep what both sides have, and always Unicode: every server that
  // speaks NTLMv2 reads it.
  let flags = (CLIENT_FLAGS & challenge.flags & !NEGOTIATE_OEM) | NEGOTIATE_UNICODE;

  // Header: signature, type, six security buffers, flags. No version, no MIC.
  const HEADER: usize = 64;
  let mut payload: Vec<u8> = Vec::new();
  let mut buffers: Vec<(u16, u32)> = Vec::new();
  for field in [&lm, &nt, &domain, &user, &host, &Vec::new()] {
    buffers.push((field.len() as u16, (HEADER + payload.len()) as u32));
    payload.extend_from_slice(field);
  }

  let mut out = Vec::with_capacity(HEADER + payload.len());
  out.extend_from_slice(SIGNATURE);
  out.extend_from_slice(&3u32.to_le_bytes());
  for (len, offset) in buffers {
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
  }
  out.extend_from_slice(&flags.to_le_bytes());
  debug_assert_eq!(out.len(), HEADER);
  out.extend_from_slice(&payload);
  out
}

fn utf16le(text: &str) -> Vec<u8> {
  text.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect()
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
  u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
  u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

#[cfg(test)]
mod tests {
  use super::*;

  fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
  }

  // The NTLMv2 example in MS-NLMP 4.2.4: user "User", domain "Domain",
  // password "Password", and the fixed challenges and target info there.
  const SERVER_CHALLENGE: [u8; 8] = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
  const CLIENT_CHALLENGE: [u8; 8] = [0xaa; 8];

  fn spec_identity() -> Identity {
    Identity { domain: "Domain".into(), user: "User".into() }
  }

  fn spec_target_info() -> Vec<u8> {
    let mut info = Vec::new();
    for (id, value) in [(2u16, "Domain"), (1u16, "Server")] {
      let text = utf16le(value);
      info.extend_from_slice(&id.to_le_bytes());
      info.extend_from_slice(&(text.len() as u16).to_le_bytes());
      info.extend_from_slice(&text);
    }
    info.extend_from_slice(&[0u8; 4]);
    info
  }

  #[test]
  fn ntowf_v2_matches_the_spec() {
    assert_eq!(hex(&ntowf_v2("Password", &spec_identity())), "0c868a403bfd7a93a3001ef22ef02e3f");
  }

  #[test]
  fn lm_v2_matches_the_spec() {
    let key = ntowf_v2("Password", &spec_identity());
    assert_eq!(
      hex(&lm_v2_response(&key, &SERVER_CHALLENGE, &CLIENT_CHALLENGE)),
      "86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa"
    );
  }

  #[test]
  fn nt_proof_matches_the_spec() {
    let key = ntowf_v2("Password", &spec_identity());
    let response = nt_v2_response(&key, &SERVER_CHALLENGE, &CLIENT_CHALLENGE, 0, &spec_target_info());
    assert_eq!(hex(&response[..16]), "68cd0ab851e51c96aabc927bebef6a1c");
  }

  fn challenge_message(target_info: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(SIGNATURE);
    out.extend_from_slice(&2u32.to_le_bytes());
    // Target name: empty.
    out.extend_from_slice(&[0, 0, 0, 0, 48, 0, 0, 0]);
    out.extend_from_slice(&(CLIENT_FLAGS & !NEGOTIATE_OEM).to_le_bytes());
    out.extend_from_slice(&SERVER_CHALLENGE);
    out.extend_from_slice(&[0u8; 8]);
    out.extend_from_slice(&(target_info.len() as u16).to_le_bytes());
    out.extend_from_slice(&(target_info.len() as u16).to_le_bytes());
    out.extend_from_slice(&48u32.to_le_bytes());
    out.extend_from_slice(target_info);
    out
  }

  #[test]
  fn parses_a_challenge() {
    let info = spec_target_info();
    let parsed = Challenge::parse(&challenge_message(&info)).unwrap();
    assert_eq!(parsed.server_challenge, SERVER_CHALLENGE);
    assert_eq!(parsed.target_info, info);
    assert_eq!(parsed.timestamp(), None);
  }

  #[test]
  fn refuses_a_message_that_is_not_a_challenge() {
    assert!(Challenge::parse(&negotiate()).is_err());
    assert!(Challenge::parse(b"not ntlm at all, not at all, no.").is_err());
    let mut bad = challenge_message(&spec_target_info());
    // Target info length far past the end.
    bad[40] = 0xff;
    bad[41] = 0xff;
    assert!(Challenge::parse(&bad).is_err());
  }

  #[test]
  fn reads_the_server_timestamp() {
    let mut info = Vec::new();
    info.extend_from_slice(&7u16.to_le_bytes());
    info.extend_from_slice(&8u16.to_le_bytes());
    info.extend_from_slice(&0x01d9_0000_0000_0000u64.to_le_bytes());
    info.extend_from_slice(&[0u8; 4]);
    let parsed = Challenge::parse(&challenge_message(&info)).unwrap();
    assert_eq!(parsed.timestamp(), Some(0x01d9_0000_0000_0000));
  }

  #[test]
  fn authenticate_lays_out_the_buffers() {
    let challenge = Challenge::parse(&challenge_message(&spec_target_info())).unwrap();
    let message = authenticate(&challenge, &spec_identity(), "Password", "HOST", CLIENT_CHALLENGE, 0);
    assert_eq!(&message[0..8], SIGNATURE);
    assert_eq!(u32_at(&message, 8), 3);
    let field = |index: usize| {
      let at = 12 + index * 8;
      let len = u16_at(&message, at) as usize;
      let offset = u32_at(&message, at + 4) as usize;
      message[offset..offset + len].to_vec()
    };
    // No server timestamp, so LMv2 goes in.
    assert_eq!(hex(&field(0)), "86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa");
    assert_eq!(hex(&field(1)[..16]), "68cd0ab851e51c96aabc927bebef6a1c");
    assert_eq!(field(2), utf16le("Domain"));
    assert_eq!(field(3), utf16le("User"));
    assert_eq!(field(4), utf16le("HOST"));
    assert!(field(5).is_empty());
    assert_ne!(u32_at(&message, 60) & NEGOTIATE_UNICODE, 0);
    assert_eq!(u32_at(&message, 60) & NEGOTIATE_OEM, 0);
  }

  #[test]
  fn sends_zero_lm_when_the_server_has_a_clock() {
    let mut info = Vec::new();
    info.extend_from_slice(&7u16.to_le_bytes());
    info.extend_from_slice(&8u16.to_le_bytes());
    info.extend_from_slice(&42u64.to_le_bytes());
    info.extend_from_slice(&[0u8; 4]);
    let challenge = Challenge::parse(&challenge_message(&info)).unwrap();
    let message = authenticate(&challenge, &spec_identity(), "Password", "", CLIENT_CHALLENGE, 0);
    let lm_len = u16_at(&message, 12) as usize;
    let lm_offset = u32_at(&message, 16) as usize;
    assert_eq!(&message[lm_offset..lm_offset + lm_len], &[0u8; 24]);
    // The blob carries the server's time, not ours.
    let nt_offset = u32_at(&message, 24) as usize;
    assert_eq!(&message[nt_offset + 24..nt_offset + 32], &42u64.to_le_bytes());
  }

  #[test]
  fn splits_the_username() {
    assert_eq!(
      Identity::from_username("CORP\\someone"),
      Identity { domain: "CORP".into(), user: "someone".into() }
    );
    assert_eq!(
      Identity::from_username("someone@example.com"),
      Identity { domain: String::new(), user: "someone@example.com".into() }
    );
    assert_eq!(
      Identity::from_username("\\someone"),
      Identity { domain: String::new(), user: "\\someone".into() }
    );
  }

  #[test]
  fn now_is_after_2020() {
    // 2020-01-01 in file time.
    assert!(now_filetime() > 132_223_104_000_000_000);
  }
}
