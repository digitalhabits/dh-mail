use tauri::webview::PageLoadEvent;
use tauri::Manager;

#[cfg(target_os = "macos")]
mod menu;

// The native side of mail lives in the shared crate; see products/mail/crates.
#[cfg(target_os = "macos")]
use mail_native::{contacts, dragout, magnify, printing};
use mail_native::{downloads, oauth};

/// Write an .ics invite to a temp file and open it with the OS calendar app.
#[tauri::command]
fn open_calendar_invite(
  app: tauri::AppHandle,
  filename: String,
  content: String,
) -> Result<(), String> {
  let mut safe = filename
    .trim()
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
        c
      } else {
        '_'
      }
    })
    .collect::<String>();
  if safe.is_empty() {
    safe = "invite.ics".into();
  }
  if !safe.to_ascii_lowercase().ends_with(".ics") {
    safe.push_str(".ics");
  }
  let path = std::env::temp_dir().join(safe);
  std::fs::write(&path, content.as_bytes())
    .map_err(|e| format!("Couldn't write invite: {e}"))?;

  // A phone has no shell to hand the file to. The opener plugin asks the
  // system for whatever opens an .ics there — Calendar, or a picker.
  #[cfg(any(target_os = "ios", target_os = "android"))]
  {
    use tauri_plugin_opener::OpenerExt;
    return app
      .opener()
      .open_path(path.to_string_lossy(), None::<&str>)
      .map_err(|e| format!("Couldn't open invite: {e}"));
  }
  #[cfg(not(any(target_os = "ios", target_os = "android")))]
  {
    let _ = &app;
    let status = {
      #[cfg(target_os = "macos")]
      {
        std::process::Command::new("open").arg(&path).status()
      }
      #[cfg(target_os = "windows")]
      {
        std::process::Command::new("cmd")
          .args(["/C", "start", "", &path.to_string_lossy()])
          .status()
      }
      #[cfg(not(any(target_os = "macos", target_os = "windows")))]
      {
        std::process::Command::new("xdg-open").arg(&path).status()
      }
    };
    match status {
      Ok(s) if s.success() => Ok(()),
      Ok(s) => Err(format!("open exited with {s}")),
      Err(e) => Err(format!("Couldn't open invite: {e}")),
    }
  }
}


fn splash_overlay_js() -> String {
  let logo = include_str!("../splash/logo.b64");
  let inner_html = format!(
    r#"<style>
#dh-mail-splash{{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:var(--dh-splash-bg,#faf8f5);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:opacity .25s ease;-webkit-app-region:drag}}
#dh-mail-splash,#dh-mail-splash *{{-webkit-app-region:drag}}
#dh-mail-splash .stack{{display:flex;flex-direction:column;align-items:center;gap:1.5rem}}
#dh-mail-splash img{{width:88px;height:88px;border-radius:22px;box-shadow:0 10px 30px var(--dh-splash-shadow,rgba(28,25,23,.12))}}
#dh-mail-splash .spinner{{width:28px;height:28px;border-radius:999px;border:2.5px solid var(--dh-splash-track,rgba(28,25,23,.12));border-top-color:#2a9d8f;animation:dh-spin .75s linear infinite}}
#dh-mail-splash .label{{margin:0;font-size:13px;letter-spacing:.02em;color:var(--dh-splash-fg,rgba(28,25,23,.65))}}
@keyframes dh-spin{{to{{transform:rotate(360deg)}}}}
</style>
<div class="stack" data-tauri-drag-region>
  <img src="data:image/png;base64,{logo}" alt="" width="88" height="88" data-tauri-drag-region/>
  <div class="spinner" aria-hidden="true" data-tauri-drag-region></div>
  <p class="label" data-tauri-drag-region>Opening Digital Habits: Mail…</p>
</div>"#,
    logo = logo
  );
  let html_json = serde_json::to_string(&inner_html).unwrap_or_else(|_| "''".into());
  format!(
    r#"(function () {{
  if (document.getElementById('dh-mail-splash')) return;
  var root = document.documentElement;
  /*
    System counts as dark when the system is dark.

    The stored value is what the reader picked, and what most of them pick
    is nothing: "System" is the default, and it is written as `system` or
    not written at all. Testing only for `dark` therefore gave a cream
    splash to every reader on a dark Mac who had never opened Settings —
    which is nearly all of them.
  */
  var dark = false;
  try {{
    var picked = localStorage.getItem('redd-plan-mail-color-mode');
    dark =
      picked === 'dark' ||
      ((!picked || picked === 'system') &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
  }} catch (_) {{}}
  var host = document.createElement('div');
  host.id = 'dh-mail-splash';
  host.setAttribute('data-tauri-drag-region', '');
  if (dark) {{
    // The chrome the app opens into, so the splash does not hand over to a
    // different shade of navy.
    host.style.setProperty('--dh-splash-bg', '#1a2735');
    host.style.setProperty('--dh-splash-fg', 'rgba(255,255,255,.7)');
    host.style.setProperty('--dh-splash-track', 'rgba(255,255,255,.2)');
    host.style.setProperty('--dh-splash-shadow', 'rgba(0,0,0,.28)');
  }}
  host.innerHTML = {html_json};
  (document.body || root).appendChild(host);
  if (!document.body) {{
    document.addEventListener('DOMContentLoaded', function () {{
      if (host.parentNode !== document.body && document.body) {{
        document.body.appendChild(host);
      }}
    }});
  }}
}})();"#
  )
}

fn splash_hide_js() -> &'static str {
  r#"(function () {
  setTimeout(function () {
    var host = document.getElementById('dh-mail-splash');
    if (!host) return;
    host.style.opacity = '0';
    setTimeout(function () {
      if (host.parentNode) host.parentNode.removeChild(host);
    }, 260);
  }, 180);
})();"#
}

/// Open an http(s) link in the system browser.
///
/// Links inside a sandboxed email iframe cannot open themselves: Tauri does not
/// honor target=_blank from an iframe document, so the page asks for this.
#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("only http and https links open externally".into());
  }
  tauri_plugin_opener::OpenerExt::opener(&app)
    .open_url(url, None::<&str>)
    .map_err(|e| e.to_string())
}

/// The commands every platform carries, plus whatever a platform adds.
///
/// Two hand-kept lists would drift. Printing and the Mac address book are
/// AppKit, so they exist on macOS and nowhere else; the page is written to
/// expect that. `invoke` on a command the shell does not carry rejects, and
/// the mail package answers a rejection by falling back — an iframe prints,
/// and the contact source reports itself unavailable. See
/// `lib/native-shell.ts` and `components/mail/print-mail.ts`.
macro_rules! mail_commands {
  ($($platform:path),* $(,)?) => {
    tauri::generate_handler![
      open_calendar_invite,
      mail_native::popout::open_chat_popout,
      mail_native::popout::resize_chat_popout,
      mail_native::popout::close_chat_popout,
      mail_native::popout::chat_popout_open,
      mail_native::popout::focus_chat_popout,
      mail_native::popout::hand_back_chat_popout,
      mail_native::popout::open_mail_reader_window,
      mail_native::popout::close_mail_reader_window,
      mail_native::popout::notify_mail_sent,
      mail_native::popout::notify_mail_changed,
      mail_native::popout::notify_mail_forward,
      mail_native::popout::notify_mail_edit_as_new,
      mail_native::commands::mail_store_call,
      mail_native::pending::set_pending_mail_writes,
      mail_native::commands::mail_import_snapshot,
      mail_native::commands::oauth_bind,
      mail_native::commands::oauth_await_redirect,
      mail_native::commands::oauth_cancel,
      mail_native::sync::mail_sync_configure,
      mail_native::sync::mail_sync_start,
      mail_native::sync::mail_sync_stop,
      mail_native::sync::mail_sync_wake,
      mail_native::sync::mail_sync_running,
      mail_native::sync::mail_sync_fetch_bodies,
      mail_native::sync::mail_sync_fetch_part,
      mail_native::sync::mail_sync_fetch_source,
      mail_native::sync::mail_sync_action,
      mail_native::sync::mail_sync_send,
      mail_native::sync::mail_sync_outbox,
      mail_native::sync::mail_sync_outbox_cancel,
      mail_native::sync::mail_sync_outbox_send_now,
      // The team layer, over the planner API. Internal flavor only; the
      // public interface never calls these.
      mail_native::planner::planner_session_set,
      mail_native::planner::planner_session_clear,
      mail_native::planner::planner_session_ready,
      mail_native::planner::planner_session_origin,
      mail_native::planner::planner_fetch,
      mail_native::planner::planner_show_record,
      open_external_url,
      downloads::save_attachment,
      mail_native::handover::activate_outlook,
      mail_native::handover::open_outlook_compose,
      mail_native::handover::arrange_outlook_handover,
      oauth::oauth_token_request,
      $($platform),*
    ]
  };
}

/// The longest a closing window or a quitting app waits for its writes.
const WRITE_DRAIN_CAP_MS: u64 = 8000;
/// Set by the drain thread, so its own exit is not prevented again.
static EXIT_AFTER_DRAIN: std::sync::atomic::AtomicBool =
  std::sync::atomic::AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
  // The chat popout is a non-activating panel, so clicking it does not take
  // the front from a slideshow behind it. mail-native reclasses the window;
  // this is the plugin that lets it.
  #[cfg(target_os = "macos")]
  let builder = builder.plugin(tauri_nspanel::init());
  // Remote images (dhmail://) and, on macOS, the print document (dhprint://).
  // See the mail-native crate.
  let builder = mail_native::register_schemes(builder);

  #[cfg(target_os = "macos")]
  let builder = builder.invoke_handler(mail_commands![
    printing::print_document,
    mail_native::clipboard::read_clipboard_text,
    dragout::stage_attachment_for_drag,
    dragout::drag_files,
    contacts::mac_contacts_authorization,
    contacts::mac_contacts_request_access,
    contacts::mac_contacts_list,
    contacts::open_contacts_privacy_settings,
  ]);
  #[cfg(not(target_os = "macos"))]
  let builder = builder.invoke_handler(mail_commands![]);

  builder
    /*
      A window that owes the mailbox writes is not closed on the first ask.

      The trash and archive requests run in the webview, so the red button
      pressed right after a delete killed the request mid-flight: the app
      had said "moved to Trash" and the mailbox was never told. The page
      counts its in-flight writes (see pending.rs); a close with any still
      out is prevented, and the window is destroyed as soon as they drain —
      or after eight seconds, so a dead network cannot hold the window
      hostage.
    */
    .on_window_event(|window, event| match event {
      tauri::WindowEvent::CloseRequested { api, .. } => {
        // The main window is the app: closing it quits, as on Windows.
        // The exit drains the writes first, below. Left to itself the
        // window went and a chat popout kept the app running with nothing
        // on screen. A popout closing drains its own writes and no more.
        if window.label() == "main" {
          use tauri::Manager as _;
          api.prevent_close();
          window.app_handle().exit(0);
          return;
        }
        if mail_native::pending::pending_for(window.label()) > 0 {
          api.prevent_close();
          let window = window.clone();
          std::thread::spawn(move || {
            let start = std::time::Instant::now();
            while mail_native::pending::pending_for(window.label()) > 0
              && start.elapsed() < std::time::Duration::from_millis(WRITE_DRAIN_CAP_MS)
            {
              std::thread::sleep(std::time::Duration::from_millis(100));
            }
            mail_native::pending::forget_window(window.label());
            let _ = window.destroy();
          });
        }
      }
      tauri::WindowEvent::Destroyed => {
        mail_native::pending::forget_window(window.label());
      }
      _ => {}
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      } else {
        // Release: keep logs for diagnosing sidecar boot failures.
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(target_os = "macos")]
      magnify::install(app.handle().clone());

      // Report an issue / Contact us / Who we are, under Help.
      #[cfg(target_os = "macos")]
      if let Err(err) = menu::install(app) {
        log::warn!("menu: {err}");
      }

      // The local store. A failure here leaves the app unable to remember
      // anything, so it stops rather than run with no store at all.
      let data_dir = app.path().app_data_dir().map_err(|e| {
        log::error!("no app data directory: {e}");
        e
      })?;
      mail_native::setup_store(app.handle(), data_dir)
        .map_err(std::io::Error::other)?;

      Ok(())
    })
    .on_page_load(|window, payload| {
      let url = payload.url().to_string();

      // A chat popout is a small transparent window. No splash there.
      let is_popout = url.contains("popout=1");

      // Nor over the print document. That page is not something a reader
      // waits in front of — it is the page whose pixels become paper, and the
      // splash was landing on it: a single message printed the splash instead
      // of the message, and a thread came out blank behind it.
      //
      // Only macOS has such a page. Elsewhere the print document is an iframe
      // inside the app's own window, which never loads a page of its own.
      #[cfg(target_os = "macos")]
      let is_print = url.starts_with(&format!("{}://", printing::SCHEME));
      #[cfg(not(target_os = "macos"))]
      let is_print = false;
      let is_chrome = is_popout || is_print;

      match payload.event() {
        PageLoadEvent::Started => {
          if !is_chrome {
            let _ = window.eval(splash_overlay_js());
          }
        }
        PageLoadEvent::Finished => {
          if !is_chrome {
            let _ = window.eval(splash_hide_js());
          }
          let _ = window.eval(
            r#"(() => {
              if (window.__dhExternalLinksHooked) return;
              window.__dhExternalLinksHooked = true;
              document.addEventListener('click', (event) => {
                const el = event.target instanceof Element
                  ? event.target.closest('a[target="_blank"]')
                  : null;
                if (!el || !el.href || !/^https?:/i.test(el.href)) return;
                const invoke =
                  (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
                  (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
                if (!invoke) return;
                event.preventDefault();
                invoke('plugin:opener|open_url', { url: el.href });
              }, true);
            })();"#,
          );
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // Quit (⌘Q) skips the windows' own close events, so the same wait
      // happens here: the exit is prevented once, the writes drain, and
      // the drain thread asks again with the flag set.
      if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
        if !EXIT_AFTER_DRAIN.load(std::sync::atomic::Ordering::SeqCst)
          && mail_native::pending::pending_total() > 0
        {
          api.prevent_exit();
          let app = _app.clone();
          std::thread::spawn(move || {
            let start = std::time::Instant::now();
            while mail_native::pending::pending_total() > 0
              && start.elapsed() < std::time::Duration::from_millis(WRITE_DRAIN_CAP_MS)
            {
              std::thread::sleep(std::time::Duration::from_millis(100));
            }
            EXIT_AFTER_DRAIN.store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
          });
        }
      }
    });
}


