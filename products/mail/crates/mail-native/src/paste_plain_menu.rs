//! "Paste without Formatting" in the right-click menu of the mail window.
//!
//! The menu is WebKit's own, with spelling, Writing Tools and the rest, and
//! it has Paste but not a plain paste. A page cannot add to it. So the web
//! view's class is given a `willOpenMenu:withEvent:` of its own, which AppKit
//! calls with the menu just before it shows: the item goes in under Paste,
//! and then WebKit's own method runs as before. Choosing the item sends
//! `paste-plain` to the window, and the page pastes as its plain-paste key
//! does (see apps/mail/src/main.tsx).
//!
//! The method is added to the class, not to one view, so every mail window
//! has the item: the main window, a pop-out and a reader window alike.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{ffi, sel, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSMenu, NSMenuItem, NSUserInterfaceItemIdentification};
use objc2_foundation::{NSLocale, NSString};
use tauri::{AppHandle, Emitter, Manager};

/// What the page listens for when the item is chosen.
pub const PASTE_PLAIN_EVENT: &str = "paste-plain";

/// Marks the item, so a menu that is opened twice gets it once.
const ITEM_TAG: isize = 0x0D4_5E9A;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// WebKit's own `willOpenMenu:withEvent:`, called after the item is in.
static WEBKIT_WILL_OPEN: OnceLock<Imp> = OnceLock::new();

type WillOpen = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut NSMenu, *mut NSEvent);
type Action = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject);

/// Install on the class of this web view (a `WKWebView` subclass). Once per
/// process; on the main thread.
pub fn install(app: &AppHandle, webview: *mut c_void) {
  if APP.set(app.clone()).is_err() || webview.is_null() {
    return;
  }
  // Safety: `webview` is the live WKWebView Tauri handed over, and the
  // runtime calls below only read and add methods on its class.
  unsafe {
    let class = ffi::object_getClass(webview as *const AnyObject) as *mut AnyClass;
    if class.is_null() {
      return;
    }
    let will_open = sel!(willOpenMenu:withEvent:);
    let inherited = ffi::class_getInstanceMethod(class, will_open);
    if inherited.is_null() {
      return;
    }
    let Some(webkit) = ffi::method_getImplementation(inherited) else {
      return;
    };
    let _ = WEBKIT_WILL_OPEN.set(webkit);
    let ours: Imp = std::mem::transmute::<WillOpen, Imp>(will_open_menu);
    // The class inherits the method; adding it here overrides it for this
    // class alone. If the class has one of its own, it is replaced, and
    // the old one is what runs after ours.
    if !ffi::class_addMethod(class, will_open, ours, c"v@:@@".as_ptr()).as_bool() {
      ffi::method_setImplementation(inherited as *mut _, ours);
    }
    let action: Imp = std::mem::transmute::<Action, Imp>(paste_plain);
    ffi::class_addMethod(class, sel!(dhPastePlain:), action, c"v@:@".as_ptr());
  }
}

unsafe extern "C-unwind" fn will_open_menu(
  this: *mut AnyObject,
  cmd: Sel,
  menu: *mut NSMenu,
  event: *mut NSEvent,
) {
  // Safety: AppKit passes the menu that is about to open, alive for the call.
  if let Some(menu) = unsafe { menu.as_ref() } {
    add_item(this, menu);
  }
  if let Some(webkit) = WEBKIT_WILL_OPEN.get() {
    // Safety: the implementation read from this very selector, so it has
    // this signature.
    unsafe {
      let webkit = std::mem::transmute::<Imp, WillOpen>(*webkit);
      webkit(this, cmd, menu, event);
    }
  }
}

/// Under Paste, when the menu has one: only where text can be put in.
fn add_item(target: *mut AnyObject, menu: &NSMenu) {
  let Some(mtm) = MainThreadMarker::new() else { return };
  if menu.itemWithTag(ITEM_TAG).is_some() {
    return;
  }
  let Some(at) = paste_index(menu) else { return };
  let title = NSString::from_str(item_title());
  let item = unsafe {
    NSMenuItem::initWithTitle_action_keyEquivalent(
      mtm.alloc(),
      &title,
      Some(sel!(dhPastePlain:)),
      &NSString::from_str(""),
    )
  };
  item.setTag(ITEM_TAG);
  // Safety: the target is the web view the menu belongs to, which outlives
  // its own menu.
  unsafe { item.setTarget(target.as_ref()) };
  menu.insertItem_atIndex(&item, at + 1);
}

/// Where Paste is. WebKit names its items by identifier; an older WebKit,
/// or an edit field of AppKit's own, uses the `paste:` action.
fn paste_index(menu: &NSMenu) -> Option<isize> {
  for i in 0..menu.numberOfItems() {
    let Some(item) = menu.itemAtIndex(i) else { continue };
    let by_id = item
      .identifier()
      .is_some_and(|id| id.to_string() == "WKMenuItemIdentifierPaste");
    let by_action = item.action() == Some(sel!(paste:));
    if by_id || by_action {
      return Some(i);
    }
  }
  None
}

/// In the system's language, as the rest of the menu is: macOS draws it,
/// not the page, so it follows the Mac and not Mail's own language setting.
fn item_title() -> &'static str {
  let danish = NSLocale::preferredLanguages()
    .firstObject()
    .is_some_and(|lang| lang.to_string().starts_with("da"));
  if danish {
    "Indsæt uden formatering"
  } else {
    "Paste without Formatting"
  }
}

unsafe extern "C-unwind" fn paste_plain(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) {
  let Some(app) = APP.get() else { return };
  // To the window in front: the menu was opened in it.
  let focused = app
    .webview_windows()
    .into_iter()
    .find(|(_, window)| window.is_focused().unwrap_or(false));
  if let Some((label, _)) = focused {
    if let Err(err) = app.emit_to(label.as_str(), PASTE_PLAIN_EVENT, ()) {
      log::warn!("paste-plain: could not tell the page: {err}");
    }
  }
}
