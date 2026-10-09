"use client";

/**
 * A signature as it will look once sent.
 *
 * Its own module because both places that show one would otherwise have to
 * import it from the other: the composer shows it under what is being
 * written, and the signatures dialog shows one per account.
 *
 * Links in it are the words' own colour with a quiet underline, and the
 * underline goes under the pointer — a signature is four lines of small
 * grey text and a blue word in it was the loudest thing on the card.
 *
 * The mail sends the same colour and the same underline, inlined per
 * anchor (see `signatureHtml`), so this shows what will arrive. It does
 * not send the hover: that needs a stylesheet, and mail clients either
 * strip those or, in Outlook's case, have no notion of `:hover` at all.
 * So the underline stays put in the mail, which is also what makes a link
 * findable once it is not blue any more.
 */

import * as React from "react";

import { isLikelyHtml } from "@/lib/client-email-html";

const SIGNATURE_LINK_CLASS =
  "[&_a]:text-inherit [&_a]:underline [&_a]:decoration-stone-300 [&_a]:underline-offset-2 [&_a:hover]:no-underline";

/** Renders a signature: rich HTML from the editor, or legacy plain text. */
export function SignatureContent({ signature }: { signature: string }) {
  if (isLikelyHtml(signature)) {
    return (
      <div
        className={`text-[14px] leading-relaxed text-[#444] ${SIGNATURE_LINK_CLASS} [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-5`}
        dangerouslySetInnerHTML={{ __html: signature }}
      />
    );
  }
  return (
    <p
      className={`whitespace-pre-line text-[14px] leading-relaxed text-[#444] ${SIGNATURE_LINK_CLASS}`}
    >
      <SignaturePreviewText text={signature} />
    </p>
  );
}

const SIGNATURE_MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Renders signature text, showing [text](url) as real links. */
function SignaturePreviewText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SIGNATURE_MARKDOWN_LINK)) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        {match[1]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}
