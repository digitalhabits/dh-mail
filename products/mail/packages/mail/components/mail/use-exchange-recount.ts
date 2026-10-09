"use client";

/**
 * Read the folder list again when an Exchange (EWS) pass brought new counts.
 *
 * The rail reads its folders once, and then only when asked. The Exchange
 * worker keeps new counts after each pass that changed a folder
 * (`exchange-sync.ts`, section 12.3 of `docs/mail-exchange-ews.md`) and says
 * so on the window. One read for a burst of passes.
 */

import * as React from "react";

import { EXCHANGE_FOLDERS_CHANGED_EVENT } from "@/lib/mail/exchange-folders";

const WAIT_MS = 1000;

export function useRecountOnExchangeChange(refresh: () => Promise<unknown>): void {
  const latest = React.useRef(refresh);
  latest.current = refresh;
  React.useEffect(() => {
    let timer: number | null = null;
    const onChange = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void latest.current().catch(() => undefined), WAIT_MS);
    };
    window.addEventListener(EXCHANGE_FOLDERS_CHANGED_EVENT, onChange);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener(EXCHANGE_FOLDERS_CHANGED_EVENT, onChange);
    };
  }, []);
}
