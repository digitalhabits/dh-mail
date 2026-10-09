//! Tests for ews_directory.rs, against the fake server in ews_fixtures.rs.

use std::sync::Arc;

use super::*;
use crate::ews_fixtures::*;

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
  tauri::async_runtime::block_on(future)
}

const PEOPLE: [DirEntry; 5] = [
  // An old account: no department and no job title.
  DirEntry { alias: "abc101", display: "Dana Alumna", email: "dana.alumna@example.com", routing: "SMTP", department: None, job_title: None },
  DirEntry {
    alias: "abc102",
    display: "Dana Example",
    email: "Dana.Example@example.com",
    routing: "SMTP",
    department: Some("Department of Examples"),
    job_title: Some("Professor"),
  },
  DirEntry {
    alias: "abc103",
    display: "Dana Sample",
    email: "dana.sample@example.com",
    routing: "SMTP",
    department: Some("Department of Samples"),
    job_title: None,
  },
  // A list with no SMTP address, as a directory can hold.
  DirEntry { alias: "dana-team", display: "Dana Team", email: "/o=Example/ou=Lists/cn=dana-team", routing: "EX", department: None, job_title: None },
  // No contact name at all: the mailbox's name stands in.
  DirEntry { alias: "abc104", display: "", email: "dana.nameless@example.com", routing: "SMTP", department: None, job_title: None },
];

fn directory() -> Handler {
  Arc::new(|_, body| {
    let text = crate::ews::element_text(body, "UnresolvedEntry").unwrap_or_default().to_lowercase();
    let full = body.contains(r#"ReturnFullContactData="true""#);
    let hits: Vec<&DirEntry> =
      PEOPLE.iter().filter(|p| p.display.to_lowercase().contains(&text) || p.email.to_lowercase().contains(&text)).collect();
    (200, resolve_answer(&hits, full))
  })
}

#[test]
fn many_matches_come_back_with_their_addresses() {
  let server = serve(directory());
  let people = run(resolve(&client(&server.url), "dana")).unwrap();
  // The contact's name, not the user id. Staff first, then the rest, each
  // in the server's order.
  let names: Vec<&str> = people.iter().map(|p| p.name.as_str()).collect();
  assert_eq!(names, vec!["Dana Example", "Dana Sample", "Dana Alumna", "abc104"]);
  assert_eq!(people[0].email, "dana.example@example.com");
  let sent = server.requests.lock().unwrap()[0].clone();
  assert!(sent.contains(r#"ReturnFullContactData="true""#), "{sent}");
  assert!(sent.contains(r#"SearchScope="ActiveDirectory""#), "{sent}");
  assert!(sent.contains("<UnresolvedEntry>dana</UnresolvedEntry>"), "{sent}");
}

#[test]
fn one_match_and_no_match() {
  let server = serve(directory());
  let c = client(&server.url);
  assert_eq!(run(resolve(&c, "sample")).unwrap(), vec![Person { name: "Dana Sample".into(), email: "dana.sample@example.com".into() }]);
  assert!(run(resolve(&c, "nobody")).unwrap().is_empty());
}

#[test]
fn short_text_asks_nothing() {
  let server = serve(directory());
  assert_eq!(run(resolve(&client(&server.url), " da ")).unwrap_err().code(), "ews:invalid");
  assert_eq!(server.requests.lock().unwrap().len(), 0);
}

#[test]
fn the_text_is_escaped() {
  let request = resolve_request("Dana & <Kim>").unwrap();
  assert!(request.contains("<UnresolvedEntry>Dana &amp; &lt;Kim&gt;</UnresolvedEntry>"), "{request}");
}

#[test]
fn another_error_is_an_error() {
  let server = serve(Arc::new(|_, _| (200, response("ResolveNames", &[error("ResolveNames", "ErrorAccessDenied", "Access is denied.")]))));
  let err = run(resolve(&client(&server.url), "dana")).unwrap_err();
  assert!(err.to_string().contains("ErrorAccessDenied"), "{err}");
}

#[test]
fn the_fake_server_refuses_what_the_real_one_does() {
  let server = serve(directory());
  let c = client(&server.url);
  let good = resolve_request("dana").unwrap();
  for bad in [
    good.replace(r#" ReturnFullContactData="true""#, ""),
    good.replace(r#"ReturnFullContactData="true""#, r#"ReturnFullContactData="yes""#),
    good.replace("UnresolvedEntry>", "t:UnresolvedEntry>"),
  ] {
    let err = run(c.call_many(&bad)).unwrap_err();
    assert!(err.to_string().contains("ErrorSchemaValidation"), "{err}");
  }
}

#[test]
fn the_cut_to_eight_comes_after_the_staff_are_put_first() {
  // Ten old accounts first in the server's order, then one member of staff.
  let mut set = String::new();
  for n in 0..10 {
    set.push_str(&format!(
      "<t:Resolution><t:Mailbox><t:Name>old{n}</t:Name><t:EmailAddress>old{n}@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType></t:Mailbox><t:Contact><t:DisplayName>Old {n}</t:DisplayName></t:Contact></t:Resolution>"
    ));
  }
  set.push_str("<t:Resolution><t:Mailbox><t:Name>new1</t:Name><t:EmailAddress>new1@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType></t:Mailbox><t:Contact><t:DisplayName>New One</t:DisplayName><t:JobTitle>Lecturer</t:JobTitle></t:Contact></t:Resolution>");
  let xml = format!(
    r#"<m:ResolveNamesResponseMessage ResponseClass="Warning"><m:ResponseCode>ErrorNameResolutionMultipleResults</m:ResponseCode><m:ResolutionSet>{set}</m:ResolutionSet></m:ResolveNamesResponseMessage>"#
  );
  let people = read_people(&xml).unwrap();
  assert_eq!(people.len(), MAX_PEOPLE);
  assert_eq!(people[0].name, "New One");
}

/// A directory record as `ReturnFullContactData` gives it, with the
/// mailbox's other addresses in `EmailAddresses`. Invented addresses.
fn own_answer(records: &[(&str, &[&str])]) -> String {
  let set: String = records
    .iter()
    .map(|(mailbox, entries)| {
      let list: String = entries
        .iter()
        .enumerate()
        .map(|(i, e)| format!(r#"<t:Entry Key="EmailAddress{}">{e}</t:Entry>"#, i + 1))
        .collect();
      format!(
        concat!(
          "<t:Resolution><t:Mailbox><t:Name>{name}</t:Name><t:EmailAddress>{mailbox}</t:EmailAddress>",
          "<t:RoutingType>SMTP</t:RoutingType></t:Mailbox><t:Contact><t:DisplayName>Kim Example</t:DisplayName>",
          "<t:EmailAddresses>{list}</t:EmailAddresses></t:Contact></t:Resolution>"
        ),
        name = mailbox.split('@').next().unwrap_or(""),
        mailbox = mailbox,
        list = list
      )
    })
    .collect();
  format!(
    r#"<m:ResolveNamesResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:ResolutionSet>{set}</m:ResolutionSet></m:ResolveNamesResponseMessage>"#
  )
}

#[test]
fn the_mailbox_record_gives_every_address_it_sends_as() {
  // Signs in as abc123@uni.example, sends as kim.example@dept.uni.example.
  let xml = own_answer(&[(
    "kim.example@dept.uni.example",
    &["SMTP:kim.example@dept.uni.example", "smtp:abc123@uni.example", "X500:/o=Uni/cn=abc123", "SIP:kim@uni.example"],
  )]);
  assert_eq!(
    read_own_addresses(&xml, "ABC123@uni.example"),
    vec!["kim.example@dept.uni.example".to_string(), "abc123@uni.example".to_string()]
  );
}

#[test]
fn only_the_record_holding_the_account_counts() {
  // Two people match the text; the one who is not the account is ignored.
  let xml = own_answer(&[
    ("someone.else@uni.example", &["SMTP:someone.else@uni.example"]),
    ("kim.example@dept.uni.example", &["SMTP:kim.example@dept.uni.example", "smtp:abc123@uni.example"]),
  ]);
  let found = read_own_addresses(&xml, "abc123@uni.example");
  assert!(!found.contains(&"someone.else@uni.example".to_string()), "{found:?}");
  assert!(found.contains(&"kim.example@dept.uni.example".to_string()), "{found:?}");
  // No record holds the account: nothing is learned.
  assert!(read_own_addresses(&own_answer(&[("someone.else@uni.example", &[])]), "abc123@uni.example").is_empty());
}

#[test]
fn a_record_named_by_the_user_id_counts_when_it_does_not_list_the_address() {
  // As on KU: the record of abc123@dept.uni.example lists other addresses,
  // and its mailbox Name is the user id.
  let xml = own_answer(&[
    ("someone.abc1234@uni.example", &["SMTP:someone.abc1234@uni.example"]),
    ("kim.example@dept.uni.example", &["SMTP:kim.example@dept.uni.example", "smtp:abc123@uni.example"]),
  ])
  .replacen("<t:Name>kim.example</t:Name>", "<t:Name>abc123</t:Name>", 1);
  let found = read_own_addresses(&xml, "abc123@dept.uni.example");
  assert_eq!(
    found,
    vec![
      "kim.example@dept.uni.example".to_string(),
      "abc123@uni.example".to_string(),
      "abc123@dept.uni.example".to_string()
    ]
  );
}
