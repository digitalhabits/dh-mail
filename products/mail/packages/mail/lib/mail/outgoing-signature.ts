/**
 * The signature that goes on one outgoing message.
 *
 * Usually the saved signature of the sending address. The composer can
 * also send its own copy, which the writer changed for this message only
 * (`signatureHtml`). That copy replaces the saved signature on this
 * message. The saved signature does not change.
 *
 * Every send path asks here, so Gmail, Outlook and Exchange agree on which
 * signature a message carries.
 */

import { getMailSignatureSettings } from "@/lib/mail/settings";
import { signaturePlainText } from "@/lib/mail/signature-html";

export type OutgoingSignatureInput = {
  account: string;
  /** False: no signature. Absent or true: a signature. */
  includeSignature?: boolean;
  /**
   * The composer's copy of the signature, changed for this message only.
   * Absent: the saved signature of `account`. An empty string: no
   * signature, because the writer deleted all of it.
   */
  signatureHtml?: string;
};

/** The signature text for this message, or "" for none. */
export async function outgoingSignature(
  input: OutgoingSignatureInput
): Promise<string> {
  if (input.includeSignature === false) return "";
  if (typeof input.signatureHtml === "string") {
    return copyHasContent(input.signatureHtml) ? input.signatureHtml : "";
  }
  return (await getMailSignatureSettings(input.account)).signature;
}

/**
 * True when the copy has words or a picture in it.
 *
 * An editor that the writer emptied still holds `<p><br></p>`. Sent as it
 * is, that is an empty block and two blank lines under the message.
 */
function copyHasContent(html: string): boolean {
  return Boolean(signaturePlainText(html).trim()) || /<img\b/i.test(html);
}
