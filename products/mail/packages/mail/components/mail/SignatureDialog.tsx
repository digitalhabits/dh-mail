"use client";

import * as React from "react";
import { toast } from "@/lib/mail/toast";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  SettingsDialog,
  SettingsGroup,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import { SignatureContent } from "@/components/mail/signature-view";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { useMailT } from "@/lib/mail/i18n";
import {
  readOnReplies,
  type SignatureOnReplies,
} from "@/lib/mail/signature-rules";
import { cn } from "@/lib/utils";
import {
  htmlToPlainText,
  isLikelyHtml,
  normalizeEditorHtml,
} from "@/lib/client-email-html";

export type { SignatureOnReplies };

export type SignatureSettings = {
  /** Rich HTML; legacy signatures are plain text with [text](url) links. */
  signature: string;
  includeOnNew: boolean;
  /** See `MailSignatureOnReplies` in `@/lib/mail/settings`. */
  onReplies: SignatureOnReplies;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Legacy plain-text signatures (with [text](url) links) as Quill HTML. */
export function signatureToEditorHtml(signature: string): string {
  const trimmed = signature.trim();
  if (!trimmed) return "";
  if (isLikelyHtml(trimmed)) return normalizeEditorHtml(trimmed);
  return trimmed
    .split("\n")
    .map((line) => {
      let html = "";
      let lastIndex = 0;
      for (const match of line.matchAll(MARKDOWN_LINK)) {
        html += escapeHtml(line.slice(lastIndex, match.index));
        html += `<a href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`;
        lastIndex = match.index + match[0].length;
      }
      html += escapeHtml(line.slice(lastIndex));
      return `<p>${html || "<br>"}</p>`;
    })
    .join("");
}


/** What an address with no signature saved looks like. */
const EMPTY_SETTINGS: SignatureSettings = {
  signature: "",
  includeOnNew: false,
  onReplies: "never",
};

/** Per-account cache shared by the composers and this dialog. */
const settingsCache = new Map<string, SignatureSettings>();

export async function fetchSignatureSettings(
  account: string
): Promise<SignatureSettings> {
  const cached = settingsCache.get(account);
  if (cached) return cached;
  const json = await apiJson<SignatureSettings>(
    `/api/mail/signature?account=${encodeURIComponent(account)}`
  );
  const settings: SignatureSettings = {
    signature: json.signature,
    includeOnNew: json.includeOnNew,
    // A store older than this build answers with the tick, not the word.
    onReplies: readOnReplies(json),
  };
  settingsCache.set(account, settings);
  return settings;
}

/**
 * Every account's signature, on one card.
 *
 * It used to show one account at a time behind a dropdown, which meant the
 * only way to find out which addresses still had no signature was to open
 * the menu and try each of them. They are all here now, each saying what it
 * has, in the same grouped-card shape as the rest of settings.
 *
 * Editing one opens the editor over the list, for that account alone. The
 * two "include by default" boxes are not edited — they are settings, and
 * they save as they are ticked.
 */
export function SignatureDialog({
  open,
  accounts,
  initialAccount,
  onClose,
  onSaved,
}: {
  open: boolean;
  accounts: string[];
  initialAccount?: string;
  onClose: () => void;
  onSaved: (account: string, settings: SignatureSettings) => void;
}) {
  const t = useMailT();
  const [settings, setSettings] = React.useState<
    Record<string, SignatureSettings>
  >({});
  const [loaded, setLoaded] = React.useState(false);
  /** The account whose signature is open in the editor, if any. */
  const [editing, setEditing] = React.useState<string | null>(null);
  /** The editor's working copy, kept out of `settings` until it is saved. */
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setEditing(null);
    setLoaded(false);
    let cancelled = false;
    // All of them, not the one being written from: the card's whole point
    // is that it says which addresses are still without.
    void Promise.all(
      accounts.map((account) =>
        fetchSignatureSettings(account)
          .then((s) => [account, { ...s }] as const)
          .catch(() => [account, EMPTY_SETTINGS] as const)
      )
    ).then((pairs) => {
      if (cancelled) return;
      setSettings(Object.fromEntries(pairs));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, accounts]);

  /** Writes one account's settings, and tells the composer that opened this. */
  const persist = async (account: string, next: SignatureSettings) => {
    const previous = settings[account];
    setSettings((all) => ({ ...all, [account]: next }));
    try {
      await apiJson("/api/mail/signature", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, ...next }),
      });
      settingsCache.set(account, next);
      onSaved(account, next);
      return true;
    } catch (err) {
      // Back to what it was. A tick that stayed down while the setting
      // behind it did not is worse than a tick that springs back.
      if (previous) setSettings((all) => ({ ...all, [account]: previous }));
      toast.error(err instanceof Error ? err.message : t("couldNotSave"));
      return false;
    }
  };

  const saveEditor = async () => {
    if (!editing) return;
    setSaving(true);
    // A cleared editor still reports `<p><br></p>`; store that as empty.
    const signature = htmlToPlainText(draft).trim()
      ? normalizeEditorHtml(draft).trim()
      : "";
    const current = settings[editing] ?? EMPTY_SETTINGS;
    const ok = await persist(editing, { ...current, signature });
    setSaving(false);
    if (ok) {
      toast.success(t("signatureSaved"));
      setEditing(null);
    }
  };

  if (!open) return null;

  if (editing) {
    return (
      <SettingsDialog
        title={t("signature")}
        subtitle={editing}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button
              type="button"
              className={settingsSecondaryButton}
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className={settingsPrimaryButton}
              disabled={saving}
              onClick={() => void saveEditor()}
            >
              {saving ? t("saving") : t("save")}
            </button>
          </>
        }
      >
        <div className="rounded-xl bg-white">
          <RichTextEditor
            key={editing}
            className="signature-editor"
            defaultValue={signatureToEditorHtml(
              settings[editing]?.signature ?? ""
            )}
            onChange={setDraft}
            placeholder={t("signaturePlaceholder")}
            minHeight={130}
          />
        </div>
      </SettingsDialog>
    );
  }

  return (
    <SettingsDialog
      title={t("signatures")}
      subtitle={t("signaturesSubtitle")}
      onClose={onClose}
      footer={
        <button
          type="button"
          className={settingsPrimaryButton}
          onClick={onClose}
        >
          {t("done")}
        </button>
      }
    >
      {loaded ? (
        <SettingsGroup>
          {accounts.map((account) => (
            <SignatureAccountSection
              key={account}
              account={account}
              settings={settings[account] ?? EMPTY_SETTINGS}
              /* Somewhere to copy from: the other addresses that have one.
                 An account with no signature is usually not the first one
                 set up, and the one before it is most of the answer. */
              copyFrom={accounts.filter(
                (other) => other !== account && settings[other]?.signature
              )}
              onEdit={() => {
                // The editor's own form of it, which is what the editor
                // will report back. Saving without typing anything then
                // stores what was already there rather than converting a
                // legacy signature by accident.
                setDraft(
                  signatureToEditorHtml(settings[account]?.signature ?? "")
                );
                setEditing(account);
              }}
              onCopyFrom={(source) => {
                const from = settings[source]?.signature ?? "";
                void persist(account, {
                  ...(settings[account] ?? EMPTY_SETTINGS),
                  signature: from,
                });
              }}
              onToggle={(patch) =>
                void persist(account, {
                  ...(settings[account] ?? EMPTY_SETTINGS),
                  ...patch,
                })
              }
            />
          ))}
        </SettingsGroup>
      ) : (
        <p className="py-8 text-center text-sm text-stone-400">
          {t("loading")}
        </p>
      )}
    </SettingsDialog>
  );
}

/** One address on the card: what it signs with, and when. */
function SignatureAccountSection({
  account,
  settings,
  copyFrom,
  onEdit,
  onCopyFrom,
  onToggle,
}: {
  account: string;
  settings: SignatureSettings;
  copyFrom: string[];
  onEdit: () => void;
  onCopyFrom: (source: string) => void;
  onToggle: (patch: Partial<SignatureSettings>) => void;
}) {
  const t = useMailT();
  const has = Boolean(settings.signature.trim());
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-stone-800">
          {account}
        </p>
        <button
          type="button"
          className="shrink-0 text-sm text-teal-700 underline-offset-2 hover:underline"
          onClick={onEdit}
        >
          {t("edit")}
        </button>
      </div>

      {/* On white, because the signature is a piece of the mail and the
          mail is white. The card around it is chrome. */}
      <div className="mail-light-surface mt-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
        {has ? (
          <SignatureContent signature={settings.signature} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-stone-400">{t("noSignatureYet")}</p>
            {copyFrom.length ? (
              <CopyFromControl accounts={copyFrom} onPick={onCopyFrom} />
            ) : null}
          </div>
        )}
      </div>

      {has ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <IncludeCheckbox
            label={t("onNewMessages")}
            checked={settings.includeOnNew}
            onChange={(includeOnNew) => onToggle({ includeOnNew })}
          />
          <RepliesChoice
            value={settings.onReplies}
            onChange={(onReplies) => onToggle({ onReplies })}
          />
        </div>
      ) : null}
    </div>
  );
}

function IncludeCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded accent-teal-700"
      />
      {label}
    </label>
  );
}

/**
 * How much of a conversation the signature goes on.
 *
 * Three words rather than a tick, because the answer people want is the
 * middle one: sign the message that introduces you, and leave the back and
 * forth after it plain. A checkbox could only offer the ends.
 */
function RepliesChoice({
  value,
  onChange,
}: {
  value: SignatureOnReplies;
  onChange: (next: SignatureOnReplies) => void;
}) {
  const t = useMailT();
  const options: { key: SignatureOnReplies; label: string }[] = [
    { key: "never", label: t("onRepliesNever") },
    { key: "first", label: t("onRepliesFirst") },
    { key: "every", label: t("onRepliesEvery") },
  ];
  return (
    <div className="flex items-center gap-2 text-sm text-stone-700">
      <span>{t("onRepliesLabel")}</span>
      <div className="flex items-center rounded-lg border border-stone-200 bg-stone-50 p-0.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              value === option.key
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-800"
            )}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Take another address's signature as a starting point.
 *
 * One other address with one is the common case and needs no menu — it
 * says whose it will take. More than one, and it has to ask.
 */
function CopyFromControl({
  accounts,
  onPick,
}: {
  accounts: string[];
  onPick: (account: string) => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const label =
    accounts.length === 1
      ? t("copyFromAccount", { account: accounts[0] })
      : t("copyFrom");

  if (accounts.length === 1) {
    return (
      <button
        type="button"
        className="shrink-0 text-sm font-medium text-teal-700 underline-offset-2 hover:underline"
        onClick={() => onPick(accounts[0])}
      >
        {label}
      </button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 text-sm font-medium text-teal-700 underline-offset-2 hover:underline"
        >
          {label}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="w-auto min-w-[14rem] p-1">
        {accounts.map((account) => (
          <button
            key={account}
            type="button"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
            onClick={() => {
              setOpen(false);
              onPick(account);
            }}
          >
            <span className="truncate">{account}</span>
          </button>
        ))}
      </MailPopoverContent>
    </Popover>
  );
}
