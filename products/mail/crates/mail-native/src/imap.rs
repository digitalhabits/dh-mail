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
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;

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

  /// SASL XOAUTH2 with an access token from the mailbox's OAuth grant.
  pub fn authenticate_xoauth2(&mut self, user: &str, access_token: &str) -> ImapResult<()> {
    let raw = format!("user={user}\u{1}auth=Bearer {access_token}\u{1}\u{1}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
    let tag = self.send_command(&format!("AUTHENTICATE XOAUTH2 {encoded}"))?;
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
    Ok(uids)
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
    let tag = self.send_command("IDLE")?;
    match self.read_response()? {
      Response::Continuation(_) => {}
      Response::Tagged { status, text, .. } if status != Status::Ok => {
        return Err(ImapError::Refused { command: "IDLE".into(), text });
      }
      other => return Err(ImapError::Protocol(format!("IDLE answered {other:?}"))),
    }
    self.set_read_timeout(wait)?;
    let outcome = loop {
      match self.read_response() {
        Ok(Response::Untagged(tokens)) => {
          if let Some(event) = untagged_event(&tokens) {
            break Ok(event);
          }
        }
        Ok(Response::Tagged { .. }) | Ok(Response::Continuation(_)) => {}
        Err(e) if e.is_timeout() => break Ok(IdleEvent::Timeout),
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

/// A TLS stream to `host:port`, verified against the platform roots.
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

/// A mailbox name as a quoted string, as SELECT wants it.
pub fn quote(raw: &str) -> String {
  format!("\"{}\"", raw.replace('\\', "\\\\").replace('"', "\\\""))
}

// ---------------------------------------------------------------------------
// Names, headers, dates: the text side of the protocol
// ---------------------------------------------------------------------------

/// IMAP mailbox names use a UTF-7 of their own: `&` opens a run of base64
/// UTF-16, `-` closes it, `,` stands in for `/`, and `&-` is a plain `&`.
pub fn decode_modified_utf7(raw: &str) -> String {
  let mut out = String::new();
  let mut chars = raw.chars().peekable();
  while let Some(c) = chars.next() {
    if c != '&' {
      out.push(c);
      continue;
    }
    let mut run = String::new();
    let mut closed = false;
    for d in chars.by_ref() {
      if d == '-' {
        closed = true;
        break;
      }
      run.push(d);
    }
    if run.is_empty() {
      out.push('&');
      continue;
    }
    let b64 = run.replace(',', "/");
    let padded = match b64.len() % 4 {
      2 => format!("{b64}=="),
      3 => format!("{b64}="),
      _ => b64,
    };
    match base64::engine::general_purpose::STANDARD.decode(padded) {
      Ok(bytes) => {
        let units: Vec<u16> = bytes.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        out.push_str(&String::from_utf16_lossy(&units));
      }
      Err(_) => {
        out.push('&');
        out.push_str(&run);
        if closed {
          out.push('-');
        }
      }
    }
  }
  out
}

/// The other way: a name as IMAP wants it written.
pub fn encode_modified_utf7(name: &str) -> String {
  let mut out = String::new();
  let mut run: Vec<u16> = Vec::new();
  let flush = |run: &mut Vec<u16>, out: &mut String| {
    if run.is_empty() {
      return;
    }
    let bytes: Vec<u8> = run.iter().flat_map(|u| u.to_be_bytes()).collect();
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(bytes).replace('/', ",");
    out.push('&');
    out.push_str(&b64);
    out.push('-');
    run.clear();
  };
  for c in name.chars() {
    if c == '&' {
      flush(&mut run, &mut out);
      out.push_str("&-");
    } else if (' '..='~').contains(&c) {
      flush(&mut run, &mut out);
      out.push(c);
    } else {
      let mut units = [0u16; 2];
      run.extend_from_slice(c.encode_utf16(&mut units));
    }
  }
  flush(&mut run, &mut out);
  out
}

/// RFC 2047 encoded words in a header, decoded. Whitespace between two
/// encoded words is not part of the text.
pub fn decode_encoded_words(value: &str) -> String {
  let mut out = String::new();
  let mut rest = value;
  let mut last_was_encoded = false;
  while let Some(start) = rest.find("=?") {
    let before = &rest[..start];
    if !(last_was_encoded && before.trim().is_empty()) {
      out.push_str(before);
    }
    let tail = &rest[start + 2..];
    let Some((charset, tail)) = tail.split_once('?') else {
      out.push_str(&rest[start..]);
      return out;
    };
    let Some((encoding, tail)) = tail.split_once('?') else {
      out.push_str(&rest[start..]);
      return out;
    };
    let Some((text, tail)) = tail.split_once("?=") else {
      out.push_str(&rest[start..]);
      return out;
    };
    let bytes = match encoding.to_ascii_uppercase().as_str() {
      "B" => base64::engine::general_purpose::STANDARD.decode(text).unwrap_or_else(|_| text.as_bytes().to_vec()),
      "Q" => q_decode(text),
      _ => text.as_bytes().to_vec(),
    };
    out.push_str(&decode_charset(&bytes, charset.split('*').next().unwrap_or(charset)));
    last_was_encoded = true;
    rest = tail;
  }
  out.push_str(rest);
  out
}

fn q_decode(text: &str) -> Vec<u8> {
  let b = text.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    match b[i] {
      b'_' => out.push(b' '),
      b'=' if i + 2 < b.len() => {
        if let Some(v) = hex_pair(b[i + 1], b[i + 2]) {
          out.push(v);
          i += 2;
        } else {
          out.push(b'=');
        }
      }
      other => out.push(other),
    }
    i += 1;
  }
  out
}

fn hex_pair(a: u8, b: u8) -> Option<u8> {
  let hi = (a as char).to_digit(16)?;
  let lo = (b as char).to_digit(16)?;
  Some((hi * 16 + lo) as u8)
}

/// Bytes in a named charset as text. UTF-8 and the Latin-1 family are
/// what mail carries; anything else is read as UTF-8 with replacement.
pub fn decode_charset(bytes: &[u8], charset: &str) -> String {
  let cs = charset.trim().to_ascii_lowercase();
  if cs.starts_with("iso-8859-1") || cs == "latin1" || cs.starts_with("windows-1252") || cs == "cp1252" || cs == "us-ascii" {
    bytes.iter().map(|&b| cp1252_char(b)).collect()
  } else {
    String::from_utf8_lossy(bytes).into_owned()
  }
}

fn cp1252_char(b: u8) -> char {
  match b {
    0x80 => '€', 0x82 => '‚', 0x83 => 'ƒ', 0x84 => '„', 0x85 => '…', 0x86 => '†', 0x87 => '‡',
    0x88 => 'ˆ', 0x89 => '‰', 0x8A => 'Š', 0x8B => '‹', 0x8C => 'Œ', 0x8E => 'Ž', 0x91 => '‘',
    0x92 => '’', 0x93 => '“', 0x94 => '”', 0x95 => '•', 0x96 => '–', 0x97 => '—', 0x98 => '˜',
    0x99 => '™', 0x9A => 'š', 0x9B => '›', 0x9C => 'œ', 0x9E => 'ž', 0x9F => 'Ÿ',
    other => other as char,
  }
}

/// Quoted-printable, as a body or part carries it.
pub fn qp_decode(text: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(text.len());
  let mut i = 0;
  while i < text.len() {
    if text[i] == b'=' {
      if i + 1 < text.len() && (text[i + 1] == b'\r' || text[i + 1] == b'\n') {
        // Soft line break.
        i += 1;
        if i < text.len() && text[i] == b'\r' {
          i += 1;
        }
        if i < text.len() && text[i] == b'\n' {
          i += 1;
        }
        continue;
      }
      if i + 2 < text.len() {
        if let Some(v) = hex_pair(text[i + 1], text[i + 2]) {
          out.push(v);
          i += 3;
          continue;
        }
      }
    }
    out.push(text[i]);
    i += 1;
  }
  out
}

/// A header block, unfolded, as (lower-cased name, value) in order.
pub fn parse_headers(block: &[u8]) -> Vec<(String, String)> {
  let text = String::from_utf8_lossy(block).replace("\r\n", "\n");
  let mut out: Vec<(String, String)> = Vec::new();
  for line in text.split('\n') {
    if line.is_empty() {
      continue;
    }
    if line.starts_with(' ') || line.starts_with('\t') {
      if let Some(last) = out.last_mut() {
        last.1.push(' ');
        last.1.push_str(line.trim());
      }
      continue;
    }
    if let Some((name, value)) = line.split_once(':') {
      out.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
  }
  out
}

pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
  headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

/// One address as a header names it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Mailbox {
  pub name: String,
  pub email: String,
}

/// The addresses in a From/To/Cc header, in order.
pub fn parse_address_list(value: &str) -> Vec<Mailbox> {
  let mut out = Vec::new();
  for entry in split_addresses(value) {
    let entry = entry.trim().trim_end_matches(';').trim();
    if entry.is_empty() {
      continue;
    }
    // A group: "Team: a@x, b@x;" — the name before the colon is not an address.
    let entry = match entry.find(':') {
      Some(colon) if !entry[..colon].contains('@') && !entry[..colon].contains('<') => entry[colon + 1..].trim(),
      _ => entry,
    };
    if entry.is_empty() {
      continue;
    }
    if let (Some(open), Some(close)) = (entry.rfind('<'), entry.rfind('>')) {
      if close > open {
        let email = clean_address(&entry[open + 1..close]);
        let name = strip_comments(&entry[..open]).trim().trim_matches('"').trim().to_string();
        out.push(Mailbox { name: decode_encoded_words(&name), email });
        continue;
      }
    }
    let bare = clean_address(&strip_comments(entry));
    if !bare.is_empty() {
      out.push(Mailbox { name: String::new(), email: bare });
    }
  }
  out
}

/// An address without the quotes some senders put round it. Outlook and
/// Exchange write `<'ann@x.test'>`; the quotes are not part of the
/// address, and Gmail refuses a recipient that keeps them. A quote inside
/// the address, as in `o'neill@x.test`, stays.
pub fn clean_address(raw: &str) -> String {
  let mut s = raw.trim();
  loop {
    let unquoted = s
      .strip_prefix('"')
      .and_then(|t| t.strip_suffix('"'))
      .or_else(|| s.strip_prefix('\'').and_then(|t| t.strip_suffix('\'')))
      .map(str::trim);
    match unquoted {
      Some(t) => s = t,
      None => break,
    }
  }
  s.to_string()
}

/// Split on the commas that separate addresses, not the ones inside a
/// quoted name or a comment.
fn split_addresses(value: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut current = String::new();
  let mut in_quote = false;
  let mut depth = 0;
  let mut in_angle = false;
  for c in value.chars() {
    match c {
      '"' => {
        in_quote = !in_quote;
        current.push(c);
      }
      '(' if !in_quote => {
        depth += 1;
        current.push(c);
      }
      ')' if !in_quote && depth > 0 => {
        depth -= 1;
        current.push(c);
      }
      '<' if !in_quote => {
        in_angle = true;
        current.push(c);
      }
      '>' if !in_quote => {
        in_angle = false;
        current.push(c);
      }
      ',' if !in_quote && depth == 0 && !in_angle => {
        out.push(std::mem::take(&mut current));
      }
      _ => current.push(c),
    }
  }
  if !current.trim().is_empty() {
    out.push(current);
  }
  out
}

fn strip_comments(text: &str) -> String {
  let mut out = String::new();
  let mut depth = 0;
  let mut in_quote = false;
  for c in text.chars() {
    match c {
      '"' => {
        in_quote = !in_quote;
        out.push(c);
      }
      '(' if !in_quote => depth += 1,
      ')' if !in_quote && depth > 0 => depth -= 1,
      _ if depth == 0 => out.push(c),
      _ => {}
    }
  }
  out
}

/// INTERNALDATE, "03-Sep-2026 14:20:34 +0000", as ms since the epoch.
pub fn parse_internal_date(text: &str) -> Option<i64> {
  let text = text.trim().trim_matches('"');
  let mut parts = text.split_whitespace();
  let date = parts.next()?;
  let time = parts.next()?;
  let zone = parts.next().unwrap_or("+0000");
  let mut d = date.split('-');
  let day: i64 = d.next()?.trim().parse().ok()?;
  let month = month_number(d.next()?)?;
  let year: i64 = d.next()?.parse().ok()?;
  let mut t = time.split(':');
  let hour: i64 = t.next()?.parse().ok()?;
  let minute: i64 = t.next()?.parse().ok()?;
  let second: i64 = t.next()?.parse().ok()?;
  let days = days_from_civil(year, month, day);
  let local = days * 86_400 + hour * 3_600 + minute * 60 + second;
  let offset = zone_offset_seconds(zone)?;
  Some((local - offset) * 1000)
}

fn month_number(name: &str) -> Option<i64> {
  const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let lower = name.to_ascii_lowercase();
  MONTHS.iter().position(|m| lower.starts_with(m)).map(|i| i as i64 + 1)
}

fn zone_offset_seconds(zone: &str) -> Option<i64> {
  let (sign, digits) = match zone.chars().next()? {
    '+' => (1, &zone[1..]),
    '-' => (-1, &zone[1..]),
    _ => return Some(0),
  };
  if digits.len() != 4 {
    return None;
  }
  let hours: i64 = digits[..2].parse().ok()?;
  let minutes: i64 = digits[2..].parse().ok()?;
  Some(sign * (hours * 3_600 + minutes * 60))
}

/// Days since 1970-01-01 for a civil date. Howard Hinnant's algorithm.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let mp = (m + 9) % 12;
  let doy = (153 * mp + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

// ---------------------------------------------------------------------------
// A snippet from the first bytes of the body
// ---------------------------------------------------------------------------

/// Parameters of a Content-Type or Content-Transfer-Encoding value.
fn param<'a>(value: &'a str, name: &str) -> Option<String> {
  let lower = value.to_ascii_lowercase();
  let key = format!("{name}=");
  let at = lower.find(&key)?;
  let rest = &value[at + key.len()..];
  let rest = rest.trim_start();
  if let Some(q) = rest.strip_prefix('"') {
    Some(q.split('"').next().unwrap_or("").to_string())
  } else {
    Some(rest.split(|c: char| c == ';' || c.is_whitespace()).next().unwrap_or("").to_string())
  }
}

fn mime_type(content_type: &str) -> String {
  content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

/// The first readable words of a message, from the opening bytes of its
/// body and the headers that say how to read them. Multipart bodies are
/// walked to their first text part. The result is short, one line, plain.
pub fn snippet_from_body(body: &[u8], content_type: &str, transfer_encoding: &str, max_chars: usize) -> String {
  let text = first_text(body, content_type, transfer_encoding, 0);
  let mut out = String::new();
  for word in text.split_whitespace() {
    if out.len() + word.len() + 1 > max_chars {
      break;
    }
    if !out.is_empty() {
      out.push(' ');
    }
    out.push_str(word);
  }
  out
}

fn first_text(body: &[u8], content_type: &str, transfer_encoding: &str, depth: usize) -> String {
  let kind = mime_type(content_type);
  if kind.starts_with("multipart/") && depth < 4 {
    let Some(boundary) = param(content_type, "boundary") else {
      return String::new();
    };
    let marker = format!("--{boundary}");
    let text = String::from_utf8_lossy(body);
    let Some(start) = text.find(&marker) else {
      return String::new();
    };
    let after = &text[start + marker.len()..];
    let after = after.trim_start_matches(|c| c == '\r' || c == '\n');
    let (head, rest) = match after.find("\r\n\r\n").map(|i| (i, 4)).or_else(|| after.find("\n\n").map(|i| (i, 2))) {
      Some((i, n)) => (&after[..i], &after[i + n..]),
      None => return String::new(),
    };
    let headers = parse_headers(head.as_bytes());
    let part_type = header(&headers, "content-type").unwrap_or("text/plain");
    let part_cte = header(&headers, "content-transfer-encoding").unwrap_or("7bit");
    let end = rest.find(&marker).unwrap_or(rest.len());
    return first_text(rest[..end].as_bytes(), part_type, part_cte, depth + 1);
  }
  let decoded: Vec<u8> = match transfer_encoding.trim().to_ascii_lowercase().as_str() {
    "quoted-printable" => qp_decode(body),
    "base64" => {
      let compact: Vec<u8> = body.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
      // A partial fetch may cut mid-quantum; drop the ragged end.
      let usable = compact.len() - compact.len() % 4;
      base64::engine::general_purpose::STANDARD.decode(&compact[..usable]).unwrap_or_default()
    }
    _ => body.to_vec(),
  };
  let charset = param(content_type, "charset").unwrap_or_else(|| "utf-8".into());
  let text = decode_charset(&decoded, &charset);
  if kind == "text/html" {
    crate::messages::strip_html(&text)
  } else if kind.starts_with("text/") || kind.is_empty() {
    // Some senders write entities into the plain part too.
    crate::messages::decode_entities(&crate::messages::strip_stray_tags(&text))
  } else {
    String::new()
  }
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
  }

  #[test]
  fn internal_dates_carry_their_zone() {
    assert_eq!(parse_internal_date("01-Jan-1970 00:00:00 +0000"), Some(0));
    assert_eq!(parse_internal_date("01-Jan-1970 01:00:00 +0100"), Some(0));
    assert_eq!(parse_internal_date("03-Sep-2026 07:20:34 -0700"), Some(1_788_445_234_000));
  }
}
