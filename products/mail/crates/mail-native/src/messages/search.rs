//! The search box: what was typed, read as an FTS query and filters.

use super::*;

/// What a search asks for, read from what was typed.
#[derive(Debug, Default, PartialEq)]
pub struct SearchPlan {
  /// The FTS5 query; empty when only the filters below narrow the list.
  pub fts: String,
  /// Sent at or after this (ms), from `after:` or `newer_than:`.
  pub after: Option<i64>,
  /// Sent before this (ms), from `before:` or `older_than:`.
  pub before: Option<i64>,
  /// Only mail with a file attached, from `has:attachment`.
  pub attachment: bool,
  /// Labels a message must carry, or must not, from `in:`, `label:`,
  /// `is:starred`, and `is:important`.
  pub labels: Vec<LabelTerm>,
  /// Read state, from `is:unread` (true) or `is:read` (false).
  pub unread: Option<bool>,
  /// Parts of a file's name, from `filename:`; true leaves them out.
  pub filenames: Vec<(String, bool)>,
  /// `in:trash` or `in:spam`: rows the list otherwise hides.
  pub hidden: Option<HiddenPlace>,
}

/// One `in:` or `label:` word: a system label, or a label of the reader's
/// own, in Gmail's spelling of it (see `label_key`).
#[derive(Debug, PartialEq)]
pub struct LabelTerm {
  pub system: Option<&'static str>,
  pub key: String,
  pub negated: bool,
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum HiddenPlace {
  Trash,
  Spam,
}

impl SearchPlan {
  pub fn is_empty(&self) -> bool {
    self.fts.is_empty()
      && self.after.is_none()
      && self.before.is_none()
      && !self.attachment
      && self.labels.is_empty()
      && self.unread.is_none()
      && self.filenames.is_empty()
      && self.hidden.is_none()
  }
}

/// Keys the copy cannot answer. A query with one goes to the provider,
/// which speaks them. `in:`, `label:`, `is:`, and `has:` are here for the
/// values the copy does not know (`in:anywhere`, `is:muted`, `has:drive`).
const PROVIDER_KEYS: &[&str] = &[
  "in", "label", "is", "has", "larger", "smaller", "size", "category", "list", "deliveredto",
  "bcc", "rfc822msgid",
];
const LOCAL_KEYS: &[&str] =
  &["from", "to", "cc", "subject", "after", "before", "newer_than", "older_than", "filename"];

/// A label name as Gmail's search spells it: lower case, with a space, a
/// slash, or a dash all one dash. `label:work-stuff` finds "Work stuff",
/// and `label:clients-oxford` finds "Clients/Oxford".
///
/// Lower case for A to Z only, as SQLite's LOWER is, so the two sides of
/// the comparison agree on a label like "Ærø".
pub fn label_key(name: &str) -> String {
  name.trim().to_ascii_lowercase().replace([' ', '/', '_'], "-")
}

/// The system label an `in:` or `label:` word names, if it names one.
fn system_label(word: &str) -> Option<&'static str> {
  Some(match word.to_ascii_lowercase().as_str() {
    "inbox" => INBOX,
    "sent" => SENT,
    "draft" | "drafts" => DRAFT,
    "starred" => STARRED,
    "important" => IMPORTANT,
    "trash" | "bin" => TRASH,
    "spam" | "junk" => SPAM,
    _ => return None,
  })
}

/// The words as typed, read as a search over the copy.
///
/// Plain words are required prefixes; "a phrase" is kept whole; `from:`,
/// `to:`, `cc:`, and `subject:` look in one column; `-word` leaves out;
/// `OR` between two words takes either; `has:attachment`, `before:`,
/// `after:`, `newer_than:`, and `older_than:` narrow by what the table
/// knows. The same words Gmail reads, so nobody learns a second language.
///
/// `in:` and `label:` (a folder, or a label of the reader's own),
/// `is:unread`, `is:read`, `is:starred`, `is:important`, and `filename:`
/// are answered from the copy too: it holds every message's labels and
/// read state, and the names of the files in the mail whose bodies it
/// holds (the last 12 months; older mail is asked for by "Older mail").
///
/// `None` when the query asks something only the provider can answer —
/// `in:anywhere`, `is:muted`, `larger:`, and the rest — so the caller asks
/// the provider.
pub fn parse_search(q: &str) -> Option<SearchPlan> {
  let mut plan = SearchPlan::default();
  let mut positives: Vec<String> = Vec::new();
  let mut negatives: Vec<String> = Vec::new();
  let mut or_next = false;
  for raw in split_search(q) {
    if raw == "OR" {
      or_next = !positives.is_empty();
      continue;
    }
    if raw == "AND" {
      continue;
    }
    let (neg, rest) = match raw.strip_prefix('-') {
      Some(r) if !r.is_empty() => (true, r),
      _ => (false, raw.as_str()),
    };
    // `key:value`, when the key is one anybody's mail search knows. A
    // colon in anything else — a URL, a time — is part of the word.
    let (key, value) = match rest.split_once(':') {
      Some((k, v)) if !rest.starts_with('"') => {
        let lower = k.to_ascii_lowercase();
        if LOCAL_KEYS.contains(&lower.as_str()) || PROVIDER_KEYS.contains(&lower.as_str()) {
          (Some(lower), v)
        } else {
          (None, rest)
        }
      }
      _ => (None, rest),
    };
    let (phrase, text) = match value.strip_prefix('"') {
      Some(v) => (true, v.strip_suffix('"').unwrap_or(v)),
      None => (false, value),
    };
    match key.as_deref() {
      None | Some("from") | Some("to") | Some("cc") | Some("subject") => {
        let Some(term) = fts_term(text, phrase) else { continue };
        let column = match key.as_deref() {
          Some("from") => "from_text: ",
          Some("to") | Some("cc") => "to_text: ",
          Some("subject") => "subject: ",
          _ => "",
        };
        let piece = format!("{column}{term}");
        if neg {
          negatives.push(piece);
        } else if or_next {
          // Grouped, so `a b OR c` reads as Gmail reads it: a, and one of b or c.
          let last = positives.pop().unwrap_or_default();
          positives.push(format!("({last} OR {piece})"));
          or_next = false;
        } else {
          positives.push(piece);
        }
      }
      Some("has") if text.eq_ignore_ascii_case("attachment") && !neg => plan.attachment = true,
      Some("in") | Some("label") => {
        if text.trim().is_empty() || text.eq_ignore_ascii_case("anywhere") {
          return None;
        }
        let system = system_label(text);
        let place = match system {
          Some(TRASH) => Some(HiddenPlace::Trash),
          Some(SPAM) => Some(HiddenPlace::Spam),
          _ => None,
        };
        if let (Some(place), false) = (place, neg) {
          // In two hidden places at once is in neither: the provider says so.
          if plan.hidden.is_some_and(|had| had != place) {
            return None;
          }
          plan.hidden = Some(place);
        }
        plan.labels.push(LabelTerm { system, key: label_key(text), negated: neg });
      }
      Some("is") => match text.to_ascii_lowercase().as_str() {
        "unread" => plan.unread = Some(!neg),
        "read" => plan.unread = Some(neg),
        "starred" | "important" => {
          let system = system_label(text);
          plan.labels.push(LabelTerm { system, key: label_key(text), negated: neg });
        }
        _ => return None,
      },
      Some("filename") => {
        let part = text.trim().to_lowercase();
        if part.is_empty() {
          return None;
        }
        plan.filenames.push((part, neg));
      }
      Some("after") if !neg => plan.after = Some(parse_day(text)?),
      Some("before") if !neg => plan.before = Some(parse_day(text)?),
      Some("newer_than") if !neg => plan.after = Some(now_ms() - parse_span_ms(text)?),
      Some("older_than") if !neg => plan.before = Some(now_ms() - parse_span_ms(text)?),
      Some(_) => return None,
    }
  }
  // Nothing to take away from: the provider can list a whole mailbox
  // less a word; the index cannot.
  if positives.is_empty() && !negatives.is_empty() {
    return None;
  }
  let mut fts = positives.join(" ");
  for n in negatives {
    fts.push_str(" NOT ");
    fts.push_str(&n);
  }
  plan.fts = fts;
  Some(plan)
}

/// Words split on spaces, except that a quoted span stays one word.
fn split_search(q: &str) -> Vec<String> {
  let mut out = Vec::new();
  let mut cur = String::new();
  let mut quoted = false;
  for c in q.chars() {
    if c == '"' {
      quoted = !quoted;
      cur.push(c);
      continue;
    }
    if c.is_whitespace() && !quoted {
      if !cur.is_empty() {
        out.push(std::mem::take(&mut cur));
      }
      continue;
    }
    cur.push(c);
  }
  if !cur.is_empty() {
    out.push(cur);
  }
  out
}

/// One FTS5 term: a quoted prefix for a word, a quoted phrase as it was.
/// Quotes inside are doubled, as FTS wants.
fn fts_term(text: &str, phrase: bool) -> Option<String> {
  if phrase {
    let t = text.trim();
    if t.is_empty() {
      return None;
    }
    return Some(format!("\"{}\"", t.replace('"', "\"\"")));
  }
  let cleaned =
    text.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_');
  if cleaned.is_empty() {
    return None;
  }
  Some(format!("\"{}\"*", cleaned.replace('"', "\"\"")))
}

/// What the reader typed, as an FTS5 query. Empty for a query the copy
/// does not answer.
pub fn fts_query(q: &str) -> String {
  parse_search(q).map(|p| p.fts).unwrap_or_default()
}

/// `2026-01-15` or `2026/01/15` as the ms of that day's start, UTC. A day
/// is coarse enough that the zone does not matter.
fn parse_day(text: &str) -> Option<i64> {
  let parts: Vec<&str> = text.split(['-', '/']).collect();
  if parts.len() != 3 || parts[0].len() != 4 {
    return None;
  }
  let y: i64 = parts[0].parse().ok()?;
  let m: u32 = parts[1].parse().ok()?;
  let d: u32 = parts[2].parse().ok()?;
  if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
    return None;
  }
  Some(days_from_civil(y, m, d) * 86_400_000)
}

/// Days since 1970-01-01 for a calendar date (Howard Hinnant's algorithm).
pub(super) fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
  let doy = (153 * mp + 2) / 5 + d as i64 - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

/// `7d`, `2w`, `3m`, `1y` as ms, the way Gmail reads them.
fn parse_span_ms(text: &str) -> Option<i64> {
  let (num, unit) = text.split_at(text.len().checked_sub(1)?);
  let n: i64 = num.parse().ok()?;
  let days = match unit {
    "d" => 1,
    "w" => 7,
    "m" => 30,
    "y" => 365,
    _ => return None,
  };
  Some(n * days * 86_400_000)
}
