//! Trackpad pinch → JS mail zoom in the Tauri WKWebView.
//!
//! WKWebView often swallows magnify events (especially over nested iframes),
//! so the browser-side gesture/ctrl+wheel listeners never see them. An AppKit
//! local event monitor catches NSEventTypeMagnify and re-emits the same
//! `mail-pinch-scale` CustomEvent the web UI already consumes.

#![cfg(target_os = "macos")]

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSEvent, NSEventMask};
use tauri::AppHandle;

static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Install once on the main thread, for the standalone app: the mail
/// interface is the `main` webview.
pub fn install(app: AppHandle) {
  install_for(app, "main", std::sync::Arc::new(|_, _| true));
}

/// A test the host supplies: is the target webview on screen, under this
/// pointer? The pointer is in logical points from the top-left of the
/// event window's content, or None when the event has no window. An app
/// with mail in a pane answers from the pane's heartbeat and last rectangle.
pub type ShownGate =
  std::sync::Arc<dyn Fn(&AppHandle, Option<(f64, f64)>) -> bool + Send + Sync>;

/// Where the pointer is, in logical points from the top-left of the event
/// window's content view. AppKit measures from the bottom-left, so the y is
/// flipped with the content view's height.
fn pointer_in_content(event: &NSEvent) -> Option<(f64, f64)> {
  // The monitor's block runs on the main thread; AppKit calls it there.
  let mtm = MainThreadMarker::new()?;
  let window = event.window(mtm)?;
  let content = window.contentView()?;
  let height = content.bounds().size.height;
  let at = event.locationInWindow();
  Some((at.x, height - at.y))
}

/// Install once on the main thread, forwarding the pinch to the webview
/// with this label — `mail` in an app where the interface is a child
/// webview. Safe to call repeatedly.
///
/// The pinch is forwarded, and consumed, only while `shown` says the target
/// is on screen. Otherwise the event goes on to whatever is under the
/// pointer.
pub fn install_for(app: AppHandle, label: &'static str, shown: ShownGate) {
  if INSTALLED.swap(true, Ordering::SeqCst) {
    return;
  }
  if MainThreadMarker::new().is_none() {
    let app2 = app.clone();
    if app
      .run_on_main_thread(move || install_for(app2, label, shown))
      .is_err()
    {
      INSTALLED.store(false, Ordering::SeqCst);
    }
    return;
  }
  let app_for_block = app.clone();
  let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
    // Safety: AppKit hands a live NSEvent for the duration of the callback.
    let event_ref = unsafe { event.as_ref() };
    let delta = event_ref.magnification();
    if !shown(&app_for_block, pointer_in_content(event_ref)) {
      return event.as_ptr();
    }
    if delta != 0.0 && delta.is_finite() {
      let ratio = 1.0 + delta;
      // To that webview, by label, as a Tauri event; the interface turns it
      // into the `mail-pinch-scale` DOM event EmailHtmlView / usePinchZoom
      // listen for (see apps/mail/src/main.tsx). An event rather than a
      // script, because a child webview is only reachable by script behind
      // Tauri's unstable feature, and the standalone shell has no such thing.
      use tauri::Emitter;
      let _ = app_for_block.emit_to(label, "mail-pinch-scale", ratio);
    }
    // Consume so we don't also apply a WebKit gesture* handler for the same pinch.
    // Events that bypass this monitor (WebContent-routed) still reach JS listeners.
    std::ptr::null_mut()
  });
  // Safety: block return is the same event pointer AppKit passed in.
  let monitor = unsafe {
    NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::Magnify, &block)
  };

  if monitor.is_some() {
    // Leak intentionally — AppKit holds a weak-ish ref to the monitor object,
    // but we must keep the block allocation alive for the process lifetime.
    std::mem::forget(monitor);
    std::mem::forget(block);
  } else {
    INSTALLED.store(false, Ordering::SeqCst);
  }
}
