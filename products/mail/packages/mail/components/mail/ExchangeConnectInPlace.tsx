"use client";

/**
 * The Exchange connect form on the start page, before any mailbox is
 * connected. There is no Settings there to hold the form, so the start page
 * shows it in place of its welcome, and shows the welcome again when the
 * form is done.
 *
 * With a mailbox connected, Settings holds the form (`MailListControls`).
 * In both builds, in the desktop app only.
 */

import * as React from "react";

import {
  ExchangeConnectForm,
  useExchangeConnectRequest,
  useExchangeFormTitle,
} from "@/components/mail/ExchangeConnectForm";
import type { ExchangeConnectRequest } from "@/lib/mail/exchange-connect";
import { useMailT } from "@/lib/mail/i18n";

export function ExchangeConnectInPlace({ children }: { children: React.ReactNode }) {
  const { request, clear } = useExchangeConnectRequest();
  if (!request) return <>{children}</>;
  return <StartPageForm request={request} onClose={clear} />;
}

function StartPageForm({ request, onClose }: { request: ExchangeConnectRequest; onClose: () => void }) {
  const t = useMailT();
  const title = useExchangeFormTitle(request);
  return (
    <div className="w-full max-w-md text-left">
      <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
      <p className="mb-4 mt-2 text-sm leading-relaxed text-stone-600">{t("exchangeFormBody")}</p>
      <ExchangeConnectForm request={request} onClose={onClose} />
    </div>
  );
}
