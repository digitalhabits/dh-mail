//! An IMAP client for one mailbox at a time, on a plain socket over TLS.
//!
//! Gmail charges every API call against a budget that ran out. IMAP has no
//! budget, and Google extends it with what a Gmail client needs: a thread id
//! and a stable message id per message, the labels on each, and All Mail,
//! which holds every message once. This client speaks that dialect and no
//! more: sign in with the OAuth token, select, fetch, store, search, idle.
//!
//! Written here rather than taken from a crate because the crates parse a
//! fixed set of FETCH attributes and refuse Gmail's. The parser below reads
//! any attribute into a small tree, and the sync worker picks what it
//! needs. It runs on a worker thread and blocks; there is nothing to gain
//! from async on one connection.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;

mod text;

pub use text::{
  clean_address, decode_charset, decode_encoded_words, decode_modified_utf7, encode_modified_utf7, header,
  parse_address_list, parse_headers, parse_internal_date, qp_decode, snippet_from_body, Mailbox,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum ImapError {
  Io(io::Error),
  Tls(String),
  /// The server answered NO or BAD to a command.
  Refused { command: String, text: String },
  /// A reply that could not be read as IMAP.
  Protocol(String),
  /// The connection was dropped by the server.
  Closed,
}

impl std::fmt::Display for ImapError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      ImapError::Io(_) if self.is_timeout() => {
        // No number: the wait differs by call (connect, read, write, SMTP),
        // and "300 seconds" was printed for all of them.
        write!(f, "the server did not answer in time")
      }
      ImapError::Io(e) => write!(f, "connection: {e}"),
      ImapError::Tls(e) => write!(f, "tls: {e}"),
      ImapError::Refused { command, text } => write!(f, "{command} refused: {text}"),
      ImapError::Protocol(e) => write!(f, "protocol: {e}"),
      ImapError::Closed => write!(f, "the server closed the connection"),
    }
  }
}

impl std::error::Error for ImapError {}

impl From<io::Error> for ImapError {
  fn from(e: io::Error) -> Self {
    ImapError::Io(e)
  }
}

impl ImapError {
  /// A timeout on the socket, which IDLE uses as its clock.
  pub fn is_timeout(&self) -> bool {
    matches!(self, ImapError::Io(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut))
  }
}

pub type ImapResult<T> = Result<T, ImapError>;

// ---------------------------------------------------------------------------
// The wire: one stream, TLS or plain
// ---------------------------------------------------------------------------

pub(crate) enum Stream {
  Tls(rustls::StreamOwned<rustls::ClientConnection, TcpStream>),
  Plain(TcpStream),
}

impl Read for Stream {
  fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
    match self {
      Stream::Tls(s) => s.read(buf),
      Stream::Plain(s) => s.read(buf),
    }
  }
}

impl Write for Stream {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    match self {
      Stream::Tls(s) => s.write(buf),
      Stream::Plain(s) => s.write(buf),
    }
  }
  fn flush(&mut self) -> io::Result<()> {
    match self {
      Stream::Tls(s) => s.flush(),
      Stream::Plain(s) => s.flush(),
    }
  }
}

impl Stream {
  fn socket(&self) -> &TcpStream {
    match self {
      Stream::Tls(s) => s.get_ref(),
      Stream::Plain(s) => s,
    }
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/// One token of a response line, literals included.
#[derive(Debug, Clone, PartialEq)]
pub enum Token {
  Atom(String),
  Quoted(String),
  Literal(Vec<u8>),
  Number(u64),
  Nil,
  ListOpen,
  ListClose,
  BracketOpen,
  BracketClose,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
  Ok,
  No,
  Bad,
}

#[derive(Debug, Clone)]
pub enum Response {
  /// `* ...`
  Untagged(Vec<Token>),
  /// `A1 OK ...`
  Tagged { tag: String, status: Status, text: String },
  /// `+ ...`
  Continuation(String),
}

fn tokenize(bytes: &[u8]) -> Result<Vec<Token>, String> {
  let mut out = Vec::new();
  let mut i = 0;
  while i < bytes.len() {
    let c = bytes[i];
    match c {
      b' ' | b'\r' | b'\n' | b'\t' => i += 1,
      b'(' => {
        out.push(Token::ListOpen);
        i += 1;
      }
      b')' => {
        out.push(Token::ListClose);
        i += 1;
      }
      b'[' => {
        out.push(Token::BracketOpen);
        i += 1;
      }
      b']' => {
        out.push(Token::BracketClose);
        i += 1;
      }
      b'"' => {
        let mut s = Vec::new();
        i += 1;
        while i < bytes.len() && bytes[i] != b'"' {
          if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 1;
          }
          s.push(bytes[i]);
          i += 1;
        }
        i += 1;
        out.push(Token::Quoted(String::from_utf8_lossy(&s).into_owned()));
      }
      b'{' => {
        let close = bytes[i..]
          .iter()
          .position(|&b| b == b'}')
          .ok_or("unterminated literal size")?
          + i;
        let n: usize = std::str::from_utf8(&bytes[i + 1..close])
          .ok()
          .and_then(|s| s.parse().ok())
          .ok_or("bad literal size")?;
        let mut start = close + 1;
        if bytes.get(start) == Some(&b'\r') {
          start += 1;
        }
        if bytes.get(start) == Some(&b'\n') {
          start += 1;
        }
        let end = start + n;
        if end > bytes.len() {
          return Err("literal runs past the response".into());
        }
        out.push(Token::Literal(bytes[start..end].to_vec()));
        i = end;
      }
      _ => {
        let start = i;
        while i < bytes.len() && !matches!(bytes[i], b' ' | b'(' | b')' | b'[' | b']' | b'"' | b'{' | b'\r' | b'\n') {
          i += 1;
        }
        let word = String::from_utf8_lossy(&bytes[start..i]).into_owned();
        if word.eq_ignore_ascii_case("NIL") {
          out.push(Token::Nil);
        } else if let Ok(n) = word.parse::<u64>() {
          out.push(Token::Number(n));
        } else {
          out.push(Token::Atom(word));
        }
      }
    }
  }
  Ok(out)
}

fn parse_response(bytes: &[u8]) -> Result<Response, String> {
  let line = String::from_utf8_lossy(bytes);
  if let Some(rest) = line.strip_prefix("+ ").or_else(|| line.strip_prefix("+")) {
    return Ok(Response::Continuation(rest.trim().to_string()));
  }
  if bytes.starts_with(b"* ") {
    return Ok(Response::Untagged(tokenize(&bytes[2..])?));
  }
  let mut parts = line.splitn(3, ' ');
  let tag = parts.next().unwrap_or("").trim().to_string();
  let status = match parts.next().map(|s| s.trim().to_ascii_uppercase()) {
    Some(s) if s == "OK" => Status::Ok,
    Some(s) if s == "NO" => Status::No,
    Some(s) if s == "BAD" => Status::Bad,
    other => return Err(format!("unreadable reply: {:?}", other.unwrap_or_default())),
  };
  let text = parts.next().unwrap_or("").trim().to_string();
  Ok(Response::Tagged { tag, status, text })
}

// ---------------------------------------------------------------------------
// FETCH attributes, read into a small tree
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
  Num(u64),
  Str(String),
  Bytes(Vec<u8>),
  List(Vec<Item>),
  Nil,
}

impl Item {
  pub fn as_u64(&self) -> Option<u64> {
    match self {
      Item::Num(n) => Some(*n),
      Item::Str(s) => s.parse().ok(),
      Item::List(items) if items.len() == 1 => items[0].as_u64(),
      _ => None,
    }
  }
  pub fn as_str(&self) -> Option<String> {
    match self {
      Item::Str(s) => Some(s.clone()),
      Item::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
      Item::Num(n) => Some(n.to_string()),
      _ => None,
    }
  }
  pub fn as_bytes(&self) -> Option<Vec<u8>> {
    match self {
      Item::Bytes(b) => Some(b.clone()),
      Item::Str(s) => Some(s.as_bytes().to_vec()),
      _ => None,
    }
  }
  pub fn as_list(&self) -> Vec<Item> {
    match self {
      Item::List(items) => items.clone(),
      Item::Nil => Vec::new(),
      other => vec![other.clone()],
    }
  }
}

/// One message's FETCH reply: `seq` and the attributes by name, upper-cased.
/// A BODY section keeps its section in the name, e.g. `BODY[HEADER.FIELDS (FROM TO)]`.
#[derive(Debug, Clone, Default)]
pub struct Fetched {
  pub seq: u32,
  pub attributes: Vec<(String, Item)>,
}

impl Fetched {
  pub fn get(&self, name: &str) -> Option<&Item> {
    let wanted = name.to_ascii_uppercase();
    self.attributes.iter().find(|(k, _)| *k == wanted).map(|(_, v)| v)
  }
  /// A BODY section by prefix, whatever the exact field list.
  pub fn body_section(&self, prefix: &str) -> Option<&Item> {
    let wanted = prefix.to_ascii_uppercase();
    self
      .attributes
      .iter()
      .find(|(k, _)| k.starts_with(&wanted))
      .map(|(_, v)| v)
  }
  pub fn uid(&self) -> Option<u32> {
    self.get("UID").and_then(Item::as_u64).map(|n| n as u32)
  }
  pub fn flags(&self) -> Vec<String> {
    self
      .get("FLAGS")
      .map(|f| f.as_list().iter().filter_map(Item::as_str).collect())
      .unwrap_or_default()
  }
}

fn parse_item(tokens: &[Token], pos: &mut usize) -> Result<Item, String> {
  let Some(tok) = tokens.get(*pos) else {
    return Err("attribute value missing".into());
  };
  *pos += 1;
  Ok(match tok {
    Token::Number(n) => Item::Num(*n),
    Token::Atom(a) => Item::Str(a.clone()),
    Token::Quoted(q) => Item::Str(q.clone()),
    Token::Literal(b) => Item::Bytes(b.clone()),
    Token::Nil => Item::Nil,
    Token::ListOpen => {
      let mut items = Vec::new();
      while tokens.get(*pos) != Some(&Token::ListClose) {
        if *pos >= tokens.len() {
          return Err("unterminated list".into());
        }
        items.push(parse_item(tokens, pos)?);
      }
      *pos += 1;
      Item::List(items)
    }
    Token::ListClose | Token::BracketOpen | Token::BracketClose => {
      return Err(format!("unexpected {tok:?}"));
    }
  })
}

/// `* 12 FETCH (...)` → the attributes. None for other untagged replies.
fn parse_fetch(tokens: &[Token]) -> Result<Option<Fetched>, String> {
  let (Some(Token::Number(seq)), Some(Token::Atom(kind))) = (tokens.first(), tokens.get(1)) else {
    return Ok(None);
  };
  if !kind.eq_ignore_ascii_case("FETCH") {
    return Ok(None);
  }
  let mut pos = 2;
  if tokens.get(pos) != Some(&Token::ListOpen) {
    return Err("FETCH without a list".into());
  }
  pos += 1;
  let mut out = Fetched { seq: *seq as u32, attributes: Vec::new() };
  while tokens.get(pos) != Some(&Token::ListClose) {
    let Some(Token::Atom(name)) = tokens.get(pos) else {
      return Err(format!("attribute name expected at {pos}"));
    };
    let mut name = name.to_ascii_uppercase();
    pos += 1;
    // BODY[section]<origin> keeps the section in its name.
    if tokens.get(pos) == Some(&Token::BracketOpen) {
      let mut section = String::new();
      pos += 1;
      let mut depth = 0;
      while let Some(t) = tokens.get(pos) {
        match t {
          Token::BracketClose if depth == 0 => break,
          Token::ListOpen => {
            depth += 1;
            section.push('(');
          }
          Token::ListClose => {
            depth -= 1;
            section = section.trim_end().to_string();
            section.push(')');
          }
          Token::Atom(a) => {
            if !section.is_empty() && !section.ends_with('(') {
              section.push(' ');
            }
            section.push_str(&a.to_ascii_uppercase());
          }
          Token::Quoted(q) => {
            if !section.is_empty() && !section.ends_with('(') {
              section.push(' ');
            }
            section.push_str(&q.to_ascii_uppercase());
          }
          Token::Number(n) => {
            if !section.is_empty() && !section.ends_with('(') {
              section.push(' ');
            }
            section.push_str(&n.to_string());
          }
          _ => {}
        }
        pos += 1;
      }
      pos += 1;
      name = format!("{name}[{section}]");
      // An origin octet: BODY[TEXT]<0>
      if let Some(Token::Atom(a)) = tokens.get(pos) {
        if a.starts_with('<') {
          pos += 1;
        }
      }
    }
    let value = parse_item(tokens, &mut pos)?;
    out.attributes.push((name, value));
  }
  Ok(Some(out))
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/// What SELECT said about the mailbox.
#[derive(Debug, Clone, Default)]
pub struct SelectInfo {
  pub exists: u32,
  pub uid_validity: Option<u32>,
  pub uid_next: Option<u32>,
  pub highest_modseq: Option<u64>,
}

/// A mailbox as LIST names it, with its special-use attributes.
#[derive(Debug, Clone)]
pub struct MailboxName {
  /// Decoded from modified UTF-7.
  pub name: String,
  /// As the server wrote it, for SELECT.
  pub raw: String,
  pub attributes: Vec<String>,
}

/// What ended an IDLE.
#[derive(Debug, Clone, PartialEq)]
pub enum IdleEvent {
  Exists(u32),
  Expunge(u32),
  Fetch(u32),
  Timeout,
}

/// How often an IDLE that can be woken looks at its wake flag.
const IDLE_SLICE: Duration = Duration::from_millis(500);

/// How long a read waits for the server outside IDLE. Gmail slows a big
/// fetch down when a mailbox is being read in full, so this is generous.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

pub struct Client {
  stream: BufReader<Stream>,
  next_tag: u32,
  /// Untagged EXISTS/EXPUNGE seen outside IDLE, for the worker to notice.
  pub pending: Vec<IdleEvent>,
}

impl Client {
  /// Open a TLS connection to `host:port` and read the greeting.
  pub fn connect(host: &str, port: u16, timeout: Duration) -> ImapResult<Client> {
    Self::from_stream(tls_connect(host, port, timeout)?)
  }

  /// A plain connection, for a server on the same machine: tests.
  pub fn connect_plain(tcp: TcpStream) -> ImapResult<Client> {
    tcp.set_read_timeout(Some(DEFAULT_TIMEOUT))?;
    Self::from_stream(Stream::Plain(tcp))
  }

  fn from_stream(stream: Stream) -> ImapResult<Client> {
    let mut client = Client { stream: BufReader::new(stream), next_tag: 1, pending: Vec::new() };
    match client.read_response()? {
      Response::Untagged(tokens) if matches!(tokens.first(), Some(Token::Atom(a)) if a.eq_ignore_ascii_case("OK") || a.eq_ignore_ascii_case("PREAUTH")) => {}
      other => return Err(ImapError::Protocol(format!("no greeting: {other:?}"))),
    }
    Ok(client)
  }

  pub(crate) fn set_read_timeout(&mut self, timeout: Duration) -> ImapResult<()> {
    self.stream.get_ref().socket().set_read_timeout(Some(timeout))?;
    Ok(())
  }

  fn send_line(&mut self, line: &str) -> ImapResult<()> {
    let stream = self.stream.get_mut();
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\r\n")?;
    stream.flush()?;
    Ok(())
  }

  fn send_command(&mut self, command: &str) -> ImapResult<String> {
    let tag = format!("A{}", self.next_tag);
    self.next_tag += 1;
    self.send_line(&format!("{tag} {command}"))?;
    Ok(tag)
  }

  /// One response, literals and all.
  fn read_response(&mut self) -> ImapResult<Response> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
      let mut line = Vec::new();
      let n = self.stream.read_until(b'\n', &mut line)?;
      if n == 0 {
        return Err(ImapError::Closed);
      }
      buf.extend_from_slice(&line);
      // A line ending in {n} announces n more bytes, then the line goes on.
      let trimmed = strip_crlf(&line);
      if let Some(size) = literal_size(trimmed) {
        let mut literal = vec![0u8; size];
        self.stream.read_exact(&mut literal)?;
        buf.extend_from_slice(&literal);
        continue;
      }
      break;
    }
    parse_response(&buf).map_err(ImapError::Protocol)
  }

  /// Send a command and collect every untagged reply up to its tagged end.
  fn run(&mut self, command: &str) -> ImapResult<Vec<Vec<Token>>> {
    let tag = self.send_command(command)?;
    self.finish(&tag, command)
  }

  /// Every untagged reply up to the tagged end of the command sent as `tag`.
  fn finish(&mut self, tag: &str, command: &str) -> ImapResult<Vec<Vec<Token>>> {
    let mut untagged = Vec::new();
    loop {
      match self.read_response()? {
        Response::Untagged(tokens) => untagged.push(tokens),
        Response::Continuation(_) => {
          // Nothing here asks a question; answer an unexpected one with nothing.
          self.send_line("")?;
        }
        Response::Tagged { tag: got, status, text } => {
          if got != tag {
            continue;
          }
          if status != Status::Ok {
            let name = command.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
            return Err(ImapError::Refused { command: name, text });
          }
          break;
        }
      }
    }
    self.note_events(&untagged);
    Ok(untagged)
  }

  fn note_events(&mut self, untagged: &[Vec<Token>]) {
    for tokens in untagged {
      if let Some(event) = untagged_event(tokens) {
        if event != IdleEvent::Timeout && !matches!(event, IdleEvent::Fetch(_)) {
          self.pending.push(event);
        }
      }
    }
  }

  /// Sign in as the mailbox's credential says: a Google access token, or
  /// an app password.
  pub fn sign_in(&mut self, user: &str, credential: &Credential) -> ImapResult<()> {
    match credential {
      Credential::OAuth(token) => self.authenticate_xoauth2(user, token),
      Credential::Password(password) => self.authenticate_plain(user, password),
    }
  }

  /// SASL PLAIN with a password: for a Gmail app password, which Gmail
  /// takes over IMAP with no Google sign-in. Base64 in one line, so a
  /// password with quotes or spaces needs no IMAP quoting.
  pub fn authenticate_plain(&mut self, user: &str, password: &str) -> ImapResult<()> {
    let raw = format!("\u{0}{user}\u{0}{password}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
    let tag = self.send_command(&format!("AUTHENTICATE PLAIN {encoded}"))?;
    self.finish_authenticate(&tag)
  }

  /// SASL XOAUTH2 with an access token from the mailbox's OAuth grant.
  pub fn authenticate_xoauth2(&mut self, user: &str, access_token: &str) -> ImapResult<()> {
    let raw = format!("user={user}\u{1}auth=Bearer {access_token}\u{1}\u{1}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
    let tag = self.send_command(&format!("AUTHENTICATE XOAUTH2 {encoded}"))?;
    self.finish_authenticate(&tag)
  }

  /// The server's answer to AUTHENTICATE: OK, or its reason for no.
  fn finish_authenticate(&mut self, tag: &str) -> ImapResult<()> {
    let mut failure: Option<String> = None;
    loop {
      match self.read_response()? {
        Response::Continuation(text) => {
          // The server explains the refusal in a base64 JSON body, and
          // waits for an empty line before it says NO.
          let decoded = base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or(text);
          failure = Some(decoded);
          self.send_line("")?;
        }
        Response::Untagged(_) => {}
        Response::Tagged { tag: got, status, text } => {
          if got != tag {
            continue;
          }
          if status == Status::Ok {
            return Ok(());
          }
          return Err(ImapError::Refused {
            command: "AUTHENTICATE".into(),
            text: failure.map(|f| format!("{text} ({f})")).unwrap_or(text),
          });
        }
      }
    }
  }

  /// Every mailbox, with special-use attributes so All Mail can be found
  /// whatever the account's language calls it.
  pub fn list(&mut self) -> ImapResult<Vec<MailboxName>> {
    let replies = self.run("LIST \"\" \"*\"")?;
    let mut out = Vec::new();
    for tokens in replies {
      let Some(Token::Atom(kind)) = tokens.first() else { continue };
      if !kind.eq_ignore_ascii_case("LIST") {
        continue;
      }
      // LIST (\HasNoChildren \All) "/" "[Gmail]/All Mail"
      let mut pos = 1;
      let attributes = match parse_item(&tokens, &mut pos) {
        Ok(item) => item.as_list().iter().filter_map(Item::as_str).collect(),
        Err(_) => Vec::new(),
      };
      let _delimiter = parse_item(&tokens, &mut pos).ok();
      let raw = parse_item(&tokens, &mut pos).ok().and_then(|i| i.as_str()).unwrap_or_default();
      out.push(MailboxName { name: decode_modified_utf7(&raw), raw, attributes });
    }
    Ok(out)
  }

  /// SELECT with CONDSTORE, so the reply carries HIGHESTMODSEQ.
  pub fn select(&mut self, mailbox_raw: &str) -> ImapResult<SelectInfo> {
    let replies = self.run(&format!("SELECT {} (CONDSTORE)", quote(mailbox_raw)))?;
    let mut info = SelectInfo::default();
    for tokens in replies {
      match (tokens.first(), tokens.get(1)) {
        (Some(Token::Number(n)), Some(Token::Atom(a))) if a.eq_ignore_ascii_case("EXISTS") => {
          info.exists = *n as u32;
        }
        (Some(Token::Atom(ok)), Some(Token::BracketOpen)) if ok.eq_ignore_ascii_case("OK") => {
          if let (Some(Token::Atom(code)), Some(Token::Number(n))) = (tokens.get(2), tokens.get(3)) {
            match code.to_ascii_uppercase().as_str() {
              "UIDVALIDITY" => info.uid_validity = Some(*n as u32),
              "UIDNEXT" => info.uid_next = Some(*n as u32),
              "HIGHESTMODSEQ" => info.highest_modseq = Some(*n),
              _ => {}
            }
          }
        }
        _ => {}
      }
    }
    // SELECT's own EXISTS is the count, not news.
    self.pending.clear();
    Ok(info)
  }

  /// UIDs matching an IMAP search, ascending.
  pub fn uid_search(&mut self, query: &str) -> ImapResult<Vec<u32>> {
    let replies = self.run(&format!("UID SEARCH {query}"))?;
    Ok(search_uids(replies))
  }

  /// UID SEARCH on one key whose value is free text, such as `X-GM-RAW`.
  ///
  /// Plain ASCII goes as a quoted string. Other text goes as a literal
  /// with `CHARSET UTF-8`, because a quoted string can hold only 7-bit
  /// text: the client sends the size, waits for the server's go-ahead,
  /// then sends the bytes. Line breaks become spaces, since neither form
  /// can hold one.
  pub fn uid_search_text(&mut self, key: &str, text: &str) -> ImapResult<Vec<u32>> {
    let text = text.replace(['\r', '\n'], " ");
    if text.is_ascii() {
      return self.uid_search(&format!("{key} {}", quote(&text)));
    }
    let command = format!("UID SEARCH CHARSET UTF-8 {key} {{{}}}", text.len());
    let tag = self.send_command(&command)?;
    match self.read_response()? {
      Response::Continuation(_) => {}
      Response::Tagged { status, text, .. } if status != Status::Ok => {
        return Err(ImapError::Refused { command: "UID SEARCH".into(), text });
      }
      other => return Err(ImapError::Protocol(format!("UID SEARCH answered {other:?}"))),
    }
    self.send_line(&text)?;
    Ok(search_uids(self.finish(&tag, &command)?))
  }

  /// UID FETCH of `items` for `set`, optionally only what changed since a
  /// modseq. Each message's attributes come back as read.
  pub fn uid_fetch(&mut self, set: &str, items: &str, changed_since: Option<u64>) -> ImapResult<Vec<Fetched>> {
    let command = match changed_since {
      Some(modseq) => format!("UID FETCH {set} ({items}) (CHANGEDSINCE {modseq})"),
      None => format!("UID FETCH {set} ({items})"),
    };
    let replies = self.run(&command)?;
    let mut out = Vec::new();
    for tokens in replies {
      if let Some(fetched) = parse_fetch(&tokens).map_err(ImapError::Protocol)? {
        out.push(fetched);
      }
    }
    Ok(out)
  }

  /// UID STORE, e.g. `+FLAGS.SILENT (\Seen)` or `+X-GM-LABELS ("\\Starred")`.
  pub fn uid_store(&mut self, set: &str, item: &str, value: &str) -> ImapResult<()> {
    self.run(&format!("UID STORE {set} {item} {value}"))?;
    Ok(())
  }

  /// UID MOVE to another mailbox. Gmail supports MOVE; it is how a message
  /// goes to Trash or comes back.
  pub fn uid_move(&mut self, set: &str, mailbox_raw: &str) -> ImapResult<()> {
    self.run(&format!("UID MOVE {set} {}", quote(mailbox_raw)))?;
    Ok(())
  }

  /// EXPUNGE: messages flagged \Deleted in the selected mailbox, gone.
  pub fn expunge(&mut self) -> ImapResult<()> {
    self.run("EXPUNGE")?;
    Ok(())
  }

  /// UID EXPUNGE (RFC 4315): these messages only, of those flagged \Deleted.
  /// Gmail has UIDPLUS.
  pub fn uid_expunge(&mut self, set: &str) -> ImapResult<()> {
    self.run(&format!("UID EXPUNGE {set}"))?;
    Ok(())
  }

  /// CREATE a mailbox — on Gmail, a label.
  pub fn create(&mut self, mailbox_raw: &str) -> ImapResult<()> {
    self.run(&format!("CREATE {}", quote(mailbox_raw)))?;
    Ok(())
  }

  /// Ask the server what changed, without waiting.
  pub fn noop(&mut self) -> ImapResult<Vec<IdleEvent>> {
    self.run("NOOP")?;
    Ok(std::mem::take(&mut self.pending))
  }

  /// Wait up to `wait` for the server to speak first.
  pub fn idle(&mut self, wait: Duration) -> ImapResult<IdleEvent> {
    self.idle_until(wait, None)
  }

  /*
    The same wait, which also ends when `wake` is set: the reader archived
    or moved something, and it should go to the server now, not at the end
    of the wait. It went at the end: the flag was set and nothing looked at
    it, so an archive could sit in the queue for a minute while other
    clients — and a list read from Gmail — still had the thread in the
    inbox, and quick archives came back into the list and went out again.

    The socket is looked at in short slices. A slice only peeks
    (`fill_buf` consumes nothing), so one that runs out cannot cut a line
    in two; a reply that has begun is read whole, with the usual timeout.
  */
  pub fn idle_until(&mut self, wait: Duration, wake: Option<&AtomicBool>) -> ImapResult<IdleEvent> {
    let tag = self.send_command("IDLE")?;
    match self.read_response()? {
      Response::Continuation(_) => {}
      Response::Tagged { status, text, .. } if status != Status::Ok => {
        return Err(ImapError::Refused { command: "IDLE".into(), text });
      }
      other => return Err(ImapError::Protocol(format!("IDLE answered {other:?}"))),
    }
    let started = std::time::Instant::now();
    let outcome = loop {
      if wake.is_some_and(|w| w.load(Ordering::SeqCst)) {
        break Ok(IdleEvent::Timeout);
      }
      let left = wait.saturating_sub(started.elapsed());
      if left.is_zero() {
        break Ok(IdleEvent::Timeout);
      }
      let slice = if wake.is_some() { left.min(IDLE_SLICE) } else { left };
      self.set_read_timeout(slice)?;
      let ready = match self.stream.fill_buf() {
        Ok(bytes) => {
          if bytes.is_empty() {
            break Err(ImapError::Closed);
          }
          true
        }
        Err(e) if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut => false,
        Err(e) => break Err(e.into()),
      };
      if !ready {
        continue;
      }
      self.set_read_timeout(DEFAULT_TIMEOUT)?;
      match self.read_response() {
        Ok(Response::Untagged(tokens)) => {
          if let Some(event) = untagged_event(&tokens) {
            break Ok(event);
          }
        }
        Ok(Response::Tagged { .. }) | Ok(Response::Continuation(_)) => {}
        Err(e) => break Err(e),
      }
    };
    self.set_read_timeout(DEFAULT_TIMEOUT)?;
    let event = outcome?;
    self.send_line("DONE")?;
    loop {
      match self.read_response()? {
        Response::Tagged { tag: got, .. } if got == tag => break,
        Response::Untagged(tokens) => {
          if let Some(e) = untagged_event(&tokens) {
            self.pending.push(e);
          }
        }
        _ => {}
      }
    }
    Ok(event)
  }

  pub fn logout(&mut self) {
    let _ = self.run("LOGOUT");
  }
}

/// The UIDs of the `* SEARCH` replies, ascending.
fn search_uids(replies: Vec<Vec<Token>>) -> Vec<u32> {
  let mut uids = Vec::new();
  for tokens in replies {
    let Some(Token::Atom(kind)) = tokens.first() else { continue };
    if !kind.eq_ignore_ascii_case("SEARCH") {
      continue;
    }
    for t in &tokens[1..] {
      if let Token::Number(n) = t {
        uids.push(*n as u32);
      }
    }
  }
  uids.sort_unstable();
  uids
}

fn untagged_event(tokens: &[Token]) -> Option<IdleEvent> {
  match (tokens.first(), tokens.get(1)) {
    (Some(Token::Number(n)), Some(Token::Atom(a))) => match a.to_ascii_uppercase().as_str() {
      "EXISTS" => Some(IdleEvent::Exists(*n as u32)),
      "EXPUNGE" => Some(IdleEvent::Expunge(*n as u32)),
      "FETCH" => Some(IdleEvent::Fetch(*n as u32)),
      _ => None,
    },
    _ => None,
  }
}

fn strip_crlf(line: &[u8]) -> &[u8] {
  let mut end = line.len();
  while end > 0 && (line[end - 1] == b'\n' || line[end - 1] == b'\r') {
    end -= 1;
  }
  &line[..end]
}

/// The order to try a name's addresses in: every IPv4 one, then the rest.
///
/// Gmail's mail servers answer on both. A network that hands out IPv6
/// addresses it cannot route is common, and on one the first address a name
/// resolves to is an IPv6 one that never answers. A browser tries both and
/// works, so the reader has internet, while this took the first address only
/// and failed on every attempt: "no connection to Gmail" on a computer that is
/// online, and a message that stays on "Sending…". An IPv6-only network
/// resolves to IPv6 addresses alone, so it loses nothing by this order.
fn connect_order(mut addrs: Vec<std::net::SocketAddr>) -> Vec<std::net::SocketAddr> {
  addrs.sort_by_key(|addr| !addr.is_ipv4());
  addrs
}

/// A TCP connection to the first of the name's addresses that answers.
///
/// Each address has a share of the time, so one dead address cannot use all
/// of it. The error says that the server was not reached: the old one came out
/// as "no answer from the server for 300 seconds", which was never measured.
fn connect_any(host: &str, port: u16, timeout: Duration) -> ImapResult<TcpStream> {
  let addrs = connect_order((host, port).to_socket_addrs()?.collect());
  if addrs.is_empty() {
    return Err(ImapError::Io(io::Error::new(io::ErrorKind::NotFound, "no address")));
  }
  let each = (timeout / addrs.len().min(3) as u32).max(Duration::from_secs(5));
  let mut last: Option<io::Error> = None;
  for addr in addrs.iter().take(6) {
    match TcpStream::connect_timeout(addr, each) {
      Ok(tcp) => return Ok(tcp),
      Err(e) => {
        log::info!("[mail-net] {host}:{port} at {addr}: {e}");
        last = Some(e);
      }
    }
  }
  let cause = last.map(|e| e.to_string()).unwrap_or_default();
  Err(ImapError::Io(io::Error::new(
    io::ErrorKind::NotConnected,
    format!("could not reach {host}:{port} ({cause})"),
  )))
}

/// A TLS stream to `host:port`, verified against the roots built into the
/// app (`webpki-roots`), not the ones the operating system keeps.
pub(crate) fn tls_connect(host: &str, port: u16, timeout: Duration) -> ImapResult<Stream> {
  let tcp = connect_any(host, port, timeout)?;
  tcp.set_read_timeout(Some(DEFAULT_TIMEOUT))?;
  tcp.set_write_timeout(Some(timeout))?;
  let mut roots = rustls::RootCertStore::empty();
  roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
  let config = rustls::ClientConfig::builder_with_provider(Arc::new(
    rustls::crypto::ring::default_provider(),
  ))
  .with_safe_default_protocol_versions()
  .map_err(|e| ImapError::Tls(e.to_string()))?
  .with_root_certificates(roots)
  .with_no_client_auth();
  let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
    .map_err(|e| ImapError::Tls(e.to_string()))?;
  let conn = rustls::ClientConnection::new(Arc::new(config), server_name)
    .map_err(|e| ImapError::Tls(e.to_string()))?;
  Ok(Stream::Tls(rustls::StreamOwned::new(conn, tcp)))
}

/// `{123}` at the end of a line: the size of the literal that follows.
fn literal_size(line: &[u8]) -> Option<usize> {
  if !line.ends_with(b"}") {
    return None;
  }
  let open = line.iter().rposition(|&b| b == b'{')?;
  let digits = std::str::from_utf8(&line[open + 1..line.len() - 1]).ok()?;
  let digits = digits.trim_end_matches('+');
  digits.parse().ok()
}

/// How a Gmail mailbox signs in: a Google OAuth access token, or an app
/// password the reader made in their Google Account.
#[derive(Clone)]
pub enum Credential {
  OAuth(String),
  Password(String),
}

impl std::fmt::Debug for Credential {
  // Never the secret itself, in a log or a panic.
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(match self {
      Credential::OAuth(_) => "Credential::OAuth(..)",
      Credential::Password(_) => "Credential::Password(..)",
    })
  }
}

impl Drop for Credential {
  // A dropped String gives its bytes back to the allocator as they are. The
  // secret then sits in free memory until something else takes that space.
  fn drop(&mut self) {
    use zeroize::Zeroize;
    match self {
      Credential::OAuth(secret) | Credential::Password(secret) => secret.zeroize(),
    }
  }
}

/// A mailbox name as a quoted string, as SELECT wants it.
pub fn quote(raw: &str) -> String {
  format!("\"{}\"", raw.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A server that plays a script: for each command it reads, it checks a
/// substring and writes a reply, `{tag}` standing for the command's tag.
/// For tests, here and in the modules that drive the client.
#[cfg(test)]
pub(crate) fn fake_server(script: Vec<(&'static str, &'static str)>) -> TcpStream {
  use std::net::TcpListener;
  use std::thread;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      socket.write_all(b"* OK Gimap ready\r\n").unwrap();
      let mut reader = BufReader::new(socket.try_clone().unwrap());
      let mut tag = String::from("A0");
      for (expect, reply) in script {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains(expect), "server expected {expect:?}, got {line:?}");
        // DONE ends an IDLE and carries no tag; the reply uses the IDLE's.
        if let Some(first) = line.split_whitespace().next() {
          if first.starts_with('A') && first[1..].chars().all(|c| c.is_ascii_digit()) {
            tag = first.to_string();
          }
        }
        let reply = reply.replace("{tag}", &tag);
        socket.write_all(reply.as_bytes()).unwrap();
        if expect.starts_with("AUTHENTICATE") && reply.starts_with("+ ") {
          // A refusal: the client answers the challenge with an empty line.
          let mut answer = String::new();
          reader.read_line(&mut answer).unwrap();
          socket.write_all(format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n").as_bytes()).unwrap();
        }
      }
    });
    TcpStream::connect(addr).unwrap()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_charset_a_message_names_is_read() {
    // Central European: one byte per letter.
    assert_eq!(decode_charset(b"Nov\xe1kov\xe1 \xe8te", "windows-1250"), "Nováková čte");
    assert_eq!(decode_charset(b"Nov\xe1kov\xe1 \xe8te", "ISO-8859-2"), "Nováková čte");
    // Double-byte: quotes and an arrow, two bytes each.
    assert_eq!(decode_charset(b"\xa1\xb0Hej\xa1\xb1 \xa1\xe6 videre", "ks_c_5601-1987"), "“Hej” → videre");
    assert_eq!(decode_charset(b"\xa1\xb0Hej\xa1\xb1", "gb2312"), "“Hej”");
    // The Latin family as before, quotes and all.
    assert_eq!(decode_charset(b"\x93Hej\x94 p\xe5 dig", "Windows-1252"), "“Hej” på dig");
    assert_eq!(decode_charset(b"p\xe5 dig", "iso-8859-1"), "på dig");
    assert_eq!(decode_charset("på dig".as_bytes(), "\"UTF-8\""), "på dig");
  }

  #[test]
  fn a_label_that_does_not_fit_the_bytes_is_not_taken_at_its_word() {
    // No UTF-8 in it at all: a Latin mail that did not say so.
    assert_eq!(decode_charset(b"Vi ses p\xe5 fredag", "utf-8"), "Vi ses på fredag");
    // Real UTF-8 with one broken byte stays UTF-8.
    assert_eq!(decode_charset(b"p\xc3\xa5 \xff", "utf-8"), "på \u{fffd}");
    // A Latin template with UTF-8 put into it: the stray letter is Latin,
    // and the Windows-1252 quotes sent as C1 characters are quotes.
    assert_eq!(
      decode_charset("Tak f\u{e6}r \u{201c}Ja\u{201d} \u{84}Nein\u{93}".as_bytes(), "utf-8"),
      "Tak fær “Ja” „Nein“"
    );
    let mut mixed = b"Gr\xfc\xdfe \xe2\x80\x9cHej\xe2\x80\x9d".to_vec();
    mixed.extend_from_slice(b" \xc3\xa5");
    assert_eq!(decode_charset(&mixed, "utf-8"), "Grüße “Hej” å");
    // "us-ascii" cannot hold 8-bit bytes; good UTF-8 is UTF-8.
    assert_eq!(decode_charset("Søren".as_bytes(), "us-ascii"), "Søren");
    assert_eq!(decode_charset(b"S\xf8ren", "us-ascii"), "Søren");
    // A name nobody knows is read as UTF-8.
    assert_eq!(decode_charset("Søren".as_bytes(), "x-unknown"), "Søren");
  }

  #[test]
  fn a_fetch_with_literals_and_gmail_attributes_is_read_whole() {
    let headers = "From: =?utf-8?Q?Ann_S=C3=B8rensen?= <ann@sender.test>\r\nSubject: Hello\r\n\r\n";
    let reply = format!(
      "* 1 FETCH (UID 42 FLAGS (\\Seen $Phishing) X-GM-MSGID 1788445234887 X-GM-THRID 1788445234000 X-GM-LABELS (\"\\\\Inbox\" \"Work stuff\" \"&AOY-\") MODSEQ (5678) RFC822.SIZE 100 INTERNALDATE \"03-Sep-2026 14:20:34 +0000\" BODY[HEADER.FIELDS (From Subject)] {{{}}}\r\n{})\r\n{{tag}} OK Success\r\n",
      headers.len(),
      headers
    );
    let reply: &'static str = Box::leak(reply.into_boxed_str());
    let stream = fake_server(vec![
      ("AUTHENTICATE XOAUTH2", "{tag} OK Success\r\n"),
      ("SELECT", "* 3 EXISTS\r\n* OK [UIDVALIDITY 7] UIDs valid\r\n* OK [HIGHESTMODSEQ 9000]\r\n{tag} OK [READ-WRITE] All Mail selected\r\n"),
      ("UID FETCH 42", reply),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    client.authenticate_xoauth2("vera@example.com", "tok").unwrap();
    let info = client.select("[Gmail]/All Mail").unwrap();
    assert_eq!(info.exists, 3);
    assert_eq!(info.uid_validity, Some(7));
    assert_eq!(info.highest_modseq, Some(9000));
    let fetched = client
      .uid_fetch("42", "UID FLAGS X-GM-MSGID X-GM-THRID X-GM-LABELS MODSEQ RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER.FIELDS (From Subject)]", None)
      .unwrap();
    assert_eq!(fetched.len(), 1);
    let m = &fetched[0];
    assert_eq!(m.uid(), Some(42));
    assert_eq!(m.flags(), vec!["\\Seen", "$Phishing"]);
    assert_eq!(m.get("X-GM-THRID").and_then(Item::as_u64), Some(1788445234000));
    assert_eq!(m.get("MODSEQ").and_then(Item::as_u64), Some(5678));
    let labels: Vec<String> = m.get("X-GM-LABELS").unwrap().as_list().iter().filter_map(Item::as_str).collect();
    assert_eq!(labels, vec!["\\Inbox", "Work stuff", "&AOY-"]);
    let block = m.body_section("BODY[HEADER").unwrap().as_bytes().unwrap();
    let parsed = parse_headers(&block);
    let from = parse_address_list(header(&parsed, "from").unwrap());
    assert_eq!(from[0].name, "Ann Sørensen");
    assert_eq!(from[0].email, "ann@sender.test");
    assert_eq!(parse_internal_date(&m.get("INTERNALDATE").unwrap().as_str().unwrap()), Some(1_788_445_234_000));
  }

  #[test]
  fn an_app_password_signs_in_with_sasl_plain() {
    // \0vera@example.com\0pw "with" quotes, in base64.
    let expected = base64::engine::general_purpose::STANDARD.encode("\u{0}vera@example.com\u{0}pw \"with\" quotes");
    let command: &'static str = Box::leak(format!("AUTHENTICATE PLAIN {expected}").into_boxed_str());
    let stream = fake_server(vec![(command, "{tag} OK Success\r\n")]);
    let mut client = Client::connect_plain(stream).unwrap();
    client
      .sign_in("vera@example.com", &Credential::Password("pw \"with\" quotes".into()))
      .unwrap();
  }

  #[test]
  fn a_refused_app_password_is_a_refusal_with_the_servers_words() {
    let stream = fake_server(vec![(
      "AUTHENTICATE PLAIN",
      "{tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n",
    )]);
    let mut client = Client::connect_plain(stream).unwrap();
    let err = client.sign_in("vera@example.com", &Credential::Password("wrong".into())).unwrap_err();
    assert!(matches!(err, ImapError::Refused { .. }), "{err}");
    assert!(err.to_string().contains("Invalid credentials"), "{err}");
    assert!(!format!("{:?}", Credential::Password("wrong".into())).contains("wrong"));
  }

  #[test]
  fn a_refused_sign_in_carries_the_servers_reason() {
    let stream = fake_server(vec![(
      "AUTHENTICATE XOAUTH2",
      "+ eyJzdGF0dXMiOiI0MDAiLCJzY2hlbWVzIjoiQmVhcmVyIn0=\r\n",
    )]);
    let mut client = Client::connect_plain(stream).unwrap();
    let err = client.authenticate_xoauth2("vera@example.com", "bad").unwrap_err();
    let text = err.to_string();
    assert!(text.contains("Invalid credentials"), "{text}");
    assert!(text.contains("\"status\":\"400\""), "{text}");
  }

  #[test]
  fn idle_returns_when_the_server_speaks_and_on_the_clock_when_it_does_not() {
    let stream = fake_server(vec![
      ("IDLE", "+ idling\r\n* 12 EXISTS\r\n"),
      ("DONE", "{tag} OK IDLE terminated\r\n"),
      ("IDLE", "+ idling\r\n"),
      ("DONE", "{tag} OK IDLE terminated\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    assert_eq!(client.idle(Duration::from_secs(5)).unwrap(), IdleEvent::Exists(12));
    assert_eq!(client.idle(Duration::from_millis(200)).unwrap(), IdleEvent::Timeout);
  }

  #[test]
  fn a_wake_ends_the_idle_at_once_and_a_reply_still_comes_through_whole() {
    // Reported 2026-10-13: archives waited out the minute-long IDLE.
    let stream = fake_server(vec![
      ("IDLE", "+ idling\r\n"),
      ("DONE", "{tag} OK IDLE terminated\r\n"),
      ("IDLE", "+ idling\r\n* 7 EXISTS\r\n"),
      ("DONE", "{tag} OK IDLE terminated\r\n"),
    ]);
    let mut client = Client::connect_plain(stream).unwrap();
    let wake = Arc::new(AtomicBool::new(false));
    let setter = wake.clone();
    std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(300));
      setter.store(true, Ordering::SeqCst);
    });
    let started = std::time::Instant::now();
    assert_eq!(client.idle_until(Duration::from_secs(60), Some(&wake)).unwrap(), IdleEvent::Timeout);
    assert!(started.elapsed() < Duration::from_secs(3), "woken in {:?}", started.elapsed());
    // A wait that can be woken still hears the server.
    let quiet = AtomicBool::new(false);
    assert_eq!(client.idle_until(Duration::from_secs(5), Some(&quiet)).unwrap(), IdleEvent::Exists(7));
  }

  #[test]
  fn list_finds_all_mail_by_its_attribute_whatever_its_name() {
    let stream = fake_server(vec![(
      "LIST",
      "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n* LIST (\\HasNoChildren \\All) \"/\" \"[Gmail]/Alle mails\"\r\n* LIST (\\HasNoChildren) \"/\" \"&AOY-blesag\"\r\n{tag} OK Success\r\n",
    )]);
    let mut client = Client::connect_plain(stream).unwrap();
    let boxes = client.list().unwrap();
    let all = boxes.iter().find(|b| b.attributes.iter().any(|a| a == "\\All")).unwrap();
    assert_eq!(all.raw, "[Gmail]/Alle mails");
    assert_eq!(boxes[2].name, "æblesag");
  }

  #[test]
  fn search_lists_uids_ascending() {
    let stream = fake_server(vec![("UID SEARCH", "* SEARCH 9 3 12\r\n{tag} OK done\r\n")]);
    let mut client = Client::connect_plain(stream).unwrap();
    assert_eq!(client.uid_search("ALL").unwrap(), vec![3, 9, 12]);
  }

  #[test]
  fn addresses_names_and_groups_are_read() {
    let list = parse_address_list("\"Holm, Vera\" <vera@x.test>, bare@y.test, Team: a@z.test, b@z.test;, (comment) c@w.test");
    assert_eq!(list[0], Mailbox { name: "Holm, Vera".into(), email: "vera@x.test".into() });
    assert_eq!(list[1].email, "bare@y.test");
    assert_eq!(list[2].email, "a@z.test");
    assert_eq!(list[3].email, "b@z.test");
    assert_eq!(list[4].email, "c@w.test");
  }

  #[test]
  fn quotes_round_an_address_are_not_part_of_it() {
    let list = parse_address_list("Ann Berg <'ann@x.test'>, 'bo@y.test', \"'cy@z.test'\", o'neill@w.test");
    assert_eq!(list[0], Mailbox { name: "Ann Berg".into(), email: "ann@x.test".into() });
    assert_eq!(list[1].email, "bo@y.test");
    assert_eq!(list[2].email, "cy@z.test");
    assert_eq!(list[3].email, "o'neill@w.test");
    assert_eq!(clean_address("'o'neill@w.test'"), "o'neill@w.test");
  }

  #[test]
  fn encoded_words_and_utf7_decode() {
    assert_eq!(decode_encoded_words("=?ISO-8859-1?Q?Bj=F8rn?= =?utf-8?B?SGVsbG8=?= plain"), "BjørnHello plain");
    assert_eq!(decode_modified_utf7("&AOY-ble &- ost"), "æble & ost");
    assert_eq!(decode_modified_utf7("[Gmail]/All Mail"), "[Gmail]/All Mail");
    assert_eq!(encode_modified_utf7("æble & ost"), "&AOY-ble &- ost");
    assert_eq!(decode_modified_utf7(&encode_modified_utf7("Ølhøst/2026")), "Ølhøst/2026");
  }

  #[test]
  fn ipv4_addresses_are_tried_before_ipv6_ones() {
    let addrs: Vec<std::net::SocketAddr> = vec![
      "[2a00:1450:400c:c0c::6c]:993".parse().unwrap(),
      "142.250.1.108:993".parse().unwrap(),
      "[2a00:1450:400c:c0c::6d]:993".parse().unwrap(),
      "142.250.1.109:993".parse().unwrap(),
    ];
    let order = connect_order(addrs);
    assert!(order[0].is_ipv4() && order[1].is_ipv4());
    assert!(order[2].is_ipv6() && order[3].is_ipv6());
    // The order inside each family is the resolver's.
    assert_eq!(order[0].to_string(), "142.250.1.108:993");

    let only_v6: Vec<std::net::SocketAddr> = vec!["[64:ff9b::8efa:16c]:993".parse().unwrap()];
    assert_eq!(connect_order(only_v6.clone()), only_v6);
  }

  #[test]
  fn a_server_that_cannot_be_reached_is_not_called_a_300_second_silence() {
    // Port 1 on this machine: refused at once, on every address.
    let err = connect_any("localhost", 1, Duration::from_secs(5)).unwrap_err();
    let text = err.to_string();
    assert!(text.contains("could not reach localhost:1"), "{text}");
    assert!(!text.contains("300 seconds"), "{text}");
  }

  #[test]
  fn a_snippet_comes_from_the_first_text_part() {
    let body = "--b1\r\nContent-Type: multipart/alternative; boundary=\"b2\"\r\n\r\n--b2\r\nContent-Type: text/plain; charset=\"iso-8859-1\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nK=E6re Ulrik,\r\nher er =\r\nnyt.\r\n--b2\r\nContent-Type: text/html\r\n\r\n<p>Kære</p>\r\n--b2--\r\n--b1--";
    let s = snippet_from_body(body.as_bytes(), "multipart/mixed; boundary=\"b1\"", "7bit", 200);
    assert_eq!(s, "Kære Ulrik, her er nyt.");
    let html = snippet_from_body(b"<html><body><p>Hi <b>there</b></p><style>x</style></body></html>", "text/html; charset=utf-8", "8bit", 200);
    assert_eq!(html, "Hi there");
    let b64 = snippet_from_body(b"SGVsbG8gd29ybGQ=", "text/plain", "base64", 200);
    assert_eq!(b64, "Hello world");
    // A whole page sent as the plain part is read as a page.
    let page = snippet_from_body(b"<!DOCTYPE html><html><head><title>Trip</title></head><body><p>Booked.</p></body></html>", "text/plain", "7bit", 200);
    assert!(!page.contains('<') && page.ends_with("Booked."), "{page}");
  }

  #[test]
  fn a_latin_part_sent_as_8bit_keeps_its_letters() {
    // "på" in Latin-1 is 0x70 0xE5: not UTF-8, so the whole body must not
    // be read as UTF-8 before the part is cut out of it.
    let mut body = b"--b1\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nEn besked p".to_vec();
    body.push(0xE5);
    body.extend_from_slice(b" vej\r\n--b1--");
    let s = snippet_from_body(&body, "multipart/alternative; boundary=b1", "7bit", 200);
    assert_eq!(s, "En besked på vej");
  }

  #[test]
  fn internal_dates_carry_their_zone() {
    assert_eq!(parse_internal_date("01-Jan-1970 00:00:00 +0000"), Some(0));
    assert_eq!(parse_internal_date("01-Jan-1970 01:00:00 +0100"), Some(0));
    assert_eq!(parse_internal_date("03-Sep-2026 07:20:34 -0700"), Some(1_788_445_234_000));
  }
}
