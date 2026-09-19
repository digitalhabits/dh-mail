/**
 * Entry point for the standalone Mail app.
 *
 * No Next, no Clerk, no Postgres. The user interface comes from
 * products/mail/packages/mail, and every seam it needs is aliased in
 * vite.config.ts to something local. See `docs/mail-product-plan.md`.
 *
 * Two things can render here. The mail client is one; a popped-out thread is
 * the other, in its own always-on-top window. The planner serves those from
 * two routes, which this build has no server to do — so one document answers
 * both, and the query string says which. Rust builds that URL: see
 * `open_chat_popout` in src-tauri.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import { useMailColorMode } from "@/lib/mail/theme";
import { hostOsFromUserAgent, markPhoneForm } from "@/lib/mail/host-form";

import { ChatPopout } from "@/components/mail/ChatPopout";
import { openMailAccountsMenu } from "@/components/mail/MailPage";
import { setMailApiTransport } from "@/lib/mail/api";
import {
  MAIL_COLOR_MODE_EVENT,
  readMailColorMode,
} from "@/lib/mail/theme";

import { App } from "./App";
import { ReaderWindow } from "./ReaderWindow";
import { WindowControls } from "./WindowControls";
import { showScrollbarsWhileScrolling } from "./scrollbars";
import { importPlannerStateOnce } from "./import-planner-state";
import { isDemoMode } from "./demo/mode";
import { handleDemoMailApi } from "./demo/transport";
import { handleStandaloneMailApi } from "./standalone-api";

import "../styles/globals.css";
import "@/mail.css";
import "./standalone.css";

/*
  Dev only: this file never runs twice in one page.

  A hot update that cannot be applied in place is passed up the import chain
  until it reaches this file, and Vite then runs this file again. It has no
  way to take the first run back: the first React root stays mounted with all
  its listeners, timers and sync subscriptions, and `createRoot` below mounts
  a second whole app in the same element. After a morning of edits there were
  nine apps in one window, the web view sat at 100 % of a core and held 6 GB,
  and the Mac was slow for everything. One reload brought it back to idle.

  So the second run reloads the page and stops here. `hot.data` is what Vite
  keeps between two runs of one module. A release build has no `hot`, and
  none of this is in it.
*/
if (import.meta.hot) {
  if (import.meta.hot.data.ran) {
    window.location.reload();
    await new Promise<never>(() => {});
  }
  import.meta.hot.data.ran = true;
}

const params = new URLSearchParams(window.location.search);

/**
 * A mailbox that does not exist, for screenshots.
 *
 * `pnpm app:dev:demo` sets the flag at build time; `?demo=1` turns it on in
 * a browser. Nothing signs in and nothing is stored in this mode — see
 * `demo/transport.ts`.
 */
const demoMode = isDemoMode();

/**
 * Every API call goes to the core in this webview, not to a server.
 *
 * This runs in the popout window too, which is a webview of its own with its
 * own copy of every module. It reads the same SQLite file and the same
 * keychain, because those live in the app rather than in a page.
 */
setMailApiTransport(demoMode ? handleDemoMailApi : handleStandaloneMailApi);
const isPopout = params.get("popout") === "1";
// A thread in an ordinary window of its own — see ThreadReaderWindow. The
// same one-document arrangement as the popout, with `reader=1` saying so.
const isReader = params.get("reader") === "1";
// A person's mail in a reader window rather than one thread — see
// PersonReaderWindow. With it set, no thread is named.
const person = params.get("person") ?? "";
const account = params.get("account") ?? "";
const threadId = params.get("thread") ?? "";

function Root() {
  // The window buttons on Windows sit over the title strip. Not in the
  // popout, which draws its own card and closes from it, and not in the
  // reader window, which has the system's own.
  if (!isPopout && !isReader) {
    return (
      <>
        <App />
        <WindowControls />
      </>
    );
  }
  if (!(isReader && person) && (!account || !threadId)) {
    return (
      <p className="p-6 text-sm text-stone-500">
        Missing thread reference — open this window from the mail client.
      </p>
    );
  }
  if (isReader) {
    return (
      <ReaderWindow
        account={account}
        threadId={threadId}
        name={params.get("name") ?? ""}
        email={params.get("email") ?? ""}
        subject={params.get("subject") ?? ""}
        person={person || undefined}
      />
    );
  }
  return (
    <ChatPopout
      account={account}
      threadId={threadId}
      personName={params.get("name") ?? ""}
      personEmail={params.get("email") ?? ""}
      subject={params.get("subject") ?? ""}
    />
  );
}

// The popout draws its own rounded card on a transparent window, so the page
// behind it must not paint one.
if (isPopout) document.documentElement.classList.add("dh-popout");

/**
 * Which system the window is on, for the chrome that differs.
 *
 * The Mac window has no system title bar: the traffic lights float over the
 * page, and the interface leaves room for them. The Windows window has no
 * system title bar either, and nothing at the left to leave room for, so the
 * strip is laid out from its own left edge and the window buttons are drawn
 * at the right. See `--mail-titlebar-left` in standalone.css and
 * WindowControls.tsx.
 *
 * `userAgentData` is the reading, not `userAgent`: the window is configured
 * with a Safari user agent string on every system, and this API is separate
 * from it. WKWebView does not implement it at all, so a missing answer is a
 * Mac — which is the default this only departs from.
 */
{
  const platform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  if (platform) document.documentElement.dataset.dhOs = platform.toLowerCase();
  /*
    A phone says so in the user agent the platform configs set —
    `dh-mail-mobile/ios` or `dh-mail-mobile/android`, see
    src-tauri/tauri.ios.conf.json and tauri.android.conf.json. That puts the
    system on the document the way Windows is put there, and turns on the
    phone layout. A browser can ask for the same layout with `?mobile=1`
    or a `VITE_MAIL_MOBILE=1` build (`pnpm ui:dev:phone`), which is how the
    layout is looked at without a phone.
  */
  const phoneOs = hostOsFromUserAgent(navigator.userAgent);
  if (phoneOs) document.documentElement.dataset.dhOs = phoneOs;
  if (
    phoneOs ||
    import.meta.env.VITE_MAIL_MOBILE === "1" ||
    params.get("mobile") === "1"
  ) {
    markPhoneForm();
  }
}

/**
 * The window behind the interface.
 *
 * `.mail-shell` fills the window, but the document under it paints first and
 * paints white. In dark mode that is a flash on start and a white edge while
 * the window resizes, so the theme goes on <html> as well. The interface owns
 * the setting — this only follows it.
 */
function applyWindowTheme() {
  document.documentElement.dataset.theme = readMailColorMode();
}
applyWindowTheme();
// After `data-dh-os` is set above — it reads it to decide whether to run.
showScrollbarsWhileScrolling();
window.addEventListener(MAIL_COLOR_MODE_EVENT, applyWindowTheme);
window.addEventListener("storage", applyWindowTheme);
window
  .matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener("change", applyWindowTheme);

/**
 * Settings… in the app menu, and Cmd+Comma.
 *
 * The menu is native, so it cannot open a panel in the page. Rust sends this
 * event to the main window instead (see src-tauri/src/menu.rs), and the page
 * opens the same panel the title-bar button does. Not in the popout, which
 * has no such panel; Rust only sends it here.
 */
if (!isPopout && !isReader) {
  const tauriEvent = (
    window as unknown as {
      __TAURI__?: {
        event?: {
          listen?: (name: string, handler: () => void) => Promise<() => void>;
        };
      };
    }
  ).__TAURI__?.event;
  void tauriEvent?.listen?.("open-settings", openMailAccountsMenu).catch(() => {});
}

/**
 * The mail pane's first launch takes over what the planner server held. It
 * runs before the interface reads the store, so a mailbox list or a snooze
 * that came across is there on the first paint. See import-planner-state.ts.
 * The popout and the reader window skip it: the main pane has done it or
 * will.
 */
if (!isPopout && !isReader) await importPlannerStateOnce();

/**
 * Trackpad pinch. The shell catches it in AppKit — WKWebView swallows it —
 * and sends it here as a Tauri event; the interface listens for the DOM
 * event, so pass it on. See magnify.rs.
 */
{
  const tauriEvent = (
    window as unknown as {
      __TAURI__?: {
        event?: {
          listen?: (
            name: string,
            handler: (event: { payload: number }) => void
          ) => Promise<() => void>;
        };
      };
    }
  ).__TAURI__?.event;
  void tauriEvent?.listen?.("mail-pinch-scale", (event) => {
    window.dispatchEvent(new CustomEvent("mail-pinch-scale", { detail: event.payload }));
  }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
    {/*
      Five, not the three sonner keeps.

      Toasts stack: the front one whole, the ones behind peeking out by a
      dozen pixels, and hovering the stack fans them out — which is the right
      shape and already works. But past three the older ones stop being drawn
      at all, so a run of quick actions loses the first of them before the
      reader can look. Five is enough to read back over a handful of
      archives, or to see that one press really did raise two toasts.
    */}
    <MailToaster />
  </React.StrictMode>
);

/**
 * The toasts, in the interface's own colour mode. Sonner draws them light
 * unless told, and a pale green card over a dark window read as a shout.
 */
function MailToaster() {
  const colorMode = useMailColorMode();
  return (
    <Toaster
      position="bottom-center"
      theme={colorMode}
      richColors
      closeButton
      visibleToasts={5}
      /*
        Eight seconds for everything, unless a toast says otherwise.

        The archive and delete toasts already ask for eight, so the CRM
        "updated: N changes" — which had the library's four — went down
        while its neighbours stood. One default, and a toast that wants
        longer (the CRM notes detail asks for fourteen) still gets it.
      */
      toastOptions={{ duration: 8000 }}
    />
  );
}
