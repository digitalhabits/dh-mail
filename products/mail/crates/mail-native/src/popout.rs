//! The chat popouts: a thread as a small always-on-top window.
//!
//! Both hosts have them. The mail interface asks for one, and the popout is
//! the same document the interface came from, told to render one thread
//! (`index.html?popout=1&…`). See `apps/mail/src/main.tsx`.

use tauri::Manager;

/*
  The chat popout is a non-activating panel on macOS.

  A click on an ordinary window brings its application to the front, and
  whatever was in front goes behind. Over a slideshow that is not a small
  thing: PowerPoint stops the video it is playing the moment it stops
  being frontmost, so clicking the chat to answer somebody stopped the
  film. Nothing passed through — the click never reached PowerPoint at
  all; the activation did the damage.

  A non-activating panel can be clicked, typed in and dragged without its
  application taking the front. Only an NSPanel may carry that style bit,
  so the window Tauri built is reclassed into one afterwards.

  The planner's focus popout is the same arrangement, and two things it
  learned the hard way are followed here: a panel wants a nudge on hover,
  so the first click lands on a control rather than only waking the
  window; and a panel does not survive `close()`, so it is hidden instead
  and reopened by pointing the hidden window at the thread asked for.
*/
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
  panel!(ChatPopoutPanel {
    config: {
      can_become_key_window: true,
      can_become_main_window: false,
      needs_panel_to_become_key: true,
      accepts_first_responder: true,
      becomes_key_only_if_needed: true,
      works_when_modal: true,
      is_floating_panel: true
    }
  })

  panel_event!(ChatPopoutPanelEventHandler {})
}

/// Reclass one built popout window into a floating, non-activating panel.
#[cfg(target_os = "macos")]
fn present_as_panel(app: &tauri::AppHandle, label: &str) {
  use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
  };

  let Some(window) = app.get_webview_window(label) else {
    return;
  };
  if window.to_panel::<ChatPopoutPanel>().is_err() {
    log::warn!("chat popout: no NSPanel for it — leaving it an ordinary window");
    return;
  }
  let Ok(panel) = app.get_webview_panel(label) else {
    return;
  };
  panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().value());
  panel.set_level(PanelLevel::Floating.value());
  // Over a full-screen app, and on whichever space the reader is on.
  panel.set_collection_behavior(
    CollectionBehavior::new()
      .can_join_all_spaces()
      .full_screen_auxiliary()
      .value(),
  );
  panel.set_floating_panel(true);
  panel.order_front_regardless();

  /*
    The nudge. A non-activating panel does not take the key window on a
    click, so the first click on a button was spent waking the window and
    the button never saw it. Taking key as the pointer arrives makes the
    click that follows the button's.
  */
  let handler = ChatPopoutPanelEventHandler::new();
  let app_handle = app.clone();
  let panel_label = label.to_string();
  handler.on_mouse_entered(move |_event| {
    if let Ok(panel) = app_handle.get_webview_panel(&panel_label) {
      panel.make_key_window();
    }
  });
  panel.set_event_handler(Some(handler.as_ref()));
}

/// Origins the team shell may treat as its own.
///
/// Not the standalone build: its interface is served from the app itself, on a
/// custom scheme, and everything guarded here belongs to the thin shell — the
/// boot splash overlay and the chat popout, which both assume a server routing
/// the URLs they build.
const CHAT_POPOUT_WIDTH: f64 = 380.0;
const CHAT_POPOUT_EXPANDED_HEIGHT: f64 = 560.0;
// Kept in step with CHAT_POPOUT_COLLAPSED_HEIGHT in popout.ts: this is the
// window's minimum and the clamp on a resize, so the page cannot fold
// smaller than whatever this says.
const CHAT_POPOUT_COLLAPSED_HEIGHT: f64 = 56.0;

/// One popout per thread. Tauri labels only allow [a-zA-Z0-9-/:_], so
/// percent-encode the account|thread pair and swap the leftovers.
fn window_safe_thread_key(account: &str, thread_id: &str) -> String {
  urlencoding::encode(&format!("{account}|{thread_id}"))
    .replace('%', "_")
    .replace('.', "_2E")
    .replace('~', "_7E")
}

fn chat_popout_label(account: &str, thread_id: &str) -> String {
  format!("chat-{}", window_safe_thread_key(account, thread_id))
}

/// Where the document that asked for a window lives.
///
/// The window that opens is the same document the asker came from, told to
/// render something else. Its directory is where index.html is:
/// tauri://localhost/ in the standalone, tauri://localhost/mail/ in the
/// Planner Mac app's pane, a Vite port in development. So a new window's URL
/// is that directory's index.html, whatever the origin.
fn document_origin(webview: &tauri::Webview) -> Result<String, String> {
  let current = webview.url().map_err(|e| e.to_string())?;
  let base = current
    .join("index.html")
    .map_err(|e| format!("Bad window base: {e}"))?;
  let mut origin = base.to_string();
  if let Some(idx) = origin.rfind("/index.html") {
    origin.truncate(idx);
  }
  Ok(origin)
}

/// Where a popped-out thread reads its window from.
///
/// The team build asks a server for a page, and the server routes the path.
/// The standalone has no server and no router: one index.html answers
/// everything, so the popout is that same document told to render something
/// else, and `popout=1` is what tells it. Sending the standalone to
/// `/mail-popout` gets nothing back.
///
/// Every value is percent-encoded. A subject line is written by whoever sent
/// the message, and it lands in a URL.
#[allow(clippy::too_many_arguments)]
fn popout_url(
  origin: &str,
  account: &str,
  thread_id: &str,
  name: &str,
  email: &str,
  subject: &str,
) -> String {
  let query = format!(
    "account={}&thread={}&name={}&email={}&subject={}",
    urlencoding::encode(account),
    urlencoding::encode(thread_id),
    urlencoding::encode(name),
    urlencoding::encode(email),
    urlencoding::encode(subject),
  );
  format!("{origin}/index.html?popout=1&{query}")
}

/// Open (or refocus) an always-on-top floating chat window for a mail thread.
/// The window loads `/mail-popout` on the same origin as the invoking window,
/// so it talks to the same origin as the main window.
#[tauri::command]
pub async fn open_chat_popout(
  app: tauri::AppHandle,
  webview: tauri::Webview,
  account: String,
  thread_id: String,
  name: String,
  email: String,
  subject: String,
  user_agent: String,
) -> Result<(), String> {
  use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

  let origin = document_origin(&webview)?;
  let label = chat_popout_label(&account, &thread_id);
  /*
    From a reader window, the pop-out takes the reader's place.

    A reader window holds this one thread already. Popping it out from
    there means "make this the floating chat", not "open a second window
    for the same conversation" — so the panel opens where the reader is,
    and the reader closes once the panel is up. Bringing it back lands
    in the main window, which is where a thread with no reader goes.
  */
  let reader = webview.label().starts_with("reader-").then(|| webview.window());

  let url = popout_url(
    &origin,
    &account,
    &thread_id,
    &name,
    &email,
    &subject,
  );
  let parsed: tauri::Url = url.parse().map_err(|e| format!("Bad popout URL: {e}"))?;

  /*
    One window per thread, shown again rather than built again.

    A panel does not survive being closed, so closing one hides it (see
    `close_chat_popout`). A hidden window is therefore the ordinary state
    of a thread popped out once and dismissed, and popping it out again
    points it at the thread and shows it — the same page, told what to
    render, which is how the popout works to begin with.
  */
  if let Some(existing) = app.get_webview_window(&label) {
    let _ = existing.navigate(parsed.clone());
    if let Some(reader) = &reader {
      if let (Ok(pos), Ok(scale)) = (reader.outer_position(), reader.scale_factor()) {
        let _ = existing.set_position(pos.to_logical::<f64>(scale));
      }
    }
    let _ = existing.show();
    // AppKit's window work belongs to the main thread; this command runs
    // on a worker, and ordering a panel from there aborted the app.
    let app2 = app.clone();
    let label2 = label.clone();
    let _ = app.run_on_main_thread(move || {
      #[cfg(target_os = "macos")]
      {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app2.get_webview_panel(&label2) {
          panel.order_front_regardless();
          panel.make_key_window();
          if let Some(reader) = reader {
            let _ = reader.close();
          }
          return;
        }
      }
      if let Some(window) = app2.get_webview_window(&label2) {
        let _ = window.set_focus();
      }
      if let Some(reader) = reader {
        let _ = reader.close();
      }
    });
    return Ok(());
  }

  let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
    .title(name.clone())
    .inner_size(CHAT_POPOUT_WIDTH, CHAT_POPOUT_EXPANDED_HEIGHT)
    .min_inner_size(300.0, CHAT_POPOUT_COLLAPSED_HEIGHT)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    /*
      A click on this window is for this window.

      Without this a click on a window that is not the key one is spent
      making it key, and the page under the pointer never sees it. Over a
      full-screen video that read as the click going through to what was
      behind: the film started and stopped, and the chat did nothing. A
      floating window that is answered by the thing underneath it is not
      floating over anything.
    */
    .accept_first_mouse(true)
    .zoom_hotkeys_enabled(false)
    // Let a dropped file reach the page.
    //
    // Tauri handles the drop itself unless told not to, and then the webview
    // never sees a dragenter or a drop at all — so attaching a file by
    // dragging it onto this window did nothing. The main window is told not
    // to in tauri.conf.json (`dragDropEnabled: false`); a window built here
    // does not inherit that, and has to say so itself.
    .disable_drag_drop_handler()
    .user_agent(&user_agent);

  // Where the reader window is, when it came from one; otherwise the
  // top-right of the current monitor, cascading per open popout.
  let mut placed = false;
  if let Some(reader) = &reader {
    if let (Ok(pos), Ok(scale)) = (reader.outer_position(), reader.scale_factor()) {
      let pos = pos.to_logical::<f64>(scale);
      builder = builder.position(pos.x, pos.y);
      placed = true;
    }
  }
  if placed {
    // Placed already.
  } else if let Ok(Some(monitor)) = webview.window().current_monitor() {
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let pos = monitor.position().to_logical::<f64>(scale);
    let cascade = (app
      .webview_windows()
      .keys()
      .filter(|k| k.starts_with("chat-"))
      .count() as f64)
      * 28.0;
    builder = builder.position(
      pos.x + size.width - CHAT_POPOUT_WIDTH - 24.0 - cascade,
      pos.y + 96.0 + cascade,
    );
  }

  let popout = builder.build().map_err(|e| e.to_string())?;
  // Fully transparent window background; the page draws its own rounded card.
  let _ = popout.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
  /*
    Made a panel on the main thread. This command runs on a worker thread,
    and turning the window into an NSPanel there — style mask, level,
    ordering — is AppKit work that aborts the whole app with "Must only be
    used from the main thread". It happened to pass from the main window
    and crashed from a reader window; it was never safe.
  */
  let app2 = app.clone();
  let label2 = label.clone();
  let _ = app.run_on_main_thread(move || {
    #[cfg(target_os = "macos")]
    {
      present_as_panel(&app2, &label2);
      use tauri_nspanel::ManagerExt;
      if let Ok(panel) = app2.get_webview_panel(&label2) {
        panel.make_key_window();
        if let Some(reader) = reader {
          let _ = reader.close();
        }
        return;
      }
    }
    if let Some(window) = app2.get_webview_window(&label2) {
      let _ = window.set_focus();
    }
    if let Some(reader) = reader {
      let _ = reader.close();
    }
  });
  Ok(())
}

/// Collapse/expand the popout from inside the popout page.
#[tauri::command]
pub fn resize_chat_popout(
  window: tauri::WebviewWindow,
  width: f64,
  height: f64,
) -> Result<(), String> {
  if !window.label().starts_with("chat-") {
    return Err("Not a chat popout window".into());
  }
  let width = width.clamp(300.0, 720.0);
  let height = height.clamp(CHAT_POPOUT_COLLAPSED_HEIGHT, 900.0);
  /*
    Which edge holds still. Anchored to its top, a bar parked at the foot
    of the screen expanded straight off the bottom of it. The edge nearer
    its own screen edge is the one the reader placed, so that is the edge
    that stays: near the bottom, the window fills upward and folds back
    down; near the top, it grows downward as it always did.
  */
  let anchor = (|| {
    let pos = window.outer_position().ok()?;
    let old = window.outer_size().ok()?;
    let monitor = window.current_monitor().ok().flatten()?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let new_h = (height * scale).round() as i32;
    let mon_top = monitor.position().y;
    let mon_bottom = mon_top + monitor.size().height as i32;
    let old_bottom = pos.y + old.height as i32;
    let d_top = pos.y - mon_top;
    let d_bottom = mon_bottom - old_bottom;
    if d_bottom < d_top {
      Some(tauri::PhysicalPosition::new(pos.x, (old_bottom - new_h).max(mon_top)))
    } else if pos.y + new_h > mon_bottom {
      // Top-anchored but too tall for where it stands: pull it up just
      // enough to stay on the screen.
      Some(tauri::PhysicalPosition::new(
        pos.x,
        (mon_bottom - new_h).max(mon_top),
      ))
    } else {
      None
    }
  })();
  window
    .set_size(tauri::LogicalSize::new(width, height))
    .map_err(|e| e.to_string())?;
  if let Some(position) = anchor {
    let _ = window.set_position(position);
  }
  Ok(())
}

/// Is a pop-out already open for this thread?
///
/// Asked by the main window, which shows a strip in place of the reply
/// composer while one is. The window list is the answer rather than a note we
/// keep: a note can be left behind by a crash, and a window that is gone
/// cannot lie about being there.
#[tauri::command]
pub fn chat_popout_open(app: tauri::AppHandle, account: String, thread_id: String) -> bool {
  /*
    Visible, not merely present.

    A dismissed panel is hidden rather than closed, so the window outlives
    the popout the reader closed. Asked whether one is open, `is_some`
    would now answer yes for ever, and the reader would be told they were
    answering in a window that is not on the screen.
  */
  app
    .get_webview_window(&chat_popout_label(&account, &thread_id))
    .and_then(|w| w.is_visible().ok())
    .unwrap_or(false)
}

/// Bring the pop-out for this thread to the front. "Show", from the strip.
#[tauri::command]
pub fn focus_chat_popout(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
) -> Result<(), String> {
  let Some(window) = app.get_webview_window(&chat_popout_label(&account, &thread_id))
  else {
    return Ok(());
  };
  let _ = window.unminimize();
  let _ = window.show();
  #[cfg(target_os = "macos")]
  {
    use tauri_nspanel::ManagerExt;
    if let Ok(panel) = app.get_webview_panel(window.label()) {
      panel.order_front_regardless();
      panel.make_key_window();
    }
  }
  /*
    Folded is a kind of hidden, so Show unfolds it.

    "Show" is pressed by somebody looking at the strip where their reply
    box used to be, asking to see the conversation. A chat parked as a
    naming bar came forward still as a bar, which answers the letter of
    the request and none of its point. The page owns the fold — it holds
    the state and asks for the resize — so it is told, rather than the
    window being resized behind its back.
  */
  use tauri::Emitter;
  let _ = window.emit_to(window.label(), "chat-popout-unfold", ());
  window.set_focus().map_err(|e| e.to_string())
}

/// "Bring back": ask the pop-out to hand its draft over and close itself.
///
/// Asked of the window rather than done to it. The pop-out is the only one
/// that knows what has been typed in it, and closing it from out here would
/// take that with it — the same handover Escape already does, asked for from
/// somewhere else.
#[tauri::command]
pub fn hand_back_chat_popout(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
) -> Result<(), String> {
  use tauri::Emitter;
  let Some(window) = app.get_webview_window(&chat_popout_label(&account, &thread_id))
  else {
    return Ok(());
  };
  // To that window and no other. `emit` goes to every window, so one thread
  // handed back would close every pop-out that was open.
  window
    .emit_to(window.label(), "chat-popout-hand-back", ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_chat_popout(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
) -> Result<(), String> {
  if !window.label().starts_with("chat-") {
    return Err("Not a chat popout window".into());
  }
  /*
    Hidden, not closed. A panel does not survive `close()`, and the same
    window is what opens again when this thread is popped out next — see
    `open_chat_popout`, which points it at the thread and shows it.
  */
  #[cfg(target_os = "macos")]
  {
    use tauri_nspanel::ManagerExt;
    if let Ok(panel) = app.get_webview_panel(window.label()) {
      panel.set_released_when_closed(false);
      panel.hide();
      return window.hide().map_err(|e| e.to_string());
    }
  }
  let _ = &app;
  window.close().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The reader window: a thread in an ordinary window, the way Outlook opens one
// ---------------------------------------------------------------------------

/// The reader window's shape when it opens. Tall, because it holds a
/// conversation; the reader resizes it like any window after that.
const READER_WINDOW_WIDTH: f64 = 840.0;
const READER_WINDOW_HEIGHT: f64 = 900.0;

fn reader_window_label(account: &str, thread_id: &str, person: Option<&str>) -> String {
  match person {
    // One window per person, as one per thread: the key is the row's own.
    Some(key) => format!("reader-person-{}", window_safe_thread_key("person", key)),
    None => format!("reader-{}", window_safe_thread_key(account, thread_id)),
  }
}

/// Where a thread opened in its own window reads that window from.
///
/// The same one-document arrangement as the chat popout — see `popout_url` —
/// with `reader=1` saying what to render. Every value is percent-encoded: a
/// subject line is written by whoever sent the message, and it lands in a URL.
fn reader_url(
  origin: &str,
  account: &str,
  thread_id: &str,
  name: &str,
  email: &str,
  subject: &str,
  person: Option<&str>,
) -> String {
  let mut query = format!(
    "account={}&thread={}&name={}&email={}&subject={}",
    urlencoding::encode(account),
    urlencoding::encode(thread_id),
    urlencoding::encode(name),
    urlencoding::encode(email),
    urlencoding::encode(subject),
  );
  // A person's mail rather than one thread — see PersonReaderWindow. The
  // page reads `person` before it asks for a thread.
  if let Some(key) = person {
    query.push_str(&format!("&person={}", urlencoding::encode(key)));
  }
  format!("{origin}/index.html?reader=1&{query}")
}

/// Open (or refocus) a thread in an ordinary window of its own.
///
/// Not the chat popout: this one has the system's own title bar and buttons,
/// sits in the window order like any window, and shows the whole thread
/// reader — header, actions, reply box. Double-clicking a thread in the list
/// asks for it, the way Outlook opens a message.
///
/// With `person` set, the window holds that person's mail instead — the
/// people view's pane — and `account` and `thread_id` may be empty.
#[tauri::command]
pub async fn open_mail_reader_window(
  app: tauri::AppHandle,
  webview: tauri::Webview,
  account: String,
  thread_id: String,
  name: String,
  email: String,
  subject: String,
  person: Option<String>,
  user_agent: String,
) -> Result<(), String> {
  use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

  let origin = document_origin(&webview)?;
  let label = reader_window_label(&account, &thread_id, person.as_deref());
  let url = reader_url(
    &origin,
    &account,
    &thread_id,
    &name,
    &email,
    &subject,
    person.as_deref(),
  );
  let parsed: tauri::Url = url.parse().map_err(|e| format!("Bad reader URL: {e}"))?;

  // One window per thread. An ordinary window does not outlive its close the
  // way a panel does, so an existing one here is a window still on screen —
  // bring it forward rather than building a twin behind it.
  if let Some(existing) = app.get_webview_window(&label) {
    let _ = existing.unminimize();
    let _ = existing.show();
    let _ = existing.set_focus();
    return Ok(());
  }

  let title = if subject.trim().is_empty() {
    name.clone()
  } else {
    subject.clone()
  };
  let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
    .title(title)
    .inner_size(READER_WINDOW_WIDTH, READER_WINDOW_HEIGHT)
    .min_inner_size(520.0, 400.0)
    .resizable(true)
    .zoom_hotkeys_enabled(false)
    // Let a dropped file reach the page — the reply box takes attachments.
    // The same reason the chat popout says this; a window built here does
    // not inherit the main window's `dragDropEnabled: false`.
    .disable_drag_drop_handler()
    .user_agent(&user_agent);

  // Centred on the current monitor, stepping down per open reader so a
  // second thread does not open exactly over the first.
  if let Ok(Some(monitor)) = webview.window().current_monitor() {
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let pos = monitor.position().to_logical::<f64>(scale);
    let cascade = (app
      .webview_windows()
      .keys()
      .filter(|k| k.starts_with("reader-"))
      .count() as f64)
      * 28.0;
    let height = READER_WINDOW_HEIGHT.min(size.height - 48.0);
    builder = builder
      .inner_size(READER_WINDOW_WIDTH, height)
      .position(
        pos.x + ((size.width - READER_WINDOW_WIDTH) / 2.0).max(0.0) + cascade,
        pos.y + ((size.height - height) / 2.0).max(24.0) + cascade,
      );
  }

  let window = builder.build().map_err(|e| e.to_string())?;
  let _ = window.set_focus();
  Ok(())
}

/// Close the reader window, asked from inside it — an action that removes
/// the conversation (archive, delete, junk) takes its window with it.
#[tauri::command]
pub fn close_mail_reader_window(window: tauri::WebviewWindow) -> Result<(), String> {
  if !window.label().starts_with("reader-") {
    return Err("Not a mail reader window".into());
  }
  window.close().map_err(|e| e.to_string())
}

/// A popout sent mail — tell every window so the main inbox refreshes now
/// (WKWebView doesn't reliably fire cross-window `storage` events).
#[tauri::command]
pub fn notify_mail_sent(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
) -> Result<(), String> {
  use tauri::Emitter;
  app
    .emit(
      "mail-sent",
      serde_json::json!({ "account": account, "threadId": thread_id }),
    )
    .map_err(|e| e.to_string())
}

/// A reader window archived, deleted or moved its thread — tell every window
/// so the main list drops the row now rather than at the next poll. The same
/// channel arrangement as `notify_mail_sent`, for the same WKWebView reason.
#[tauri::command]
pub fn notify_mail_changed(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
) -> Result<(), String> {
  use tauri::Emitter;
  app
    .emit(
      "mail-changed",
      serde_json::json!({ "account": account, "threadId": thread_id }),
    )
    .map_err(|e| e.to_string())
}

/**
 * Ask the main window to forward a message.
 *
 * The chat popout has no recipient picker and no subject line, so it cannot
 * forward anything itself. It sends the request here instead, and the window
 * that does have a composer picks it up and comes to the front.
 */
#[tauri::command]
pub fn notify_mail_forward(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
  message_id: String,
) -> Result<(), String> {
  use tauri::{Emitter, Manager};
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_focus();
  }
  app
    .emit(
      "mail-forward",
      serde_json::json!({
        "account": account,
        "threadId": thread_id,
        "messageId": message_id,
      }),
    )
    .map_err(|e| e.to_string())
}

/**
 * Ask the main window to open a message as a new one.
 *
 * The chat popout has no recipient picker and no subject line, so it cannot
 * do this itself. It sends the request here instead, and the window that
 * does have a composer picks it up and comes to the front.
 */
#[tauri::command]
pub fn notify_mail_edit_as_new(
  app: tauri::AppHandle,
  account: String,
  thread_id: String,
  message_id: String,
) -> Result<(), String> {
  use tauri::{Emitter, Manager};
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_focus();
  }
  app
    .emit(
      "mail-edit-as-new",
      serde_json::json!({
        "account": account,
        "threadId": thread_id,
        "messageId": message_id,
      }),
    )
    .map_err(|e| e.to_string())
}

/*
  A message written by the planner, for the mail pane to open.

  The Facilitators tab writes the joining details for a course and wants
  them in the composer, addressed and with the calendar file attached. The
  pane is another webview with its own storage, so the page cannot write
  the draft itself. It hands the whole message here; the pane is told, and
  also asks on its next load, because a pane not yet created hears no
  event. Whichever comes first takes it, and taking it clears it.
*/
#[derive(Default)]
pub struct PendingComposeSeed(std::sync::Mutex<Option<serde_json::Value>>);

#[tauri::command]
pub fn notify_mail_compose_seed(
  app: tauri::AppHandle,
  seed: serde_json::Value,
) -> Result<(), String> {
  use tauri::{Emitter, Manager};
  if app.try_state::<PendingComposeSeed>().is_none() {
    app.manage(PendingComposeSeed::default());
  }
  *app
    .state::<PendingComposeSeed>()
    .0
    .lock()
    .map_err(|e| e.to_string())? = Some(seed.clone());
  app.emit("mail-compose-seed", seed).map_err(|e| e.to_string())
}

/// The message waiting for the composer, if any. Taking it clears it.
#[tauri::command]
pub fn take_mail_compose_seed(app: tauri::AppHandle) -> Option<serde_json::Value> {
  use tauri::Manager;
  let state = app.try_state::<PendingComposeSeed>()?;
  let mut guard = state.0.lock().ok()?;
  guard.take()
}

#[cfg(test)]
mod popout_tests {
  use super::*;

  fn parse(url: &str) -> url::Url {
    url::Url::parse(url).expect("a real URL")
  }

  #[test]
  fn the_standalone_gets_the_one_document_it_serves() {
    let url = popout_url(
      "tauri://localhost", "me@x.com", "t1", "A Person", "u@x.com", "test",
    );
    let parsed = parse(&url);
    // A path is a route, and this build has no router to answer one.
    assert_eq!(parsed.path(), "/index.html");
    let q: Vec<(String, String)> = parsed
      .query_pairs()
      .map(|(k, v)| (k.into_owned(), v.into_owned()))
      .collect();
    assert!(q.contains(&("popout".into(), "1".into())), "{url}");
    assert!(q.contains(&("account".into(), "me@x.com".into())));
    assert!(q.contains(&("thread".into(), "t1".into())));
  }

  #[test]
  fn a_sender_cannot_write_extra_parameters_into_the_url() {
    // The subject comes from the message. Left raw, "&popout=0" or a "#" would
    // change what the window opens.
    let url = popout_url(
      "tauri://localhost", "me@x.com", "t/1?x=y",
      "A & B", "u@x.com", "hi&popout=0#frag",
    );
    let parsed = parse(&url);
    assert_eq!(parsed.fragment(), None, "{url}");
    let subject: Vec<String> = parsed
      .query_pairs()
      .filter(|(k, _)| k == "subject")
      .map(|(_, v)| v.into_owned())
      .collect();
    assert_eq!(subject, vec!["hi&popout=0#frag".to_string()]);
    let popout: Vec<String> = parsed
      .query_pairs()
      .filter(|(k, _)| k == "popout")
      .map(|(_, v)| v.into_owned())
      .collect();
    assert_eq!(popout, vec!["1".to_string()], "only the app sets this");
    let thread: Vec<String> = parsed
      .query_pairs()
      .filter(|(k, _)| k == "thread")
      .map(|(_, v)| v.into_owned())
      .collect();
    assert_eq!(thread, vec!["t/1?x=y".to_string()]);
  }

  #[test]
  fn the_reader_window_asks_the_one_document_for_the_reader() {
    let url = reader_url(
      "tauri://localhost/mail", "me@x.com", "t1", "A Person", "u@x.com", "test", None,
    );
    let parsed = parse(&url);
    assert_eq!(parsed.path(), "/mail/index.html");
    let q: Vec<(String, String)> = parsed
      .query_pairs()
      .map(|(k, v)| (k.into_owned(), v.into_owned()))
      .collect();
    assert!(q.contains(&("reader".into(), "1".into())), "{url}");
    assert!(q.contains(&("account".into(), "me@x.com".into())));
    assert!(q.contains(&("thread".into(), "t1".into())));
  }

  #[test]
  fn a_sender_cannot_write_extra_parameters_into_the_reader_url() {
    let url = reader_url(
      "tauri://localhost", "me@x.com", "t/1?x=y",
      "A & B", "u@x.com", "hi&reader=0#frag", None,
    );
    let parsed = parse(&url);
    assert_eq!(parsed.fragment(), None, "{url}");
    let reader: Vec<String> = parsed
      .query_pairs()
      .filter(|(k, _)| k == "reader")
      .map(|(_, v)| v.into_owned())
      .collect();
    assert_eq!(reader, vec!["1".to_string()], "only the app sets this");
  }

  #[test]
  fn a_reader_label_holds_only_what_a_tauri_label_may() {
    let label = reader_window_label("möller.o~b@x.com", "AAQkAD/=+ %|1", None);
    assert!(label.starts_with("reader-"));
    assert!(
      label
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-/:_".contains(c)),
      "{label}"
    );
    // Distinct threads must not fold into one window.
    assert_ne!(
      reader_window_label("a@x.com", "t1", None),
      reader_window_label("a@x.com", "t2", None)
    );
  }
}
