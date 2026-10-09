/**
 * The window buttons on Windows.
 *
 * On a Mac the traffic lights float over the title strip at the left. On
 * Windows the system title bar used to sit above the strip as a second bar,
 * with the buttons in it. The window has no system title bar now (see
 * tauri.windows.conf.json), so the buttons go here: over the strip, at the
 * right, where Windows keeps them. `main.tsx` sets `data-dh-os`; nothing
 * renders on any other system.
 */

import * as React from "react";

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: () => void) => Promise<() => void>;
};

function currentWindow(): TauriWindow | null {
  const w = window as unknown as {
    __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } };
  };
  return w.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

export function isWindowsShell(): boolean {
  return document.documentElement.dataset.dhOs === "windows";
}

/**
 * The shape of a window button, with nothing said about what it does under
 * the pointer.
 *
 * Two backgrounds asked for on one button is one background too many. Close
 * used to carry the ordinary wash and the red both, and the red lost — not
 * to the order they are written in, which counts for nothing, but to the
 * order Tailwind prints them in, where the wash comes later and wins. The
 * white glyph had no rival and arrived anyway, so close under the pointer
 * was a white cross on a pale wash: the one button you must never mistake,
 * and the only one you could not see.
 */
const btnShape =
  "flex h-full w-[46px] items-center justify-center text-[var(--mail-chrome-fg,#292524)] " +
  "focus:outline-none";

/**
 * Minimize and maximize: the chrome's own hover, and a firmer wash of the
 * same while the button is held down.
 */
const btn =
  `${btnShape} hover:bg-[var(--mail-chrome-hover,rgba(0,0,0,0.06))] ` +
  "active:bg-[var(--mail-chrome-active,rgba(0,0,0,0.12))]";

/**
 * Close: red with a white cross, which is what every Windows window does and
 * therefore what this one has to do. #c42b1c is the colour Windows itself
 * uses, and the white is for the red, not for the theme — so it is spelled
 * out here rather than taken from the chrome.
 *
 * Held down, the red lightens rather than darkens, which is the way round
 * Windows does it and the way round Fluent does every pressed state: the
 * same colour, let down a tenth towards what is behind it. Microsoft does
 * not publish the shade — the close button is documented as taking a system
 * colour an app cannot read — so this follows the pattern rather than
 * claiming the number.
 */
const closeBtn =
  `${btnShape} hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90`;

export function WindowControls() {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    const win = currentWindow();
    if (!win) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const read = () => {
      void win.isMaximized().then((v) => {
        if (!cancelled) setMaximized(v);
      });
    };
    read();
    void win.onResized(read).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!isWindowsShell()) return null;

  return (
    <div className="dh-window-controls fixed right-0 top-0 z-[100] flex h-11">
      <button
        type="button"
        className={btn}
        aria-label="Minimize"
        onClick={() => void currentWindow()?.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className={btn}
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void currentWindow()?.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={closeBtn}
        aria-label="Close"
        onClick={() => void currentWindow()?.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
