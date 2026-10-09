//! Tests for ews_oof.rs, against the fake server in ews_fixtures.rs.

use std::sync::{Arc, Mutex};

use super::*;
use crate::ews_fixtures::*;

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

fn reply(state: &str, start: Option<&str>, end: Option<&str>) -> AutoReply {
  AutoReply {
    state: state.into(),
    external_audience: "Known".into(),
    start: start.map(Into::into),
    end: end.map(Into::into),
    internal: "<p>Away until Monday. Ask Dana & Kim.</p>".into(),
    external: "<p>Away until Monday. Ask Dana & Kim.</p>".into(),
  }
}

/// A reply as `GetUserOofSettings` gives it: a whole HTML document.
fn as_exchange_gives_it(fragment: &str) -> String {
  if fragment.is_empty() {
    return String::new();
  }
  // `oof_answer` escapes it for the XML.
  format!(
    "<html dir=\"ltr\"><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"></head><body>{fragment}</body></html>"
  )
}

/// A server that keeps what is set, and gives it back on a get.
fn keeping_handler() -> (Handler, Arc<Mutex<String>>) {
  let kept = Arc::new(Mutex::new(oof_answer("Disabled", "All", "2026-09-20T08:00:00", "2026-09-21T08:00:00", "", "")));
  let store = kept.clone();
  let handler: Handler = Arc::new(move |operation, body| match operation {
    "GetUserOofSettingsRequest" => (200, store.lock().unwrap().clone()),
    "SetUserOofSettingsRequest" => {
      let text = |n: &str| crate::ews::element_text(body, n).unwrap_or_default();
      let settings = crate::ews_xml::inner(body, "UserOofSettings").unwrap();
      let message = |which: &str| {
        crate::ews_xml::inner(settings, which).and_then(|r| crate::ews::element_text(r, "Message")).unwrap_or_default()
      };
      *store.lock().unwrap() = oof_answer(
        &text("OofState"),
        &text("ExternalAudience"),
        // Exchange gives the times back with no zone.
        text("StartTime").trim_end_matches('Z'),
        text("EndTime").trim_end_matches('Z'),
        // Exchange gives a reply back as a whole HTML document.
        &as_exchange_gives_it(&message("InternalReply")),
        &as_exchange_gives_it(&message("ExternalReply")),
      );
      (200, oof_set_answer())
    }
    _ => (500, fault("ErrorInvalidRequest", "The request is invalid.")),
  });
  (handler, kept)
}

#[test]
fn the_reply_is_read_with_its_messages_unescaped() {
  let (handler, kept) = keeping_handler();
  *kept.lock().unwrap() = oof_answer(
    "Scheduled",
    "Known",
    "2026-10-01T08:00:00",
    "2026-10-08T08:00:00",
    "<html><body>Away &amp; back soon</body></html>",
    "",
  );
  let server = serve(handler);
  let got = run(get(&client(&server.url), OWN_ADDRESS)).unwrap();
  assert_eq!(got.state, "Scheduled");
  assert_eq!(got.external_audience, "Known");
  assert_eq!(got.start.as_deref(), Some("2026-10-01T08:00:00"));
  assert_eq!(got.end.as_deref(), Some("2026-10-08T08:00:00"));
  // Only the body of the document: that is what the server takes back.
  assert_eq!(got.internal, "Away &amp; back soon");
  // An empty `<Message/>` is an empty reply, not the internal one.
  assert_eq!(got.external, "");
}

#[test]
fn a_scheduled_reply_is_set_and_read_back() {
  let (handler, _) = keeping_handler();
  let server = serve(handler);
  let want = reply("Scheduled", Some("2026-10-01T08:00:00Z"), Some("2026-10-08T08:00:00Z"));
  let got = run(set(&client(&server.url), OWN_ADDRESS, &want)).unwrap();
  assert_eq!(got.state, "Scheduled");
  assert_eq!(got.internal, want.internal);
  assert_eq!(got.external_audience, "Known");
  let sent = server.requests.lock().unwrap()[0].clone();
  // The HTML goes as escaped text, and the children in the schema's order.
  assert!(sent.contains("&lt;p&gt;Away until Monday. Ask Dana &amp; Kim.&lt;/p&gt;"), "{sent}");
  assert!(sent.find("<t:OofState>").unwrap() < sent.find("<t:ExternalAudience>").unwrap());
  assert!(sent.find("<t:Duration>").unwrap() < sent.find("<t:InternalReply>").unwrap());
}

#[test]
fn an_always_on_reply_is_set_with_no_times() {
  let (handler, _) = keeping_handler();
  let server = serve(handler);
  let got = run(set(&client(&server.url), OWN_ADDRESS, &reply("Enabled", None, None))).unwrap();
  assert_eq!(got.state, "Enabled");
  assert!(!server.requests.lock().unwrap()[0].contains("<t:Duration>"));
}

#[test]
fn a_bad_schedule_is_refused_before_any_call() {
  let (handler, _) = keeping_handler();
  let server = serve(handler);
  let c = client(&server.url);
  let no_end = run(set(&c, OWN_ADDRESS, &reply("Scheduled", Some("2026-10-01T08:00:00Z"), None))).unwrap_err();
  assert_eq!(no_end.code(), "ews:invalid");
  let backwards = reply("Scheduled", Some("2026-10-08T08:00:00Z"), Some("2026-10-01T08:00:00Z"));
  assert_eq!(run(set(&c, OWN_ADDRESS, &backwards)).unwrap_err().code(), "ews:invalid");
  let unknown = AutoReply { state: "On".into(), ..reply("Enabled", None, None) };
  assert_eq!(run(set(&c, OWN_ADDRESS, &unknown)).unwrap_err().code(), "ews:invalid");
  assert_eq!(server.requests.lock().unwrap().len(), 0);
}

#[test]
fn the_server_refuses_another_mailbox() {
  let (handler, _) = keeping_handler();
  let server = serve(handler);
  let err = run(get(&client(&server.url), "dana@example.com")).unwrap_err();
  assert!(err.to_string().contains("ErrorAccessDenied"), "{err}");
}

#[test]
fn the_fake_server_refuses_what_the_real_one_does() {
  let (handler, _) = keeping_handler();
  let server = serve(handler);
  let c = client(&server.url);
  // Scheduled with no times, past the check above: the server says no.
  let body = set_request(OWN_ADDRESS, &reply("Enabled", None, None)).unwrap().replace(">Enabled<", ">Scheduled<");
  let err = run(c.call(&body)).unwrap_err();
  assert!(err.to_string().contains("ErrorInvalidScheduledOofDuration"), "{err}");
  // The children out of order.
  let good = set_request(OWN_ADDRESS, &reply("Enabled", None, None)).unwrap();
  let swapped = good
    .replace("<t:OofState>Enabled</t:OofState>", "")
    .replace("</t:ExternalAudience>", "</t:ExternalAudience><t:OofState>Enabled</t:OofState>");
  let err = run(c.call(&swapped)).unwrap_err();
  assert!(err.to_string().contains("ErrorSchemaValidation"), "{err}");
  // A type element with no prefix.
  let err = run(c.call(&good.replace("t:OofState", "OofState"))).unwrap_err();
  assert!(err.to_string().contains("ErrorSchemaValidation"), "{err}");
}

#[test]
fn a_reply_read_back_can_be_saved_again() {
  // Seen on KU: the reply as the server gave it could not be saved again.
  let (handler, _kept) = keeping_handler();
  let server = serve(handler);
  let client = client(&server.url);
  let mut on = reply("Enabled", None, None);
  on.internal = "<p>Away</p>".into();
  on.external = "<p>Away</p>".into();
  let first = run(set(&client, OWN_ADDRESS, &on)).unwrap();
  assert_eq!(first.internal, "<p>Away</p>");
  let again = AutoReply { external_audience: "Known".into(), ..first };
  let second = run(set(&client, OWN_ADDRESS, &again)).unwrap();
  assert_eq!(second.external_audience, "Known");
  assert_eq!(second.internal, "<p>Away</p>");
}

