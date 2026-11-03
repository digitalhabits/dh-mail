"use client";

/**
 * Save Diagnostics…: the report, shown before it is saved.
 *
 * Opened from Help → Save Diagnostics… (the menu sends `save-diagnostics`,
 * src/main.tsx turns it into OPEN_DIAGNOSTICS_EVENT) and from Settings →
 * Advanced. The report is built when the dialog opens: each mailbox by its
 * number and kind, what holds it now and its hours, its sync's state, and
 * the end of the log, scrubbed as a whole (lib/mail/diagnostics.ts). The
 * reader reads it, and saves it or has it put in an email to the team
 * (Send to us…), which they read and send themselves. Nothing goes by itself.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import {
  buildDiagnosticsReport,
  diagEvent,
  diagHours,
  diagOffset,
  diagTime,
  mailboxNumber,
  type DiagMailbox,
} from "@/lib/mail/diagnostics";
import { useMailT } from "@/lib/mail/i18n";
import { newComposeDraftKey, saveComposeDraft } from "@/lib/mail/local-drafts";
import { toast } from "@/lib/mail/toast";
import {
  accountFollowsAllHours,
  mailPauseVerdict,
  mailPauseVerdictForAccount,
  quietHoursForAccount,
  type MailPauseState,
} from "@/lib/mail/quiet-hours";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { useMailColorMode } from "@/lib/mail/theme";
import { mailProviderFor } from "@/lib/mail/use-outlook-accounts";
import { useMailSyncStates } from "@/lib/mail/use-sync-states";
import type { MailSyncState } from "@/lib/mail/store/types";

/** Ask the page to open the dialog: the menu's event and the Settings row. */
export const OPEN_DIAGNOSTICS_EVENT = "dh-mail-open-diagnostics";

export function openDiagnostics(): void {
  window.dispatchEvent(new Event(OPEN_DIAGNOSTICS_EVENT));
}

/** Where a report is sent: the team, who read every one. */
export const DIAGNOSTICS_ADDRESS = "team@digitalhabits.org";

type ComposeSeed = { to: string[]; subject: string; continuedFromLabel: string; draftKey?: string };

type Props = {
  /** Every mailbox, the hidden ones too. */
  accounts: string[];
  /** The mailboxes a message can be sent from now; the first writes the email. */
  sendFrom: string[];
  /** Open the composer on a draft (useComposeStart). */
  startCompose: (seed: ComposeSeed) => void;
  isOutlookAccount: (email: string) => boolean;
  pauseState: MailPauseState;
  hide: MailboxHideControls;
};

function stateOf(email: string, pauseState: MailPauseState, hide: MailboxHideControls, now: Date): string {
  const parts: string[] = [];
  const status = hide.statusOf(email);
  if (status.hidden) {
    if (status.byHand) parts.push("hidden by you, until shown");
    else if (status.reason === "until") parts.push(`hidden by you until ${diagTime(status.until)}`);
    else parts.push(`hidden by schedule until ${diagTime(status.endsAt ?? null)}`);
  }
  const verdict = mailPauseVerdictForAccount(pauseState, email, now);
  if (verdict.paused) {
    parts.push(
      verdict.reason === "pause"
        ? `new mail paused by you until ${diagTime(verdict.until)}`
        : `new mail paused by schedule until ${diagTime(verdict.endsAt ?? null)}`
    );
  }
  return parts.length ? parts.join(" · ") : "as usual";
}

function syncOf(email: string, states: MailSyncState[]): string {
  const key = email.trim().toLowerCase();
  const inbox = states.find((row) => row.account.toLowerCase() === key && row.folder === "");
  if (!inbox) return "no sync state";
  const parts = [String(inbox.phase)];
  if (inbox.lastOkAt) parts.push(`last ok ${diagTime(inbox.lastOkAt)}`);
  // The start of the error: its code and a few words, scrubbed with the rest.
  if (inbox.lastError) parts.push(`last error: ${inbox.lastError.slice(0, 120)}`);
  return parts.join(" · ");
}

function appVersion(): Promise<string> {
  const app = (window as unknown as { __TAURI__?: { app?: { getVersion?: () => Promise<string> } } }).__TAURI__?.app;
  return app?.getVersion ? app.getVersion().catch(() => "unknown") : Promise.resolve("browser");
}

function osName(): string {
  const ua = navigator.userAgent;
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "other";
}

/**
 * After a run that crashed (or, in a release build, did not end normally),
 * offer the report once: a toast with Save diagnostics… on it. The marker
 * goes as it is read, so it is offered once (diagnostics.rs).
 */
function useOfferAfterCrash(t: ReturnType<typeof useMailT>) {
  React.useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    void Promise.resolve(invoke("mail_diagnostics_last_crash", {}))
      .then((crashed) => {
        if (crashed !== true) return;
        diagEvent("offered diagnostics after a crash");
        toast.message(t("diagnosticsAfterCrash"), {
          duration: 20_000,
          action: { label: t("diagnosticsMenu"), onClick: openDiagnostics },
        });
      })
      .catch(() => {});
  }, [t]);
}

/** How long the list of mailboxes must stand still before the start is written. */
const START_SETTLE_MS = 4000;

/**
 * One line when the app starts, once its mailboxes are known: the version,
 * the system, and how many mailboxes of which kind. So a log shows where
 * each run began.
 *
 * Written once the list has stood still for a few seconds: the mailboxes
 * come in by provider, and the first count was two Gmail mailboxes on a Mac
 * with five (2026-11-02).
 */
function useAppStartLine(accounts: string[], isOutlookAccount: (email: string) => boolean) {
  const done = React.useRef(false);
  // The list as a value: the page hands over a new array on every render,
  // which would start the wait again each time.
  const key = accounts.map((email) => email.toLowerCase()).sort().join("\n");
  const latest = React.useRef({ accounts, isOutlookAccount });
  React.useEffect(() => {
    latest.current = { accounts, isOutlookAccount };
  });
  React.useEffect(() => {
    if (done.current || !key) return;
    const timer = window.setTimeout(() => {
      done.current = true;
      writeStartLine(latest.current.accounts, latest.current.isOutlookAccount);
    }, START_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
}

function writeStartLine(accounts: string[], isOutlookAccount: (email: string) => boolean) {
  const kinds = new Map<string, number>();
  for (const email of accounts) {
    const kind = mailProviderFor(email, isOutlookAccount);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  void appVersion().then((version) =>
    diagEvent("app start", {
      version,
      os: osName(),
      zone: diagOffset(new Date()),
      mailboxes: accounts.length,
      kinds: [...kinds].map(([kind, n]) => `${kind} ${n}`).join(", "),
    })
  );
}

/** The report's text as base64, from its UTF-8 bytes. */
function base64Of(text: string): { base64: string; size: number } {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { base64: btoa(binary), size: bytes.length };
}

export function DiagnosticsDialog({ accounts, sendFrom, startCompose, isOutlookAccount, pauseState, hide }: Props) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  const syncStates = useMailSyncStates();
  const [open, setOpen] = React.useState(false);
  const [report, setReport] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  useAppStartLine(accounts, isOutlookAccount);
  useOfferAfterCrash(t);

  // Read when it opens: the state then is what the report is about.
  const inputs = React.useRef({ accounts, isOutlookAccount, pauseState, hide, syncStates });
  React.useEffect(() => {
    inputs.current = { accounts, isOutlookAccount, pauseState, hide, syncStates };
  });

  React.useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setReport(null);
      setSaved(null);
      setFailed(false);
      void (async () => {
        const now = new Date();
        const { accounts: emails, isOutlookAccount: isOutlook, pauseState: pause, hide: hidden, syncStates: states } = inputs.current;
        const mailboxes: DiagMailbox[] = emails.map((email) => ({
          number: mailboxNumber(email),
          kind: mailProviderFor(email, isOutlook),
          state: stateOf(email, pause, hidden, now),
          hours: [
            `hidden ${diagHours(hidden.hoursOf(email))}`,
            accountFollowsAllHours(pause, email) ? "quiet: same as all" : `quiet ${diagHours(quietHoursForAccount(pause, email))}`,
          ].join(" · "),
          sync: syncOf(email, states),
        }));
        const all = mailPauseVerdict(pause, now);
        mailboxes.unshift({
          number: "all mailboxes",
          kind: "setting",
          state: all.paused ? (all.reason === "pause" ? `paused by you until ${diagTime(all.until)}` : "quiet by schedule") : "as usual",
          hours: `quiet ${diagHours(pause.quietHours)}`,
          sync: "-",
        });
        const invoke = tauriInvoke();
        const log = invoke ? await Promise.resolve(invoke("mail_diagnostics_log", {})).then(String).catch(() => "") : "";
        setReport(
          buildDiagnosticsReport({
            app: "Digital Habits Mail",
            version: await appVersion(),
            os: osName(),
            madeAt: now,
            mailboxes,
            log,
          })
        );
        diagEvent("diagnostics opened", { mailboxes: emails.length });
      })();
    };
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen);
  }, []);

  const save = async () => {
    if (!report) return;
    const invoke = tauriInvoke();
    if (!invoke) return;
    const day = diagTime(new Date()).slice(0, 10);
    try {
      const path = (await invoke("mail_diagnostics_save", { text: report, fileName: `Mail diagnostics ${day}.txt` })) as string | null;
      // The file's name only: its folder names the person's account.
      if (path) setSaved(path.split(/[\\/]/).pop() ?? path);
    } catch {
      setFailed(true);
    }
  };

  /*
    Send to us…: a new email from the first mailbox it can be sent from, to
    the team, with the report attached and a line to finish. Saved as a
    draft and opened in the composer, so the reader reads it and sends it.
    If Mail itself is what is broken, Save… and the address are still here.
  */
  const from = sendFrom[0] ?? null;
  const sendToUs = async () => {
    if (!report || !from) return;
    const key = newComposeDraftKey();
    const day = diagTime(new Date()).slice(0, 10);
    const file = base64Of(report);
    try {
      await saveComposeDraft({
        key,
        kind: "compose",
        from,
        subject: `Mail diagnostics ${day}`,
        body: `<p>${t("diagnosticsEmailBody")}</p><p><br></p>`,
        toList: [{ kind: "email", email: DIAGNOSTICS_ADDRESS }],
        ccList: [],
        bccList: [],
        showCc: false,
        showBcc: false,
        includeSignature: true,
        attachments: [
          {
            id: globalThis.crypto?.randomUUID?.() ?? `diagnostics-${Date.now()}`,
            filename: `Mail diagnostics ${day}.txt`,
            mimeType: "text/plain",
            size: file.size,
            progress: null,
            contentBase64: file.base64,
          },
        ],
      });
    } catch {
      setFailed(true);
      return;
    }
    diagEvent("diagnostics put in an email", { from: mailboxNumber(from) });
    setOpen(false);
    startCompose({ to: [], subject: "", continuedFromLabel: "", draftKey: key });
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[2200] bg-[#1b3d4a]/20" />
        <DialogPrimitive.Content
          data-theme={colorMode}
          data-diagnostics=""
          className="mail-shell mail-popover fixed left-1/2 top-1/2 z-[2201] flex max-h-[min(80vh,44rem)] w-[calc(100%-3rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog border border-stone-200 bg-white p-5 shadow-xl"
        >
          <DialogPrimitive.Title className="text-base font-semibold text-stone-900">{t("diagnosticsTitle")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-stone-600">
            {t("diagnosticsLead")}
          </DialogPrimitive.Description>
          <pre className="mt-3 min-h-[10rem] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-control bg-stone-100 p-3 font-mono text-xs leading-relaxed text-stone-800">
            {report ?? t("diagnosticsMaking")}
          </pre>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm leading-snug text-stone-600">
              {saved ? t("diagnosticsSaved", { file: saved }) : failed ? t("diagnosticsCouldNotSave") : t("diagnosticsSendHint")}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t(saved ? "done" : "cancel")}
              </Button>
              <Button type="button" variant="outline" disabled={!report || !tauriInvoke()} onClick={() => void save()}>
                {t("diagnosticsSave")}
              </Button>
              <Button
                type="button"
                disabled={!report || !from}
                title={from ? undefined : t("diagnosticsEmailNoMailbox")}
                onClick={() => void sendToUs()}
              >
                {t("diagnosticsEmail")}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
