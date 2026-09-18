"use client";

/**
 * What a message will look like once it is sent.
 *
 * The signature as it will appear, and the quoted original under a reply. Both
 * the composer and the reply box inside a thread show these, which is the only
 * reason they are a module rather than part of either.
 */

import * as React from "react";
import { Eye, SendHorizontal } from "lucide-react";

import { fetchSignatureSettings } from "@/components/mail/SignatureDialog";
import { SignatureContent } from "@/components/mail/signature-view";
import { Button } from "@/components/ui/button";
import { useMailT } from "@/lib/mail/i18n";

/**
 * The signature as it will send, below the message body.
 *
 * Only the signature. Inside the box is what will be sent, exactly as it
 * sends — the buttons that act on it are chrome, and chrome that appears
 * on hover over content is chrome nobody finds. They are on the meta line
 * under the box now; see `SignatureMetaControls`.
 */
export function ComposerSignature({ signature }: { signature: string }) {
  return (
    <div className="px-[15px] pb-3">
      <SignatureContent signature={signature} />
    </div>
  );
}

const SIGNATURE_META_BUTTON =
  "underline-offset-2 hover:text-stone-800 hover:underline";

/**
 * Which signature is on this message, and what can be done about it.
 *
 * Under the box, beside Quote history, because it is the same kind of
 * thing: a fact about the message that is not part of writing it.
 * With no signature on the message it is the one button that puts one
 * there — the same place, saying what is missing rather than what is on.
 */
export function SignatureMetaControls({
  /** Whose signature it is. Signatures are kept per sending address. */
  account,
  /** Whether that address has a signature saved at all. */
  configured,
  /** Whether this message is carrying it. */
  included,
  className = "text-xs text-stone-500",
  onAdd,
  onEdit,
  onRemove,
}: {
  account: string;
  configured: boolean;
  included: boolean;
  className?: string;
  onAdd: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useMailT();
  if (!included || !configured) {
    return (
      <button
        type="button"
        className={`${className} ${SIGNATURE_META_BUTTON}`}
        onClick={onAdd}
      >
        {t("addSignature")}
      </button>
    );
  }
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span className="min-w-0 truncate">
        {/* The space is written, because JSX drops the one in the source
            when a newline goes with it — so it read "Signature:you@…". */}
        {t("signatureColon")}{" "}
        <span className="text-stone-700">{account}</span>
      </span>
      <button
        type="button"
        className={SIGNATURE_META_BUTTON}
        onClick={onEdit}
      >
        {t("edit")}
      </button>
      <button
        type="button"
        className={SIGNATURE_META_BUTTON}
        onClick={onRemove}
      >
        {t("remove")}
      </button>
    </span>
  );
}
/** Quoted/forwarded original shown (and sent) below the message body. */
type PreviewQuote = {
  /** e.g. `On 25 Jul 2026, 11:08, Dana Fisher <dana@example.org> wrote:` */
  /**
   * One line above the quote, e.g. `On 25 Jul, Johan wrote:`. A rebuilt
   * history carries an attribution per message inside its own html, so it
   * passes none.
   */
  intro?: string;
  text: string;
  html?: string;
};
/**
 * Full-card preview of the exact mail the server will send: dark "previewing
 * as X will receive it" header, sender/recipient meta, the body with
 * signature and quoted original, and a footer that can send it.
 */
export function SentPreview({
  fromName,
  from,
  to,
  cc,
  subject,
  bodyHtml,
  hasBody,
  includeSignature,
  quote,
  recipientName,
  sending,
  canSend,
  sendLabel = "Send",
  zoom = 1,
  onSend,
  onBack,
}: {
  /** Display name Gmail attaches to the account, when known. */
  fromName?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  hasBody: boolean;
  includeSignature: boolean;
  quote?: PreviewQuote;
  recipientName: string;
  sending: boolean;
  canSend: boolean;
  sendLabel?: string;
  /** Same reading size as the composer that opened this preview. */
  zoom?: number;
  onSend: () => void;
  onBack: () => void;
}) {
  const t = useMailT();
  const [signature, setSignature] = React.useState("");
  const [showFullQuote, setShowFullQuote] = React.useState(false);

  React.useEffect(() => {
    void fetchSignatureSettings(from)
      .then((s) => setSignature(s.signature))
      .catch(() => setSignature(""));
  }, [from]);

  const quoteSnippet = quote?.text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return (
    <div
      // `mail-light-surface`: this is the message as it will arrive, so it
      // keeps the light palette in dark mode.
      className="mail-light-surface overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
      style={{ zoom }}
    >
      <div className="flex items-center justify-between gap-3 bg-slate-800 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Previewing as {recipientName} will receive it
          </span>
        </p>
        <button
          type="button"
          className="shrink-0 rounded-full border border-white/40 px-3.5 py-1 text-xs font-medium text-white hover:bg-white/10"
          onClick={onBack}
        >
          {t("backToEditing")}
        </button>
      </div>

      <div className="border-b border-stone-200 px-5 py-3 text-sm">
        <p className="text-stone-800">
          <span className="font-bold">{fromName || from}</span>
          {fromName ? (
            <span className="text-stone-500"> &lt;{from}&gt;</span>
          ) : null}
        </p>
        <p className="mt-0.5 break-words text-stone-500">
          to {to.join(", ") || "—"}
        </p>
        {cc?.length ? (
          <p className="mt-0.5 break-words text-stone-500">
            cc {cc.join(", ")}
          </p>
        ) : null}
        <p className="mt-1.5 font-bold text-stone-900">
          {subject || "(no subject)"}
        </p>
      </div>

      <div
        className="max-h-[38vh] overflow-y-auto px-5 py-4"
        style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
      >
        {hasBody ? (
          <div
            className="text-[16px] leading-relaxed text-[#222] [&_a]:text-blue-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <p className="text-sm text-stone-400">
            (Your message will appear here.)
          </p>
        )}

        {includeSignature && signature ? (
          <div className="mt-4">
            <SignatureContent signature={signature} />
          </div>
        ) : null}

        {quote ? (
          <div className="mt-5 border-l-2 border-stone-200 pl-3 text-sm leading-relaxed text-stone-500">
            {quote.intro ? (
              <p className="whitespace-pre-line">{quote.intro}</p>
            ) : null}
            {showFullQuote ? (
              <>
                {quote.html ? (
                  <div
                    className="mt-1 [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:border-stone-200 [&_blockquote]:pl-2 [&_img]:max-w-full [&_p]:my-1.5"
                    dangerouslySetInnerHTML={{ __html: quote.html }}
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-line">{quote.text}</p>
                )}
                <button
                  type="button"
                  className="mt-1 text-blue-600 underline-offset-2 hover:underline"
                  onClick={() => setShowFullQuote(false)}
                >
                  {t("showLess")}
                </button>
              </>
            ) : (
              <p className="mt-0.5">
                <span className="line-clamp-1 inline">
                  {quoteSnippet
                    ? `${quoteSnippet.slice(0, 90)}${quoteSnippet.length > 90 ? "…" : ""}`
                    : "(no text)"}
                </span>{" "}
                <button
                  type="button"
                  className="whitespace-nowrap text-blue-600 underline-offset-2 hover:underline"
                  onClick={() => setShowFullQuote(true)}
                >
                  {t("showMore")}
                </button>
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* The same Send as the box this was opened from — the arrow too.
          It is the same button doing the same thing, and the preview is
          the last place to make somebody check that it is. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3">
        <Button
          type="button"
          className="h-8 rounded-lg bg-teal-600 pl-4 pr-5 text-sm font-semibold text-white hover:bg-teal-700"
          disabled={!canSend || sending}
          onClick={onSend}
        >
          <SendHorizontal aria-hidden className="!size-3.5" />
          {sending ? "Sending…" : sendLabel}
        </Button>
      </div>
    </div>
  );
}
