//! Printing, on macOS.
//!
//! `window.print()` in a WKWebView returns and does nothing. WebKit leaves
//! JS-initiated printing to the embedding app, and raises no error when there
//! is nobody to handle it — measured in this app: the print iframe loads, the
//! call returns, and `beforeprint` never fires. The same code in a browser
//! opens the dialog.
//!
//! So the document is loaded into a window of its own and handed to
//! `NSPrintOperation`, which is what opens the macOS print panel. The page
//! builds the document (see `print-document.ts`); nothing here knows what a
//! message looks like.
//!
//! The window is off-screen rather than hidden. A window with no frame does
//! not lay out, and a web view that never laid out paginates to nothing.
//!
//! The panel must run with `runOperationModalForWindow`, not `runOperation`.
//! WebKit draws the job on a later turn of the run loop. `runOperation`
//! returns before that draw, so the panel's preview is right and the paper
//! (and Save as PDF) comes out blank, with the page count already set.

#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{define_class, msg_send, sel, ClassType};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSPrintInfo, NSPrintOperation, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// `dhprint://localhost/<id>` — the document waiting under that id.
pub const SCHEME: &str = "dhprint";

/// Roughly A4/Letter at 96dpi. The web view paginates against its own width,
/// so a window sized like a page keeps the line breaks close to the paper.
const PAGE_WIDTH: f64 = 816.0;
const PAGE_HEIGHT: f64 = 1056.0;

/// Documents built by the page, waiting for their window to ask for them.
fn pending() -> &'static Mutex<HashMap<String, String>> {
  static PENDING: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The document for a protocol request path, if one is waiting.
pub fn document_for_path(path: &str) -> Option<String> {
  let id = path.trim_start_matches('/');
  if id.is_empty() {
    return None;
  }
  pending().lock().ok()?.get(id).cloned()
}

/// Drop the stored HTML and close the off-screen print window.
fn drop_print(window: &WebviewWindow, id: &str) {
  if let Ok(mut waiting) = pending().lock() {
    waiting.remove(id);
  }
  let _ = window.close();
}

/// What the finish callback needs after the panel goes away.
///
/// `NSPrintOperation` does not retain its delegate. The box holds that
/// retain, and the callback takes the box back.
struct PrintCleanup {
  window: WebviewWindow,
  id: String,
  _keep: Retained<PrintFinish>,
}

define_class!(
  // SAFETY: NSObject has no subclassing requirements, and this type
  // implements no Drop.
  #[unsafe(super(NSObject))]
  #[name = "DhMailPrintFinish"]
  struct PrintFinish;

  impl PrintFinish {
    #[unsafe(method(printOperationDidRun:success:contextInfo:))]
    fn did_run(&self, _op: &NSPrintOperation, _success: bool, ctx: *mut c_void) {
      if ctx.is_null() {
        return;
      }
      // SAFETY: `ctx` is the box `show_print_panel` handed over, and this
      // selector runs once.
      let cleanup = unsafe { Box::from_raw(ctx as *mut PrintCleanup) };
      drop_print(&cleanup.window, &cleanup.id);
    }
  }

  unsafe impl NSObjectProtocol for PrintFinish {}
);

/// Open the macOS print panel for an HTML document.
#[tauri::command]
pub async fn print_document(app: AppHandle, html: String) -> Result<(), String> {
  if html.trim().is_empty() {
    return Err("nothing to print".into());
  }

  static NEXT_ID: AtomicU64 = AtomicU64::new(1);
  let id = format!("d{}", NEXT_ID.fetch_add(1, Ordering::SeqCst));
  let label = format!("print-{id}");

  pending()
    .lock()
    .map_err(|_| "print queue unavailable".to_string())?
    .insert(id.clone(), html);

  let url = format!("{SCHEME}://localhost/{id}")
    .parse()
    .map_err(|_| "could not address the print document".to_string())?;

  let cleanup_id = id.clone();
  let build = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
    .title("Print")
    .inner_size(PAGE_WIDTH, PAGE_HEIGHT)
    // Off the screen, not hidden. See the note at the top of this file.
    .position(-20000.0, -20000.0)
    .decorations(false)
    .skip_taskbar(true)
    .focused(false)
    .on_page_load(move |webview, payload| {
      if payload.event() != PageLoadEvent::Finished {
        return;
      }
      let Some(window) = webview.app_handle().get_webview_window(webview.label()) else {
        return;
      };
      let id = cleanup_id.clone();
      // AppKit is main-thread only.
      let _ = webview.app_handle().run_on_main_thread(move || {
        show_print_panel(window, id);
      });
    })
    .build();

  if let Err(err) = build {
    if let Ok(mut waiting) = pending().lock() {
      waiting.remove(&id);
    }
    return Err(err.to_string());
  }
  Ok(())
}

/// A visible window the print sheet can attach to. The print window itself
/// sits off-screen, and a sheet on that window would be invisible.
fn panel_parent(print: &WebviewWindow) -> Option<Retained<NSWindow>> {
  let print_ptr = print.ns_window().ok()? as *const NSWindow;
  let mtm = MainThreadMarker::new()?;
  let app = NSApplication::sharedApplication(mtm);

  let usable = |window: &NSWindow| {
    !std::ptr::eq(window as *const NSWindow, print_ptr) && window.isVisible()
  };

  if let Some(key) = app.keyWindow() {
    if usable(&key) {
      return Some(key);
    }
  }
  if let Some(main) = app.mainWindow() {
    if usable(&main) {
      return Some(main);
    }
  }

  let windows = app.windows();
  for i in 0..windows.count() {
    let window = windows.objectAtIndex(i);
    if usable(&window) {
      return Some(window);
    }
  }
  None
}

/// Open the print panel for a window's web view. The window stays up until
/// the panel's finish callback closes it. Closing earlier blanks the job.
fn show_print_panel(window: WebviewWindow, id: String) {
  let window_for_job = window.clone();
  let id_for_job = id.clone();
  let result = window.with_webview(move |platform| {
    let Some(parent) = panel_parent(&window_for_job) else {
      log::warn!("print: no window to attach the panel to");
      drop_print(&window_for_job, &id_for_job);
      return;
    };
    let webview = platform.inner() as *mut AnyObject;
    if webview.is_null() {
      log::warn!("print: no web view behind the window");
      drop_print(&window_for_job, &id_for_job);
      return;
    }
    // Safety: the pointer is the window's live WKWebView, and this runs on
    // the main thread, which is where AppKit requires it.
    unsafe {
      let info = NSPrintInfo::sharedPrintInfo();
      let operation: Option<Retained<NSPrintOperation>> =
        msg_send![webview, printOperationWithPrintInfo: &*info];
      let Some(operation) = operation else {
        log::warn!("print: the web view gave no print operation");
        drop_print(&window_for_job, &id_for_job);
        return;
      };
      /*
        The printing view has to be told the size of the paper.

        WebKit hands back a view of its own and leaves its frame empty, and
        a view with no frame paginates to one page with nothing drawn on
        it — which is what came out: the panel's preview was right and the
        paper was blank. The frame is the paper, in points, and WebKit
        lays the document out against it.
      */
      let paper = info.paperSize();
      match operation.view() {
        Some(view) => {
          let was = view.frame();
          view.setFrame(NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(paper.width, paper.height),
          ));
          // Said out loud because a blank page gives nothing to read: this
          // is the measurement that decides whether anything is drawn.
          log::info!(
            "print: paper {}x{}, printing view was {}x{}",
            paper.width,
            paper.height,
            was.size.width,
            was.size.height
          );
        }
        None => log::warn!("print: the operation has no view to size"),
      }
      operation.setShowsPrintPanel(true);
      operation.setShowsProgressPanel(true);

      let delegate: Retained<PrintFinish> = msg_send![PrintFinish::class(), new];
      let ctx = Box::into_raw(Box::new(PrintCleanup {
        window: window_for_job,
        id: id_for_job,
        _keep: delegate.clone(),
      }));
      operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
        &parent,
        Some(&*delegate),
        Some(sel!(printOperationDidRun:success:contextInfo:)),
        ctx.cast(),
      );
    }
  });
  if let Err(err) = result {
    log::warn!("print: {err}");
    drop_print(&window, &id);
  }
}
