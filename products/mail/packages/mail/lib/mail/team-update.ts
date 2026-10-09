"use client";

/**
 * The update bar's state, for the apps that update themselves, such as the
 * public Mail app's direct downloads.
 *
 * The shell checks for a newer version (for the public app, the GitHub
 * release) and downloads it in the background (`team_update.rs` in
 * mail-native). When one is ready, it says
 * so with `dh-team-update-ready`. This hook listens for that, asks once at
 * mount in case the event went out before the page was listening, and gives
 * the bar its one action: install and restart.
 *
 * Where there is no updater — the browser, a store package, the demo — the
 * commands do not exist, the first call fails, and the hook stays empty.
 */

import * as React from "react";

export type TeamUpdate = { version: string; notes?: string | null };

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

function tauri(): { invoke?: Invoke; listen?: Listen } {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke }; event?: { listen?: Listen } };
  };
  return { invoke: w.__TAURI__?.core?.invoke, listen: w.__TAURI__?.event?.listen };
}

function asUpdate(value: unknown): TeamUpdate | null {
  if (!value || typeof value !== "object") return null;
  const { version, notes } = value as Record<string, unknown>;
  if (typeof version !== "string" || !version) return null;
  return { version, notes: typeof notes === "string" ? notes : null };
}

export function useTeamUpdate(enabled = true) {
  const [update, setUpdate] = React.useState<TeamUpdate | null>(null);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const { invoke, listen } = tauri();
    if (!invoke) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void invoke<unknown>("team_update_status")
      .then((value) => {
        if (!cancelled) setUpdate(asUpdate(value));
      })
      .catch(() => {});
    void listen?.("dh-team-update-ready", (event) => {
      const next = asUpdate(event.payload);
      if (next) {
        setUpdate(next);
        setError(null);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  const install = React.useCallback(async () => {
    const { invoke } = tauri();
    if (!invoke) return;
    setInstalling(true);
    setError(null);
    try {
      // On success the app quits and starts again; nothing after this runs.
      await invoke("team_update_install");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  }, []);

  /** "Later": hide the bar for this version. It still installs on quit. */
  const later = React.useCallback(() => {
    if (update) setDismissed(update.version);
  }, [update]);

  const shown = update && dismissed !== update.version ? update : null;
  return { update: shown, installing, error, install, later };
}
