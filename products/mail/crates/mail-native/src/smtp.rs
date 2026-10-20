//! Sending over SMTP, with the mailbox's OAuth token.
//!
//! Gmail accepts mail on smtp.gmail.com:465 over TLS with the same XOAUTH2
//! sign-in IMAP uses, and files a copy in Sent itself. There is no budget
//! on it beyond the daily sending cap every route shares. The worker
//! carries the outbox here; nothing in the interface waits on it.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use base64::Engine;

use crate::imap::{tls_connect, Stream};

pub const SMTP_HOST: &str = "smtp.gmail.com";
pub const SMTP_PORT: u16 = 465;

#[derive(Debug)]
pub enum SmtpError {
  Io(std::io::Error),
  Tls(String),
  /// The message was written in full and the server's answer never came.
  /// It may have been sent. Sending again would risk a second copy, so
  /// this is handed back to the reader rather than retried.
  Unconfirmed(String),
  /// The server answered with a code that is not what the step wanted.
  Refused { code: u16, text: String },
  Protocol(String),
  /// A value for one line holds a line break. Nothing went to the server.
  LineBreak(String),
}

impl std::fmt::Display for SmtpError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      SmtpError::Io(e) => write!(f, "connection: {e}"),
      SmtpError::Unconfirmed(e) => write!(
        f,
        "the server did not confirm the send ({e}). Check Sent before you send it again"
      ),
      SmtpError::Tls(e) => write!(f, "tls: {e}"),
      SmtpError::Refused { code, text } => write!(f, "{code} {text}"),
      SmtpError::Protocol(e) => write!(f, "protocol: {e}"),
      SmtpError::LineBreak(what) => write!(f, "{what} has a line break. The message was not sent"),
    }
  }
}

impl SmtpError {
  /// A 5xx is the server's final word; anything else may pass next time.
  pub fn is_permanent(&self) -> bool {
    matches!(self, SmtpError::Refused { code, .. } if *code >= 500)
      || matches!(self, SmtpError::Unconfirmed(_) | SmtpError::LineBreak(_))
  }

  /// The text for the log. A refusal names a recipient, so the log gets
  /// only its code.
  pub fn for_log(&self) -> String {
    match self {
      SmtpError::Refused { code, .. } => format!("the server refused with {code}"),
      other => other.to_string(),
    }
  }
  /// 530 and 535: the grant, not the message.
  pub fn is_auth(&self) -> bool {
    matches!(self, SmtpError::Refused { code, .. } if *code == 530 || *code == 535)
  }
}

impl From<std::io::Error> for SmtpError {
  fn from(e: std::io::Error) -> Self {
    SmtpError::Io(e)
  }
}

/// Refuse a value for one SMTP line or one header line if it holds CR, LF
/// or NUL. Such a value ends the line and starts a new command or header.
/// `what` names the value in the error, for example "a recipient". The
/// error never holds the value itself.
pub fn single_line<'a>(what: &str, value: &'a str) -> Result<&'a str, SmtpError> {
  if value.contains(['\r', '\n', '\0']) {
    return Err(SmtpError::LineBreak(what.to_string()));
  }
  Ok(value)
}

pub struct Smtp {
  stream: BufReader<Stream>,
}

impl Smtp {
  pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Smtp, SmtpError> {
    let stream = tls_connect(host, port, timeout).map_err(|e| match e {
      crate::imap::ImapError::Io(io) => SmtpError::Io(io),
      other => SmtpError::Tls(other.to_string()),
    })?;
    Self::from_stream(stream)
  }

  pub fn connect_plain(tcp: std::net::TcpStream) -> Result<Smtp, SmtpError> {
    tcp.set_read_timeout(Some(Duration::from_secs(120)))?;
    Self::from_stream(Stream::Plain(tcp))
  }

  fn from_stream(stream: Stream) -> Result<Smtp, SmtpError> {
    let mut smtp = Smtp { stream: BufReader::new(stream) };
    smtp.expect(220)?;
    smtp.command("EHLO localhost", 250)?;
    Ok(smtp)
  }

  fn command(&mut self, line: &str, want: u16) -> Result<(u16, String), SmtpError> {
    single_line("a command", line)?;
    let stream = self.stream.get_mut();
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\r\n")?;
    stream.flush()?;
    self.expect(want)
  }

  /// One reply, however many lines, as its code and joined text.
  fn reply(&mut self) -> Result<(u16, String), SmtpError> {
    let mut text = String::new();
    loop {
      let mut line = String::new();
      let n = self.stream.read_line(&mut line)?;
      if n == 0 {
        return Err(SmtpError::Protocol("the server closed the connection".into()));
      }
      let line = line.trim_end_matches(['\r', '\n']);
      if line.len() < 3 {
        return Err(SmtpError::Protocol(format!("unreadable reply: {line:?}")));
      }
      let code: u16 = line[..3].parse().map_err(|_| SmtpError::Protocol(format!("unreadable reply: {line:?}")))?;
      let more = line.as_bytes().get(3) == Some(&b'-');
      if !text.is_empty() {
        text.push(' ');
      }
      text.push_str(line.get(4..).unwrap_or("").trim());
      if !more {
        return Ok((code, text));
      }
    }
  }

  fn expect(&mut self, want: u16) -> Result<(u16, String), SmtpError> {
    let (code, text) = self.reply()?;
    if code != want {
      return Err(SmtpError::Refused { code, text });
    }
    Ok((code, text))
  }

  /// Sign in as the mailbox's credential says (see imap::Credential).
  pub fn sign_in(&mut self, user: &str, credential: &crate::imap::Credential) -> Result<(), SmtpError> {
    match credential {
      crate::imap::Credential::OAuth(token) => self.authenticate_xoauth2(user, token),
      crate::imap::Credential::Password(password) => self.authenticate_plain(user, password),
    }
  }

  /// AUTH PLAIN with a password: a Gmail app password, which
  /// smtp.gmail.com takes with no Google sign-in.
  pub fn authenticate_plain(&mut self, user: &str, password: &str) -> Result<(), SmtpError> {
    let raw = format!("\u{0}{user}\u{0}{password}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
    let stream = self.stream.get_mut();
    stream.write_all(format!("AUTH PLAIN {encoded}\r\n").as_bytes())?;
    stream.flush()?;
    let (code, text) = self.reply()?;
    if code == 235 {
      return Ok(());
    }
    Err(SmtpError::Refused { code, text })
  }

  pub fn authenticate_xoauth2(&mut self, user: &str, access_token: &str) -> Result<(), SmtpError> {
    let raw = format!("user={user}\u{1}auth=Bearer {access_token}\u{1}\u{1}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
    let stream = self.stream.get_mut();
    stream.write_all(format!("AUTH XOAUTH2 {encoded}\r\n").as_bytes())?;
    stream.flush()?;
    let (code, text) = self.reply()?;
    if code == 235 {
      return Ok(());
    }
    if code == 334 {
      // The refusal comes as a challenge; an empty line asks for the verdict.
      let stream = self.stream.get_mut();
      stream.write_all(b"\r\n")?;
      stream.flush()?;
      let (code, verdict) = self.reply()?;
      let detail = base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or(text);
      return Err(SmtpError::Refused { code, text: format!("{verdict} ({detail})") });
    }
    Err(SmtpError::Refused { code, text })
  }

  /// Send one message. The server's reply text names the queue id.
  pub fn send(&mut self, from: &str, recipients: &[String], raw: &[u8]) -> Result<String, SmtpError> {
    // A message queued before the quotes were taken off at sync still
    // carries them.
    let recipients: Vec<String> = recipients.iter().map(|r| crate::imap::clean_address(r)).collect();
    // Every address is checked before the first command, so that a bad
    // one leaves nothing half done on the connection.
    single_line("the sender address", from)?;
    for rcpt in &recipients {
      single_line("a recipient address", rcpt)?;
    }
    self.command(&format!("MAIL FROM:<{from}>"), 250)?;
    for rcpt in &recipients {
      let (code, text) = {
        let stream = self.stream.get_mut();
        stream.write_all(format!("RCPT TO:<{rcpt}>\r\n").as_bytes())?;
        stream.flush()?;
        self.reply()?
      };
      if code != 250 && code != 251 {
        return Err(SmtpError::Refused { code, text: format!("{rcpt}: {text}") });
      }
    }
    self.command("DATA", 354)?;
    let stream = self.stream.get_mut();
    stream.write_all(&dot_stuffed(raw))?;
    let finished = stream.write_all(b"\r\n.\r\n").and_then(|_| stream.flush());
    // From here the server may have the whole message. A lost answer is
    // not a reason to send it again.
    if let Err(e) = finished {
      return Err(SmtpError::Unconfirmed(e.to_string()));
    }
    match self.expect(250) {
      Ok((_, text)) => Ok(text),
      Err(SmtpError::Refused { code, text }) => Err(SmtpError::Refused { code, text }),
      Err(other) => Err(SmtpError::Unconfirmed(other.to_string())),
    }
  }

  pub fn quit(&mut self) {
    let _ = self.command("QUIT", 221);
  }
}

/// A line that starts with a dot gets a second one, as the DATA step
/// requires, and line ends are CRLF.
///
/// A bare CR is a line end too. Some servers read "\r.\r\n" as the end of
/// the data, and the text after it as new commands.
fn dot_stuffed(raw: &[u8]) -> Vec<u8> {
  let text = String::from_utf8_lossy(raw).replace("\r\n", "\n").replace('\r', "\n");
  let mut out = Vec::with_capacity(raw.len() + 16);
  for (i, line) in text.split('\n').enumerate() {
    if i > 0 {
      out.extend_from_slice(b"\r\n");
    }
    if line.starts_with('.') {
      out.push(b'.');
    }
    out.extend_from_slice(line.as_bytes());
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::net::{TcpListener, TcpStream};
  use std::thread;

  /// Plays a script of (expected substring, reply) pairs after the greeting.
  fn fake_smtp(script: Vec<(&'static str, &'static str)>) -> TcpStream {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      socket.write_all(b"220 smtp.test ESMTP ready\r\n").unwrap();
      let mut reader = BufReader::new(socket.try_clone().unwrap());
      for (expect, reply) in script {
        let mut got = String::new();
        if expect == "<DATA>" {
          // Read until the lone dot.
          loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            got.push_str(&line);
            if line == ".\r\n" {
              break;
            }
          }
        } else {
          reader.read_line(&mut got).unwrap();
        }
        assert!(got.contains(expect.trim_start_matches('<').trim_end_matches('>')) || expect == "<DATA>", "expected {expect:?}, got {got:?}");
        if expect == "<DATA>" {
          assert!(got.contains("..hidden"), "dot-stuffed: {got:?}");
        }
        socket.write_all(reply.as_bytes()).unwrap();
      }
    });
    TcpStream::connect(addr).unwrap()
  }

  #[test]
  fn a_message_goes_out_with_every_step_answered() {
    let stream = fake_smtp(vec![
      ("EHLO", "250-smtp.test\r\n250 AUTH XOAUTH2\r\n"),
      ("AUTH XOAUTH2", "235 2.7.0 Accepted\r\n"),
      ("MAIL FROM:<vera@example.com>", "250 OK\r\n"),
      ("RCPT TO:<ann@x.test>", "250 OK\r\n"),
      ("RCPT TO:<bo@x.test>", "251 forwarded\r\n"),
      ("DATA", "354 go ahead\r\n"),
      ("<DATA>", "250 2.0.0 OK 1788445234 abc.123 - gsmtp\r\n"),
      ("QUIT", "221 bye\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    smtp.authenticate_xoauth2("vera@example.com", "tok").unwrap();
    let id = smtp
      .send(
        "vera@example.com",
        &["ann@x.test".into(), "'bo@x.test'".into()],
        b"Subject: hi\r\n\r\nline one\r\n.hidden dot line\r\n",
      )
      .unwrap();
    assert!(id.contains("gsmtp"));
    smtp.quit();
  }

  #[test]
  fn a_send_the_server_never_answers_is_unconfirmed_and_not_tried_again() {
    let stream = fake_smtp(vec![
      ("EHLO", "250-smtp.test\r\n250 AUTH XOAUTH2\r\n"),
      ("AUTH XOAUTH2", "235 2.7.0 Accepted\r\n"),
      ("MAIL FROM:<vera@example.com>", "250 OK\r\n"),
      ("RCPT TO:<ann@x.test>", "250 OK\r\n"),
      ("DATA", "354 go ahead\r\n"),
      // The message is taken in full and the answer never comes: the
      // server goes away.
      ("<DATA>", ""),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    smtp.authenticate_xoauth2("vera@example.com", "tok").unwrap();
    let err = smtp
      .send("vera@example.com", &["ann@x.test".into()], b"Subject: hi\r\n\r\n.hidden\r\n")
      .unwrap_err();
    assert!(matches!(err, SmtpError::Unconfirmed(_)), "{err}");
    assert!(err.is_permanent(), "handed back rather than sent again");
    assert!(err.to_string().contains("Check Sent"));
  }

  #[test]
  fn an_app_password_signs_in_with_auth_plain_and_a_refusal_is_an_auth_error() {
    let stream = fake_smtp(vec![
      ("EHLO", "250-smtp.test\r\n250 AUTH PLAIN XOAUTH2\r\n"),
      ("AUTH PLAIN", "235 2.7.0 Accepted\r\n"),
      ("QUIT", "221 bye\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    smtp.sign_in("vera@example.com", &crate::imap::Credential::Password("app pw".into())).unwrap();
    smtp.quit();

    let stream = fake_smtp(vec![
      ("EHLO", "250 smtp.test\r\n"),
      ("AUTH PLAIN", "535-5.7.8 Username and Password not accepted\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    let err = smtp.sign_in("vera@example.com", &crate::imap::Credential::Password("bad".into())).unwrap_err();
    assert!(err.is_auth(), "{err}");
  }

  #[test]
  fn a_refused_recipient_and_a_refused_sign_in_are_named() {
    let stream = fake_smtp(vec![
      ("EHLO", "250 smtp.test\r\n"),
      ("AUTH XOAUTH2", "334 eyJzdGF0dXMiOiI0MDEifQ==\r\n"),
      ("", "535-5.7.8 Username and Password not accepted\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    let err = smtp.authenticate_xoauth2("vera@example.com", "bad").unwrap_err();
    assert!(err.is_auth(), "{err}");
    assert!(err.to_string().contains("\"status\":\"401\""), "{err}");

    let stream = fake_smtp(vec![
      ("EHLO", "250 smtp.test\r\n"),
      ("MAIL FROM", "250 OK\r\n"),
      ("RCPT TO:<nobody@x.test>", "550 5.1.1 no such user\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    let err = smtp.send("vera@example.com", &["nobody@x.test".into()], b"x").unwrap_err();
    assert!(err.is_permanent());
    assert!(err.to_string().contains("nobody@x.test"), "{err}");
  }
  #[test]
  fn a_value_with_a_line_break_is_refused() {
    assert_eq!(single_line("a recipient address", "ann@x.test").unwrap(), "ann@x.test");
    for bad in ["ann@x.test\r\nRCPT TO:<eve@x.test>", "ann@x.test\n", "\rann@x.test", "ann\0@x.test"] {
      let err = single_line("a recipient address", bad).unwrap_err();
      assert!(matches!(err, SmtpError::LineBreak(_)), "{bad:?}");
      // The error does not repeat the address: it goes to the log.
      assert!(!err.to_string().contains("ann"), "{err}");
      assert!(err.is_permanent());
    }
  }

  #[test]
  fn a_recipient_with_a_line_break_stops_the_send_before_any_command() {
    let stream = fake_smtp(vec![
      ("EHLO", "250 smtp.test\r\n"),
      // The next line that the server reads must be QUIT, not MAIL FROM.
      ("QUIT", "221 bye\r\n"),
    ]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    let recipients = vec!["ann@x.test".to_string(), "bo@x.test>\r\nRCPT TO:<eve@x.test".to_string()];
    let err = smtp.send("vera@example.com", &recipients, b"Subject: hi\r\n\r\nx\r\n").unwrap_err();
    assert!(matches!(err, SmtpError::LineBreak(_)), "{err}");
    smtp.command("QUIT", 221).expect("nothing else went to the server");
  }

  #[test]
  fn a_sender_or_a_command_with_a_line_break_is_refused() {
    let stream = fake_smtp(vec![("EHLO", "250 smtp.test\r\n"), ("QUIT", "221 bye\r\n")]);
    let mut smtp = Smtp::connect_plain(stream).unwrap();
    let err = smtp.send("vera@example.com\r\nDATA", &["ann@x.test".into()], b"x").unwrap_err();
    assert!(matches!(err, SmtpError::LineBreak(_)), "{err}");
    let err = smtp.command("NOOP\r\nRSET", 250).unwrap_err();
    assert!(matches!(err, SmtpError::LineBreak(_)), "{err}");
    smtp.command("QUIT", 221).expect("nothing else went to the server");
  }

  #[test]
  fn a_bare_carriage_return_cannot_end_the_data() {
    assert_eq!(dot_stuffed(b"a\r.\r\nMAIL FROM:<x>"), b"a\r\n..\r\nMAIL FROM:<x>".to_vec());
    assert_eq!(dot_stuffed(b"a\n.\nb"), b"a\r\n..\r\nb".to_vec());
  }

  #[test]
  fn the_log_text_of_a_refusal_names_no_recipient() {
    let err = SmtpError::Refused { code: 550, text: "nobody@x.test: no such user".into() };
    assert!(err.to_string().contains("nobody@x.test"), "the reader still sees it");
    assert_eq!(err.for_log(), "the server refused with 550");
  }
}
