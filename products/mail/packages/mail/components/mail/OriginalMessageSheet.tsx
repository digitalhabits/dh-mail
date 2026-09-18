"use client";

/**
 * The message as it came, over the thread — Gmail's "Show original".
 *
 * A sheet, not a dialog: it takes the reading pane and leaves the rest of
 * the window where it was, so the reader keeps their place in the list and
 * comes back to the thread with one key. Above the source, a strip answers
 * what people open this for — who really sent it, when it got here, and
 * whether SPF, DKIM and DMARC passed — read off the headers.
 */

import * as React from "react";
import { Copy, Download, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { mailApiFetch } from "@/lib/mail/api";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import {
  hostSavesAttachments,
  saveAttachment,
} from "@/lib/mail/attachment-source";
import {
  summarizeOriginalMessage,
  type AuthMethod,
  type OriginalMessageSummary,
} from "@/lib/mail/original-message";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/** Where the host serves one message's RFC 5322 source. */
export function messageSourcePath(input: {
  account: string;
  messageId: string;
  download?: boolean;
  filename?: string;
}): string {
  const params = new URLSearchParams({
    account: input.account,
    messageId: input.messageId,
  });
  if (input.download) params.set("download", "1");
  if (input.filename) params.set("filename", input.filename);
  return `/api/mail/message/source?${params.toString()}`;
}

/** A file name the subject can be, or "message". */
function emlFileName(subject: string): string {
  const base = subject
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "message"}.eml`;
}

const AUTH_METHODS: Array<{ method: AuthMethod; label: string }> = [
  { method: "spf", label: "SPF" },
  { method: "dkim", label: "DKIM" },
  { method: "dmarc", label: "DMARC" },
];

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-sm text-stone-700 hover:bg-[var(--mail-chrome-hover)] disabled:opacity-50";

export function OriginalMessageSheet({
  account,
  messageId,
  subject,
  onClose,
}: {
  account: string;
  messageId: string;
  subject: string;
  onClose: () => void;
}) {
  const t = useMailT();
  const [source, setSource] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    (async () => {
      try {
        const res = await mailApiFetch(messageSourcePath({ account, messageId }));
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `${res.status}`);
        }
        const text = await res.text();
        if (!cancelled) setSource(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, messageId]);

  // Esc closes the sheet and nothing behind it: the thread pane's own
  // Escape would otherwise close the thread under the reader's feet.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const summary = React.useMemo<OriginalMessageSummary | null>(
    () => (source ? summarizeOriginalMessage(source) : null),
    [source]
  );

  async function copySource() {
    if (!source) return;
    if (await copyTextToClipboard(source)) toast.success(t("originalCopied"));
  }

  async function download() {
    if (!source) return;
    const filename = emlFileName(subject);
    setSaving(true);
    try {
      if (hostSavesAttachments) {
        await saveAttachment({
          path: messageSourcePath({ account, messageId, download: true, filename }),
          filename,
        });
      } else {
        const url = URL.createObjectURL(
          new Blob([source], { type: "message/rfc822" })
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const missing = (
    <span className="text-stone-400">{t("originalNoHeader")}</span>
  );

  return (
    <div
      role="dialog"
      aria-label={t("originalMessage")}
      className="absolute inset-0 z-30 flex flex-col bg-white text-stone-800"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-4 py-2.5">
        <h2 className="text-sm font-medium">{t("originalMessage")}</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={!source}
            onClick={() => void copySource()}
          >
            <Copy className="h-3.5 w-3.5 text-stone-400" aria-hidden />
            {t("originalCopy")}
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={!source || saving}
            onClick={() => void download()}
          >
            <Download className="h-3.5 w-3.5 text-stone-400" aria-hidden />
            {t("originalDownload")}
          </button>
          <button
            type="button"
            aria-label={t("close")}
            title={t("close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-[var(--mail-chrome-hover)] hover:text-stone-800"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {summary ? (
        <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <dt className="text-stone-500">{t("originalFrom")}</dt>
          <dd className="min-w-0 break-words">{summary.from ?? missing}</dd>
          <dt className="text-stone-500">{t("originalDelivered")}</dt>
          <dd className="min-w-0">
            {summary.deliveredAt ? (
              <>
                {summary.deliveredAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {summary.deliveredAfterSeconds != null ? (
                  <span className="text-stone-500">
                    {" · "}
                    {summary.deliveredAfterSeconds === 1
                      ? t("originalDeliveredAfterOne")
                      : t("originalDeliveredAfter", {
                          seconds: summary.deliveredAfterSeconds,
                        })}
                  </span>
                ) : null}
              </>
            ) : (
              missing
            )}
          </dd>
          <dt className="text-stone-500">{t("originalAuth")}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            {AUTH_METHODS.map(({ method, label }) => {
              const verdict = summary.auth[method];
              return (
                <span key={method} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 rounded-full",
                      verdict === "pass"
                        ? "bg-emerald-500"
                        : verdict == null || verdict === "none"
                          ? "bg-stone-300"
                          : "bg-red-500"
                    )}
                  />
                  <span className="text-stone-500">{label}</span>
                  <span>{verdict ?? "—"}</span>
                </span>
              );
            })}
          </dd>
        </dl>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {source ? (
          <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-5">
            {source}
          </pre>
        ) : error ? (
          <p className="text-sm text-red-600">
            {t("originalFailed")}
            {error ? ` — ${error}` : ""}
          </p>
        ) : (
          <p className="text-sm text-stone-500">{t("originalLoading")}</p>
        )}
      </div>
    </div>
  );
}
