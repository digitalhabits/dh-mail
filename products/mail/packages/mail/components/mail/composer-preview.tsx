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
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { Button } from "@/components/ui/button";
import { MAIL_PLAIN_LINK_ATTR } from "@/lib/mail/soften-anchors";
import { useMailT } from "@/lib/mail/i18n";

/**
 * Why the two bodies below are frames and not markup in this card.
 *
 * Both of them can hold somebody else's HTML. The quote is the message
 * being answered. The body is the message being written, which is the same
 * markup whenever a mail is written from an older one — see the
 * copy-to-a-new-message path in `MailPage` — or taken back out of the
 * send-later queue in `ThreadPane`.
 *
 * `sanitizeEmailHtml` is a blocklist. It names no `style`, no `svg` and no
 * `math`, and the reader can carry that because its frame answers to
 * `default-src 'none'`. This card is in the app's own document, where a
 * sender's stylesheet is live: it reads the page with attribute selectors,
 * it fetches what it names, and it can hide the window. So the preview
 * shows both bodies in the reader's frame, which is the one place in this
 * app where a stranger's markup is already safe.
 *
 * The frames are given the card's own face, so the preview looks the way it
 * looked when this was markup in the page. See `frameCss` in
 * `EmailHtmlView`.
 */

/**
 * What Tailwind's preflight did to a sender's markup while it sat in the
 * page: no default margins, headings at the surrounding size, lists with no
 * marker until one is asked for, images as blocks.
 *
 * The frame has no preflight, so the browser's own defaults would apply and
 * a quoted heading would come out three times the size it is today.
 */
const PREVIEW_RESET_CSS = [
  "*{box-sizing:border-box}",
  "body{margin:0;padding:0}",
  "p,h1,h2,h3,h4,h5,h6,blockquote,figure,pre,ul,ol,dl,dd{margin:0}",
  "h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}",
  "ul,ol{padding:0;list-style:none}",
  "table{border-collapse:collapse}",
  "img,svg,video{display:block;vertical-align:middle}",
  /*
    The colour a border takes when the sender named a width and no colour.
    Preflight gives it this grey, and the frame would otherwise give it the
    colour of the words — so a plain `border-left:2px` under a quote came
    out grey here and would have come out the colour of the text.
  */
  "*{border-color:rgb(229,231,235)}",
].join("");

/**
 * A link in the preview is the blue the card drew it in.
 *
 * Only a real anchor. Every link a sender wrote is a span by the time the
 * frame sees it (see `softenAnchorsForParse`), and in this card those were
 * never blue: the rule that painted them named `a`, and a span is not one.
 * So the span keeps whatever the sender gave it, as it did here before.
 */
const PREVIEW_LINK_CSS = [
  "a{color:#1d4ed8;text-decoration:underline}",
  `[${MAIL_PLAIN_LINK_ATTR}]{color:inherit;text-decoration:inherit}`,
].join("");

/** The message being written, at the size and colour this card shows it. */
const PREVIEW_BODY_CSS = [
  PREVIEW_RESET_CSS,
  "body{font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.625;color:#222}",
  "p{margin:0 0 12px}",
  "ul{list-style:disc;padding-left:20px}",
  "ol{list-style:decimal;padding-left:20px}",
  PREVIEW_LINK_CSS,
].join("");

/** The message being answered, smaller and greyer, as a quote is here. */
const PREVIEW_QUOTE_CSS = [
  PREVIEW_RESET_CSS,
  "body{font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.625;color:#78716c}",
  "p{margin:6px 0}",
  "blockquote{border-left:1px solid #e7e5e4;padding-left:8px}",
  PREVIEW_LINK_CSS,
].join("");

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
          <EmailHtmlView
            html={bodyHtml}
            /* Pictures show, as they did when this was markup in the page.
               In the frame they are fetched the way the reader fetches
               them: by the shell, with no cookies and no referrer. */
            allowImages
            zoom={zoom}
            frameCss={PREVIEW_BODY_CSS}
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
                  <div className="mt-1">
                    <EmailHtmlView
                      html={quote.html}
                      allowImages
                      zoom={zoom}
                      frameCss={PREVIEW_QUOTE_CSS}
                    />
                  </div>
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
