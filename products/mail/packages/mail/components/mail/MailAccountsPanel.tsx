"use client";

/**
 * The connected mailboxes, in the settings panel: connect, disconnect, reorder,
 * and show or hide each one.
 *
 * The rows are draggable, and the order they are left in is the order the mail
 * list uses. Everything here talks to `/api/gmail/accounts` and
 * `/api/outlook/accounts`, which every host answers — the planner from a route,
 * the standalone from the core running in its own webview.
 */

import { isWindowsHost } from "@/lib/mail/host-os";
import * as React from "react";
import type { MailProvider } from "@/lib/mail/types";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { mailStore } from "@/lib/mail/store";

import { AccountMarkButton } from "@/components/mail/AccountMarkButton";
import {
  autoReplyActive,
  type AutoReplyDto,
} from "@/components/mail/AutoReplyDialog";
import {
  SettingsGroup,
  SettingsHeading,
  SettingsStackedRow,
} from "@/components/mail/settings-ui";
import { Button } from "@/components/ui/button";
import {
  mergeAccountOrder,
  readAccountOrder,
  sortAccountsByOrder,
  writeAccountOrder,
} from "@/lib/mail/account-order";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { useMailConnect } from "@/components/mail/use-mail-connect";
import type { GmailAccountDto } from "@/lib/crm-contact-index";
import { shouldIgnoreFetchError } from "@/lib/mail/ignore-fetch-error";
import { useMailRouter } from "@/lib/mail-router";
import { cn } from "@/lib/utils";

export type MailAccountRow = GmailAccountDto & {
  provider: MailProvider;
};

/** The rows, in the order the reader dragged them into. */
function inReaderOrder(rows: MailAccountRow[]): MailAccountRow[] {
  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row]));
  const emails = sortAccountsByOrder(
    rows.map((row) => row.email),
    readAccountOrder()
  );
  return emails
    .map((email) => byEmail.get(email.toLowerCase()))
    .filter((row): row is MailAccountRow => Boolean(row));
}
/**
 * The name that goes on mail from this account.
 *
 * Reported, not set. Mail sends the name the provider holds, so this says what
 * that name is and where to change it — see `@/lib/mail/sender-identity` for
 * why Mail does not keep a name of its own.
 *
 * Nothing is shown until the name is known: a row that cannot say the name is
 * worse than no row, because an empty one reads as a question nobody answered.
 * Outlook never knows it — Graph decides the name itself.
 */
function SenderNameRow({ account }: { account: string }) {
  const t = useMailT();
  const [settings, setSettings] = React.useState<{
    provider: string;
    known: boolean;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void apiJson<{ provider: string; known: boolean }>(
      `/api/mail/sender-name?account=${encodeURIComponent(account)}`
    )
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
      })
      .catch((err) => {
        // The panel is still usable without it, so this stays a warning.
        if (!shouldIgnoreFetchError()) {
          console.warn("mail: could not read the sender name", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (!settings?.known) return null;

  return (
    <div className="flex items-center gap-2 border-t border-dashed border-stone-200 px-3 py-1.5 text-xs">
      <span className="shrink-0 text-stone-500">{t("nameOnYourMail")}</span>
      <span className="min-w-0 flex-1 truncate text-stone-700">
        {settings.provider}
      </span>
      <a
        href="https://mail.google.com/mail/u/0/#settings/accounts"
        target="_blank"
        rel="noreferrer"
        className="shrink-0 font-medium text-teal-700 hover:underline"
      >
        {t("changeInGmail")}
      </a>
    </div>
  );
}

function SortableAccountRow({
  account,
  autoReply,
  reconnecting,
  disconnecting,
  onReconnect,
  onDisconnect,
  onToggleInMailTab,
  onEditAutoReply,
  onEndAutoReply,
}: {
  account: MailAccountRow;
  /** Undefined while status is loading or when hidden from the Mail tab. */
  autoReply: AutoReplyDto | undefined;
  reconnecting?: boolean;
  /** The grant is being dropped and the copy's rows with it; the bin waits. */
  disconnecting?: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
  onToggleInMailTab: () => void;
  onEditAutoReply: () => void;
  onEndAutoReply: () => void;
}) {
  const t = useMailT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: account.email });
  /** A press on a control is a press, not the beginning of a drag. */
  const stopDrag = (event: React.PointerEvent) => event.stopPropagation();
  const away = autoReply !== undefined && autoReplyActive(autoReply);
  const isOutlook = account.provider === "outlook";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // One row on the section's card, not a card of its own. A stack of
        // outlined boxes inside an outlined box is what made this panel read
        // as a pile.
        //
        // Out of office still colours the row, but as a bar down its left
        // rather than a border: a border would fight the hairlines between
        // rows, and it moved everything by a pixel when it appeared.
        // Its own block, in the same cream as every other settings group, so
        // the gap between rows shows the panel behind.
        "relative bg-[var(--mail-chrome)]",
        away && "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-emerald-400",
        isDragging && "z-10 rounded-lg bg-white shadow-md"
      )}
    >
      {/*
        The whole row is the handle.

        There was a grip at the left of it, which is a control that exists to
        say "this can be moved" — and a row that can be moved should say so by
        moving. The buttons at the right stop the drag before it starts (see
        `stopDrag`), so the one thing you can do to a row by pressing it is
        still the thing that button does.
      */}
      <div
        className="flex cursor-grab touch-none items-center justify-between gap-2 px-2 py-1.5 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={t("reorderAccount", { email: account.email })}
      >
      {/* The same mark the mailbox wears on its tab, so the two rows read as
          the same list of mailboxes — and the same button, so it can be
          changed from either. On a tab the menu is a right-click, because a
          left-click there picks the mailbox; here there is nothing else the
          mark could mean. */}
      <AccountMarkButton
        account={account.email}
        provider={isOutlook ? "outlook" : "gmail"}
        title={t("changeAccountPicture")}
        markClassName={cn("h-4 w-4", !account.inMailTab && "opacity-40")}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", !account.inMailTab && "text-stone-400")}>
          {account.email}
        </p>
        <p
          className={cn(
            "truncate text-xs",
            account.lastSyncError ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {/* A connected account that is not hidden is live, so saying so
              said nothing. Only the two states worth reporting are named. */}
          {!account.inMailTab
            ? t("hiddenFromMail")
            : account.lastSyncError
              ? t("errorPrefix", { message: account.lastSyncError })
              : isOutlook
                ? "Outlook"
                : "Gmail"}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-stone-900"
          aria-label={
            account.inMailTab
              ? t("hideAccountFromMailTab", { email: account.email })
              : t("showAccountInMailTab", { email: account.email })
          }
          title={
            account.inMailTab
              ? mailUsesCrmPeople()
                ? t("hideFromMailTabCrm")
                : t("hideFromMailTab")
              : t("showInMailTab")
          }
          onPointerDown={stopDrag}
          onClick={onToggleInMailTab}
        >
          {account.inMailTab ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-stone-900"
          aria-label={
            reconnecting
              ? t("openingPermissions", { email: account.email })
              : t("reconnectAccount", { email: account.email })
          }
          title={
            reconnecting ? t("openingProviders") : t("reconnectTitle")
          }
          disabled={reconnecting}
          onPointerDown={stopDrag}
          onClick={onReconnect}
        >
          {reconnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-600"
          aria-label={t("disconnectAccount", { email: account.email })}
          aria-busy={disconnecting || undefined}
          title={t("disconnect")}
          disabled={disconnecting}
          onPointerDown={stopDrag}
          onClick={onDisconnect}
        >
          {/* Dropping a mailbox also drops its copy, which for a big one
              takes a few seconds; a bin that gave no sign was pressed
              again, and the second press found the account gone. */}
          {disconnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      </div>

      {account.inMailTab ? <SenderNameRow account={account.email} /> : null}

      {autoReply !== undefined ? (
        <div className="flex items-center justify-between gap-2 border-t border-dashed border-stone-200 px-3 py-1.5 text-xs">
          {away ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate">
                  {t("outOfOffice")}
                  {autoReply.endTime !== null
                    ? ` · ${t("outOfOfficeUntil", {
                        date: new Date(
                          autoReply.endTime - 1
                        ).toLocaleDateString(currentMailLocale(), {
                          day: "numeric",
                          month: "short",
                        }),
                      })}`
                    : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onPointerDown={stopDrag}
          onClick={onEditAutoReply}
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onPointerDown={stopDrag}
          onClick={onEndAutoReply}
                >
                  {t("end")}
                </button>
              </span>
            </>
          ) : autoReply.unavailable ? (
            /* Nothing to offer, and a reason rather than a silence. A personal
               Microsoft account is the case: Graph will not hand over its
               mailbox settings, so the reply has to be set where the mailbox
               lives. The line says that it cannot be done here; the title
               says why, in the words the server used. */
            <span className="text-stone-400" title={autoReply.unavailable}>
              {t("outOfOfficeUnavailable")}
            </span>
          ) : (
            <>
              <span className="text-stone-500">{t("outOfOfficeReply")}</span>
              <button
                type="button"
                className="shrink-0 font-medium text-teal-700 hover:underline"
                onPointerDown={stopDrag}
          onClick={onEditAutoReply}
              >
                {t("setUp")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
function guessMailProvider(email: string): MailProvider {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com"
  ) {
    return "outlook";
  }
  return "gmail";
}
/** Instant rows from emails already known on the page (before details fetch). */
function seedAccountRows(emails: string[]): MailAccountRow[] {
  return emails.map((email) => ({
    email,
    clerkUserId: null,
    historyId: null,
    lastSyncedAt: null,
    lastSyncError: null,
    inMailTab: true,
    provider: guessMailProvider(email),
  }));
}
/** Connected mailboxes panel — lives at the bottom of the Display menu. */
/**
 * One connect button, in its three states.
 *
 * Busy matters more here than it looks: connecting leaves for the provider's
 * sign-in, and until the page goes there is nothing on screen to say a click
 * landed. The natural response to that is to click again.
 */
function ConnectButton({
  provider,
  busy = false,
  disabledReason,
  onClick,
}: {
  provider: MailProvider;
  busy?: boolean;
  /** Set when this build has no client for the provider. Says why on hover. */
  disabledReason?: string | null;
  onClick?: () => void;
}) {
  const t = useMailT();
  const label = provider === "outlook" ? "Outlook" : "Gmail";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full gap-1.5"
      disabled={busy || Boolean(disabledReason)}
      title={disabledReason ?? undefined}
      onClick={onClick}
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("openingProvider", { provider: label })}
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          {t("connectProvider", { provider: label })}
        </>
      )}
    </Button>
  );
}

/**
 * Aliases and colleague domains, for a host that stores them.
 *
 * Only shown when `onSave` is given. A host that reads its identity from
 * server environment has nothing to edit here, and offering a box that saves
 * nothing would be worse than offering none.
 */
/** Something, an @, and a dotted domain: the bar this list uses to decide what is you. */
function looksLikeAddress(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function normalizeColleagueDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^.*@/, "");
}

/**
 * One chip field: stored values as chips, and a draft for the next one.
 *
 * The chips are the props. A change elsewhere re-renders them. The draft is
 * only what is being typed, so a value that fails the check stays in the
 * box instead of being stored or dropped.
 */
function OwnIdentityChipField({
  values,
  onChange,
  kind,
  placeholder,
  ariaLabel,
  invalidHint,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  kind: "alias" | "domain";
  placeholder: string;
  ariaLabel: string;
  invalidHint: string;
}) {
  const t = useMailT();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);

  const parse = (
    raw: string
  ): { ok: true; value: string } | { ok: false } => {
    if (kind === "alias") {
      const value = raw.trim();
      return looksLikeAddress(value) ? { ok: true, value } : { ok: false };
    }
    const value = normalizeColleagueDomain(raw);
    return value.includes(".") ? { ok: true, value } : { ok: false };
  };

  const commit = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setInvalid(false);
      return true;
    }
    const parsed = parse(trimmed);
    if (!parsed.ok) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setDraft("");
    const taken = parsed.value.toLowerCase();
    if (values.some((item) => item.toLowerCase() === taken)) return true;
    onChange([...values, parsed.value]);
    return true;
  };

  return (
    <div>
      <div
        className={cn(
          "flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-white px-2 py-1.5 focus-within:border-stone-400",
          invalid ? "border-red-400 focus-within:border-red-500" : "border-stone-200"
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--mail-chip)] py-0.5 pl-2 pr-1 text-xs text-[var(--mail-chip-fg)]"
          >
            {value}
            <button
              type="button"
              data-chip-remove
              aria-label={t("removeNamed", { name: value })}
              title={t("removeNamed", { name: value })}
              className="rounded-full px-1 text-[var(--mail-chip-muted)] hover:text-red-500"
              onClick={() =>
                onChange(values.filter((item) => item !== value))
              }
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          className="min-w-[12ch] flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(draft);
              return;
            }
            if (event.key === "Backspace" && draft === "" && values.length > 0) {
              event.preventDefault();
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => {
            commit(draft);
          }}
        />
      </div>
      {invalid ? (
        <p className="mt-1 text-xs text-red-600">{invalidHint}</p>
      ) : null}
    </div>
  );
}

function OwnIdentityFields({
  addresses,
  domains,
  onSave,
}: {
  addresses: string[];
  domains: string[];
  onSave: (next: { addresses: string[]; domains: string[] }) => void;
}) {
  const t = useMailT();

  // No wrapper element. SettingsHeading drops its top margin when it is the
  // first child, so that the panel does not open with a gap — and a div here
  // made this heading the first child of that div, which is how it ended up
  // pressed against the accounts above it.
  return (
    <>
      <SettingsHeading>{t("yourOtherAddresses")}</SettingsHeading>
      <SettingsGroup>
        <SettingsStackedRow
          label={t("aliases")}
          hint={t("aliasesHint")}
        >
          <OwnIdentityChipField
            values={addresses}
            onChange={(next) => onSave({ addresses: next, domains })}
            kind="alias"
            placeholder={t("aliasPlaceholder")}
            ariaLabel={t("aliases")}
            invalidHint={t("aliasInvalid")}
          />
        </SettingsStackedRow>
        <SettingsStackedRow
          label={t("colleagueDomains")}
          hint={t("colleagueDomainsHint")}
        >
          <OwnIdentityChipField
            values={domains}
            onChange={(next) => onSave({ addresses, domains: next })}
            kind="domain"
            placeholder={t("domainPlaceholder")}
            ariaLabel={t("colleagueDomains")}
            invalidHint={t("domainInvalid")}
          />
        </SettingsStackedRow>
      </SettingsGroup>
    </>
  );
}

export function MailAccountsPanel({
  knownEmails,
  onVisibilityChange,
  onChanged,
  autoReplies,
  onSetUpAutoReply,
  onEndAutoReply,
  onRequestClose,
  ownIdentity,
  onOwnIdentityChange,
}: {
  /** Emails already loaded with the mail page — paint these while details fetch. */
  knownEmails: string[];
  /** Optimistic chip update when hide/show toggles (before PATCH finishes). */
  onVisibilityChange: (email: string, inMailTab: boolean) => void;
  onChanged: () => void;
  autoReplies: AutoReplyDto[];
  onSetUpAutoReply: (account: string) => void;
  onEndAutoReply: (account: string) => void;
  onRequestClose: () => void;
  /** Stored aliases and colleague domains, without the connected mailboxes. */
  ownIdentity?: { addresses: string[]; domains: string[] };
  /** Given only by a host that stores identity. Absent hides the fields. */
  onOwnIdentityChange?: (next: {
    addresses: string[];
    domains: string[];
  }) => void;
}) {
  const t = useMailT();
  const router = useMailRouter();
  const { connecting, connect } = useMailConnect();
  const [accounts, setAccounts] = React.useState<MailAccountRow[] | null>(null);
  const [gmailConfigError, setGmailConfigError] = React.useState<string | null>(
    null
  );
  const [outlookConfigError, setOutlookConfigError] = React.useState<
    string | null
  >(null);
  const [reconnectingEmail, setReconnectingEmail] = React.useState<
    string | null
  >(null);
  // The row spins from the click until the connect flow is over. Nothing
  // cleared it before: a reconnected mailbox spun until the panel was
  // reopened, which read as the reconnect never finishing.
  React.useEffect(() => {
    if (!connecting) setReconnectingEmail(null);
  }, [connecting]);
  const knownEmailsRef = React.useRef(knownEmails);
  knownEmailsRef.current = knownEmails;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const loadAccounts = React.useCallback(async () => {
    try {
      const [gmailJson, outlookJson] = await Promise.all([
        apiJson<{
          accounts?: GmailAccountDto[];
          configError?: string | null;
        }>("/api/gmail/accounts"),
        apiJson<{
          accounts?: Array<{
            email: string;
            clerkUserId: string | null;
            lastSyncedAt: string | null;
            lastSyncError: string | null;
            inMailTab: boolean;
          }>;
          configError?: string | null;
        }>("/api/outlook/accounts"),
      ]);
      const gmailRows: MailAccountRow[] = (gmailJson.accounts ?? []).map(
        (a) => ({
          ...a,
          historyId: a.historyId ?? null,
          provider: "gmail" as const,
        })
      );
      const outlookRows: MailAccountRow[] = (outlookJson.accounts ?? []).map(
        (a) => ({
          email: a.email,
          clerkUserId: a.clerkUserId,
          historyId: null,
          lastSyncedAt: a.lastSyncedAt,
          lastSyncError: a.lastSyncError,
          inMailTab: a.inMailTab,
          provider: "outlook" as const,
        })
      );
      setAccounts(inReaderOrder([...gmailRows, ...outlookRows]));
      setGmailConfigError(gmailJson.configError ?? null);
      setOutlookConfigError(outlookJson.configError ?? null);
    } catch (err) {
      if (!shouldIgnoreFetchError()) {
        toast.error(
          err instanceof Error ? err.message : t("couldNotLoadAccounts")
        );
      }
      // Never leave the menu stuck on “Loading…” after a failed fetch.
      setAccounts((prev) => prev ?? seedAccountRows(knownEmailsRef.current));
    }
  }, []);

  // Prefetch on mail page load so opening the menu is usually instant.
  React.useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // Safari mailbox OAuth finishes outside the WebView — refresh on focus.
  React.useEffect(() => {
    const onFocus = () => {
      void loadAccounts();
      onChanged();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadAccounts, onChanged]);

  const displayAccounts = accounts ?? seedAccountRows(knownEmails);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !accounts) return;
    const oldIndex = accounts.findIndex((a) => a.email === active.id);
    const newIndex = accounts.findIndex((a) => a.email === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = accounts[oldIndex];

    const next = arrayMove(accounts, oldIndex, newIndex);
    setAccounts(next);
    // The reader's own arrangement, whichever provider each mailbox came
    // from. It is what the rail and the mail list follow — see
    // `@/lib/mail/account-order`.
    // Only the mailboxes moved, so only the mailboxes are rewritten: the All
    // tab keeps the place the reader dragged it to on the row upstairs.
    writeAccountOrder(
      mergeAccountOrder(readAccountOrder(), next.map((a) => a.email))
    );
    void (async () => {
      try {
        // Each provider is told the order of its own as well, so a host that
        // reads a provider's list on its own comes back in about this shape.
        const order = next
          .filter((a) => a.provider === moved.provider)
          .map((a) => a.email);
        const path =
          moved.provider === "outlook"
            ? "/api/outlook/accounts"
            : "/api/gmail/accounts";
        await apiJson(path, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        });
        router.refresh();
        onChanged();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("couldNotSaveOrder")
        );
        void loadAccounts();
      }
    })();
  };

  // Surface OAuth callback results when returning from Google / Microsoft.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get("gmail_connected");
    const gmailError = params.get("gmail_error");
    const outlookConnected = params.get("outlook_connected");
    const outlookError = params.get("outlook_error");
    if (!gmailConnected && !gmailError && !outlookConnected && !outlookError) {
      return;
    }

    if (gmailConnected) {
      toast.success(
        t("providerConnected", { provider: "Gmail", email: gmailConnected })
      );
    }
    if (gmailError) {
      toast.error(
        t("providerConnectFailed", { provider: "Gmail", error: gmailError })
      );
    }
    if (outlookConnected) {
      toast.success(
        t("providerConnected", {
          provider: "Outlook",
          email: outlookConnected,
        })
      );
    }
    if (outlookError) {
      toast.error(
        t("providerConnectFailed", { provider: "Outlook", error: outlookError })
      );
    }

    params.delete("gmail_connected");
    params.delete("gmail_error");
    params.delete("outlook_connected");
    params.delete("outlook_error");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
    if (gmailConnected || outlookConnected) {
      router.refresh();
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [disconnectingEmail, setDisconnectingEmail] = React.useState<string | null>(null);
  const disconnect = async (account: MailAccountRow) => {
    if (disconnectingEmail) return;
    setDisconnectingEmail(account.email);
    try {
      // The grant, read before it goes, so a slip of the hand can be
      // undone: the bin sits next to the reconnect arrows. Held only for
      // as long as the toast is up.
      const kept = await mailStore()
        .accounts.getToken(account.provider, account.email)
        .catch(() => null);
      const path =
        account.provider === "outlook"
          ? `/api/outlook/accounts?email=${encodeURIComponent(account.email)}`
          : `/api/gmail/accounts?email=${encodeURIComponent(account.email)}`;
      await apiJson(path, { method: "DELETE" });
      const restore = kept
        ? async () => {
            await mailStore().accounts.save(account.provider, {
              email: account.email,
              ownerId: kept.ownerId,
              refreshToken: kept.refreshToken,
            });
            onVisibilityChange(account.email, true);
            await loadAccounts();
            router.refresh();
            onChanged();
            toast.success(t("accountRestored", { email: account.email }));
          }
        : null;
      toast.success(t("accountDisconnected", { email: account.email }), {
        duration: restore ? 10_000 : undefined,
        action: restore
          ? {
              label: t("undo"),
              onClick: () => {
                void restore().catch((err: unknown) => {
                  toast.error(err instanceof Error ? err.message : t("couldNotDisconnect"));
                });
              },
            }
          : undefined,
      });
      onVisibilityChange(account.email, false);
      await loadAccounts();
      router.refresh();
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotDisconnect")
      );
    } finally {
      setDisconnectingEmail(null);
    }
  };

  const toggleInMailTab = async (account: MailAccountRow) => {
    const next = !account.inMailTab;
    setAccounts((current) =>
      (current ?? seedAccountRows(knownEmailsRef.current)).map((a) =>
        a.email === account.email ? { ...a, inMailTab: next } : a
      )
    );
    // Chips update immediately; thread list refreshes after PATCH (cache cleared).
    onVisibilityChange(account.email, next);
    try {
      const path =
        account.provider === "outlook"
          ? "/api/outlook/accounts"
          : "/api/gmail/accounts";
      await apiJson(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, inMailTab: next }),
      });
      toast.success(
        next
          ? t("accountShownInMail", { email: account.email })
          : account.provider === "outlook"
            ? t("accountHiddenFromMail", { email: account.email })
            : mailUsesCrmPeople()
              ? t("accountHiddenFromMailCrm", { email: account.email })
              : t("accountHiddenFromMailConnected", { email: account.email })
      );
      router.refresh();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotUpdate"));
      onVisibilityChange(account.email, account.inMailTab);
      void loadAccounts();
    }
  };

  return (
    <div>
      {/* No heading of its own: the Accounts page in Settings is titled. */}
      {gmailConfigError ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Gmail: {gmailConfigError}
        </p>
      ) : null}
      {outlookConfigError ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Outlook: {outlookConfigError}
        </p>
      ) : null}

      {/* One card for the section: the accounts, and the two ways to add
          another. Adding a mailbox belongs to this list, so the buttons sit on
          the same surface rather than floating below it. */}
      <div className="overflow-hidden rounded-xl bg-[var(--mail-chrome)]">
      {displayAccounts.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayAccounts.map((a) => a.email)}
            strategy={verticalListSortingStrategy}
          >
            {/* No scrollbox of its own. The panel around it scrolls now, and
                a list that scrolls inside a panel that scrolls means the
                wheel does one thing over the accounts and another an inch
                above them. */}
            {/* A gap between accounts rather than a hairline. Each account
                carries a name, a state, and sometimes an out-of-office line,
                so a rule between them was doing the work of a paragraph
                break. The gap shows the panel through, which is what
                separates one account from the next. */}
            <ul className="flex flex-col gap-[4px] bg-white">
              {displayAccounts.map((account) => (
                <SortableAccountRow
                  key={`${account.provider}:${account.email}`}
                  account={account}
                  autoReply={autoReplies.find(
                    (a) => a.account === account.email
                  )}
                  reconnecting={reconnectingEmail === account.email}
                  disconnecting={disconnectingEmail === account.email}
                  onReconnect={() => {
                    if (reconnectingEmail) return;
                    setReconnectingEmail(account.email);
                    const providerLabel =
                      account.provider === "outlook" ? "Microsoft" : "Google";
                    toast.message(
                      t("openingToRenew", { provider: providerLabel })
                    );
                    // Keep spinner visible briefly so the click registers before
                    // the browser navigates away to the OAuth consent screen.
                    window.setTimeout(() => {
                      if (account.provider === "outlook") {
                        connect("outlook", account.email);
                      } else {
                        connect("gmail", account.email);
                      }
                    }, 150);
                  }}
                  onDisconnect={() => void disconnect(account)}
                  onToggleInMailTab={() => void toggleInMailTab(account)}
                  onEditAutoReply={() => {
                    onRequestClose();
                    onSetUpAutoReply(account.email);
                  }}
                  onEndAutoReply={() => onEndAutoReply(account.email)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {t("noMailboxes")}
        </p>
      )}

      {/* The strip that separates one account from the next, continued under
          the last one — adding a mailbox is one more item in this card, not a
          footer under it.

          A block carrying the list's own background rather than a white
          border. `border-white` is white in both themes, and on the dark one
          it was a bright white rule across the card; `bg-white` is the same
          class the gaps above are drawn with, and the theme answers it. */}
      <div aria-hidden className="h-[4px] bg-white" />
      {/* macOS asks for a password when the token goes to the Keychain.
          Say so before the sheet, or a careful person quits — but only
          while a connect is under way, since that is when the sheet comes;
          standing there always, it was a paragraph of warning under every
          visit to Settings. And only where it happens: Windows keeps the
          token in its own credential store and asks nobody. */}
      {isWindowsHost() || !connecting ? null : (
        <p className="px-3 pt-2 text-sm text-muted-foreground">
          {t("connectKeychainHint")}
        </p>
      )}
      {/* Side by side: two ways of doing the same thing, so neither leads. */}
      <div className="grid grid-cols-2 gap-2 p-2">
        {gmailConfigError ? (
          <ConnectButton provider="gmail" disabledReason={gmailConfigError} />
        ) : (
          <ConnectButton
            provider="gmail"
            busy={connecting === "gmail"}
            onClick={() => connect("gmail")}
          />
        )}
        {outlookConfigError ? (
          <ConnectButton provider="outlook" disabledReason={outlookConfigError} />
        ) : (
          <ConnectButton
            provider="outlook"
            busy={connecting === "outlook"}
            onClick={() => connect("outlook")}
          />
        )}
      </div>
      </div>

      {onOwnIdentityChange ? (
        <OwnIdentityFields
          addresses={ownIdentity?.addresses ?? []}
          domains={ownIdentity?.domains ?? []}
          onSave={onOwnIdentityChange}
        />
      ) : null}

    </div>
  );
}
