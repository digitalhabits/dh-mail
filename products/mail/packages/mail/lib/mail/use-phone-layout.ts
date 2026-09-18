/**
 * Whether to draw the phone layout, as a hook.
 *
 * The answer itself is in `host-form.ts`, with no React in it; this
 * subscribes to it. False on the server and on the first paint, so a page
 * the planner renders on the server agrees with itself.
 */

import * as React from "react";

import { PHONE_FORM_EVENT, PHONE_MEDIA, readPhoneLayout } from "@/lib/mail/host-form";

function subscribePhoneLayout(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const media =
    typeof window.matchMedia === "function" ? window.matchMedia(PHONE_MEDIA) : null;
  media?.addEventListener?.("change", onChange);
  window.addEventListener(PHONE_FORM_EVENT, onChange);
  return () => {
    media?.removeEventListener?.("change", onChange);
    window.removeEventListener(PHONE_FORM_EVENT, onChange);
  };
}

export function usePhoneLayout(): boolean {
  return React.useSyncExternalStore(
    subscribePhoneLayout,
    readPhoneLayout,
    () => false
  );
}

