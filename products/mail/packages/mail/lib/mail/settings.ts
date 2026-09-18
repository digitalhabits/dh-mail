/**
 * Signature settings.
 *
 * The rules live here: the defaults, the JSON shape, and the fallback to the
 * older shared signature. The store moves strings only. See
 * `@/lib/mail/store/types`.
 */

import { mailStore } from "@/lib/mail/store";
import {
  readOnReplies,
  SIGNATURE_ON_REPLIES_DEFAULT,
  type SignatureOnReplies,
} from "@/lib/mail/signature-rules";

const SIGNATURE_KEY = "mail_signature";

export type MailSignatureSettings = {
  /** Rich HTML; legacy signatures are plain text with [text](url) links. */
  signature: string;
  includeOnNew: boolean;
  onReplies: SignatureOnReplies;
};

const SIGNATURE_DEFAULTS = {
  includeOnNew: true,
  onReplies: SIGNATURE_ON_REPLIES_DEFAULT,
};

function signatureKey(account: string): string {
  return `${SIGNATURE_KEY}:${account.trim().toLowerCase()}`;
}

/** Pre-per-account signature, kept as the fallback for unmigrated accounts. */
async function getLegacySignature(): Promise<string> {
  return (await mailStore().settings.get(SIGNATURE_KEY)) ?? "";
}

export async function getMailSignatureSettings(
  account: string
): Promise<MailSignatureSettings> {
  const raw = await mailStore().settings.get(signatureKey(account));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<MailSignatureSettings> & {
        /** What was stored before replies had three answers. */
        includeOnReplies?: boolean;
      };
      return {
        signature: parsed.signature ?? "",
        includeOnNew: parsed.includeOnNew ?? SIGNATURE_DEFAULTS.includeOnNew,
        onReplies: readOnReplies(parsed),
      };
    } catch {
      // Fall through to the legacy shared signature.
    }
  }
  return { signature: await getLegacySignature(), ...SIGNATURE_DEFAULTS };
}

export async function setMailSignatureSettings(
  account: string,
  settings: MailSignatureSettings
): Promise<void> {
  const value = JSON.stringify({
    signature: settings.signature.trim(),
    includeOnNew: settings.includeOnNew,
    onReplies: settings.onReplies,
    // Also as the old tick, so a build from before this reads the setting
    // rather than falling back to its own default.
    includeOnReplies: settings.onReplies === "every",
  });
  await mailStore().settings.set(signatureKey(account), value);
}
