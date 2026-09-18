"use client";

import * as React from "react";
import { ArrowUpRight, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { SettingsDialog, SettingsPane } from "@/components/mail/settings-ui";
import { openMailAccountsMenu } from "@/lib/mail/open-mail-accounts-menu";
import { Button } from "@/components/ui/button";
import { useMailT, type MailT } from "@/lib/mail/i18n";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { mailConnectHref } from "@/lib/mail/connect-mailbox";
import { useMailConnect } from "@/components/mail/use-mail-connect";
import type { MailConnectProvider } from "@/lib/mail/host/contracts";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  macContactsAuthorization,
  macContactsRequestAccess,
  openContactsPrivacySettings,
} from "@/lib/native-shell";
import { stopAskingForMacContacts } from "@/lib/mail/mac-contacts-ask";

export const OPEN_CONTACT_SOURCES_EVENT = "redd-mail-open-contact-sources";
export const CONTACTS_CHANGED_EVENT = "redd-mail-contacts-changed";

export function openContactSourcesDialog(detail?: {
  /** Opened from Settings: closing Back returns to that panel. */
  returnTo?: "settings";
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_CONTACT_SOURCES_EVENT, { detail: detail ?? {} })
  );
}

function notifyContactsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
}

type SourceStatus = {
  key: string;
  kind: "crm" | "google" | "outlook" | "history" | "mac";
  account: string;
  count: number;
  syncedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  /** Wanted, but the operating system has not allowed it yet. */
  needsAccess?: "ask" | "settings" | null;
};


function sourceTitle(source: SourceStatus, t: MailT): string {
  // A CRM source only exists on a build with a CRM (see contact-sources),
  // so this is a second lock on a door that is already shut. It is here
  // because the name of the team layer must never reach a public build by
  // accident, and "already unreachable" is how the last one got out.
  if (source.kind === "crm") {
    return t(mailUsesCrmPeople() ? "sourceCrmContacts" : "sourceContacts");
  }
  if (source.kind === "history") return t("sourceMailHistory");
  if (source.kind === "google") return t("sourceGoogleContacts");
  if (source.kind === "mac") return t("sourceMacContacts");
  return t("sourceOutlookContacts");
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function relativeSyncedAt(iso: string | null, t: MailT): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return t("syncedJustNow");
  if (mins < 60) return t("syncedMinutesAgo", { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t("syncedHoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("syncedDaysAgo", { count: days });
}

function editLink(
  source: SourceStatus,
  t: MailT
): { href: string; label: string } | null {
  if (source.kind === "crm") {
    // /clients is a planner page. A public build has no such route, so the
    // link would go nowhere even if the source somehow existed.
    if (!mailUsesCrmPeople()) return null;
    return { href: "/clients", label: t("editInCrm") };
  }
  if (source.kind === "google") {
    return {
      href: "https://contacts.google.com/",
      label: t("editAtGoogle"),
    };
  }
  if (source.kind === "outlook") {
    return {
      href: "https://outlook.live.com/people/",
      label: t("editAtOutlook"),
    };
  }
  return null;
}

/**
 * Which mailbox this source needs signing in again, or null.
 *
 * A contact source is a mailbox seen from another angle, so reconnecting it is
 * the same act as reconnecting the mailbox. It goes through the same seam, and
 * so does the same thing on every host.
 */
function reconnectTarget(
  source: SourceStatus
): { provider: MailConnectProvider; email: string } | null {
  if (source.kind === "google" && source.account) {
    return { provider: "gmail", email: source.account };
  }
  if (source.kind === "outlook" && source.account) {
    return { provider: "outlook", email: source.account };
  }
  return null;
}

/** The switch alone: the row's status word already says what it is doing. */
function SourceToggle({
  label,
  enabled,
  disabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        enabled ? "bg-teal-700" : "bg-stone-300",
        disabled && "opacity-60"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
          enabled ? "left-4" : "left-0.5"
        )}
      />
    </button>
  );
}

function useContactSources(active: boolean) {
  const t = useMailT();
  const [sources, setSources] = React.useState<SourceStatus[] | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  /** When Sync now was pressed, so a source's time says whether it is done. */
  const [syncStartedAt, setSyncStartedAt] = React.useState<number | null>(null);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const { connecting, connect } = useMailConnect();

  const load = React.useCallback(async () => {
    try {
      const json = await apiJson<{ sources: SourceStatus[] }>(
        "/api/mail/contact-sources"
      );
      setSources(json.sources);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotLoadContactSources")
      );
    }
  }, [t]);

  React.useEffect(() => {
    if (active) void load();
  }, [active, load]);

  /*
    Said as it goes.

    A sync is a row of address books and then the sent mail of every
    mailbox, and the last part is slow — hundreds of requests per mailbox.
    The button spun for a minute with nothing said, so it looked stuck.
    Each source records its own time as it finishes, so while the sync
    runs the list is re-read every second or two: a finished source reads
    "synced just now", the one being read shows a spinner, and the footer
    counts them off.
  */
  React.useEffect(() => {
    if (!syncing) return;
    const id = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(id);
  }, [syncing, load]);

  const progress = React.useMemo(() => {
    if (!syncing || syncStartedAt == null || !sources) return null;
    // The order the sync runs in: the address books, the Mac book, then
    // the mail history of each mailbox.
    const rank = (kind: SourceStatus["kind"]) =>
      kind === "google" || kind === "outlook" ? 0 : kind === "mac" ? 1 : 2;
    const run = sources
      .filter((source) => source.enabled && source.kind !== "crm")
      .map((source, index) => ({ source, index }))
      .sort((a, b) => rank(a.source.kind) - rank(b.source.kind) || a.index - b.index)
      .map((entry) => entry.source);
    const isDone = (source: SourceStatus) => {
      const at = source.syncedAt ? Date.parse(source.syncedAt) : NaN;
      return Number.isFinite(at) && at >= syncStartedAt - 1000;
    };
    const done = run.filter(isDone).length;
    const current = run.find((source) => !isDone(source)) ?? null;
    return { done, total: run.length, current };
  }, [syncing, syncStartedAt, sources]);

  const sync = async () => {
    setSyncing(true);
    setSyncStartedAt(Date.now());
    try {
      const json = await apiJson<{
        results: {
          ok: boolean;
          error?: string;
          account: string;
          source: string;
        }[];
      }>("/api/mail/contact-sources/sync", { method: "POST" });
      const failed = json.results.filter((r) => !r.ok);
      if (failed.length) {
        toast.error(
          failed[0].error || t("sourcesNeedReconnect")
        );
      } else {
        toast.success(t("contactSourcesUpdated"));
      }
      await load();
      notifyContactsChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Get the address book readable, from wherever the reader asked.
   *
   * Turning the source on is the ask. macOS shows its prompt right there, and
   * if it has already been answered there is nothing to prompt — so this opens
   * the one pane that can change the answer instead of describing it.
   *
   * @returns true when the book can be read.
   */
  const allowMacContacts = async (): Promise<boolean> => {
    const status = await macContactsAuthorization();
    if (status === "authorized" || status === "limited") return true;

    if (status === "notDetermined") {
      const next = await macContactsRequestAccess();
      // Asked and answered, so Mail stops offering it anywhere else.
      stopAskingForMacContacts();
      if (next === "authorized" || next === "limited") return true;
    }

    await openContactsPrivacySettings();
    return false;
  };

  const toggle = async (key: string, enabled: boolean) => {
    setToggling(key);
    try {
      // Turning the Mac book on is what asks macOS. A source that cannot be
      // read must not be left showing On.
      if (key === "mac" && enabled && !(await allowMacContacts())) {
        await load();
        return;
      }
      const json = await apiJson<{ sources: SourceStatus[] }>(
        "/api/mail/contact-sources",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, enabled }),
        }
      );
      setSources(json.sources);
      notifyContactsChanged();
      // Newly allowed, and still empty until something reads it.
      if (key === "mac" && enabled) await sync();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotUpdate"));
    } finally {
      setToggling(null);
    }
  };

  return {
    t,
    sources,
    syncing,
    progress,
    toggling,
    connecting,
    connect,
    sync,
    toggle,
  };
}

/**
 * The footer sentence, or where the sync has got to while one runs. The
 * mail history pass is the slow one, and says so while it is the one running.
 */
function ContactSourcesFooterLine({
  book,
}: {
  book: ReturnType<typeof useContactSources>;
}) {
  const t = useMailT();
  const progress = book.progress;
  if (!progress) {
    // The most recent read across the sources that are on.
    const latest = (book.sources ?? [])
      .filter((source) => source.enabled && source.syncedAt)
      .map((source) => source.syncedAt as string)
      .sort()
      .pop();
    const synced = relativeSyncedAt(latest ?? null, t);
    return (
      <>
        {t("contactSourcesFooter")}
        {synced ? ` · ${synced}` : ""}
      </>
    );
  }
  const counting = t("syncingProgress", {
    done: Math.min(progress.done + 1, progress.total),
    total: progress.total,
  });
  return (
    <>
      {counting}
      {progress.current?.kind === "history" ? ` ${t("syncHistorySlow")}` : ""}
    </>
  );
}

function ContactSourcesSyncButton({
  syncing,
  onSync,
}: {
  syncing: boolean;
  onSync: () => void;
}) {
  const t = useMailT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 rounded-full"
      disabled={syncing}
      onClick={onSync}
    >
      {syncing ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      )}
      {t("syncNow")}
    </Button>
  );
}

/**
 * One word for where a source stands, for the row's right-hand side.
 *
 * The rows used to say everything at once, five times over. Now each says
 * its name and one word, and the rest waits behind the chevron.
 */
function sourceStatus(
  source: SourceStatus,
  t: MailT,
  needsReconnect: boolean,
  readingNow: boolean
): { text: string; tone: "muted" | "warn" } | null {
  if (readingNow) return { text: t("syncingSource"), tone: "muted" };
  if (needsReconnect) return { text: t("reconnect").toLowerCase(), tone: "warn" };
  if (source.needsAccess) return { text: t("needsPermission"), tone: "warn" };
  if (source.kind === "history") return null;
  if (source.syncedAt == null) return { text: t("statusNotSynced"), tone: "muted" };
  if (source.count === 0) return { text: t("statusEmpty"), tone: "muted" };
  return {
    text:
      source.count === 1
        ? t("contactsCountOne")
        : t("contactsCountMany", { count: formatCount(source.count) }),
    tone: "muted",
  };
}

/**
 * A phrase written for the middle of a line ("· synced 5 min ago"), made
 * to start one: a capital, and a full stop unless it has its own.
 */
function sentence(phrase: string): string {
  const capped = phrase.charAt(0).toLocaleUpperCase() + phrase.slice(1);
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`;
}

/** The address for a mailbox source; the book's name for the rest. */
function sourceName(source: SourceStatus, t: MailT): string {
  if ((source.kind === "google" || source.kind === "outlook") && source.account) {
    return source.account;
  }
  return sourceTitle(source, t);
}

function ContactSourcesList({
  sources,
  progress,
  toggling,
  connecting,
  connect,
  toggle,
}: ReturnType<typeof useContactSources>) {
  const t = useMailT();
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const flip = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (sources == null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((source) => {
        const link = editLink(source, t);
        const reconnect = reconnectTarget(source);
        const needsReconnect = Boolean(
          source.lastError?.toLowerCase().includes("reconnect")
        );
        const readingNow = progress?.current?.key === source.key;
        const status = sourceStatus(source, t, needsReconnect, readingNow);
        const open = expanded.has(source.key);
        const name = sourceName(source, t);
        const detailId = `contact-source-${source.key}`;

        // The one sentence behind the chevron: what the source holds, or
        // why it holds nothing.
        let explanation: React.ReactNode = null;
        if (source.kind === "crm") {
          explanation = t("yourCrm");
        } else if (source.kind === "history") {
          explanation = t("mailHistoryHint");
        } else if (source.kind === "mac" && source.needsAccess) {
          explanation =
            source.needsAccess === "ask"
              ? source.enabled
                ? t("macContactsWaiting")
                : t("macContactsAsk")
              : t("macContactsBlocked");
        } else if (source.syncedAt == null) {
          explanation = sentence(t("contactsNotSyncedYet"));
        } else if (source.count === 0) {
          explanation = t("contactsNoneSaved");
        }
        // The footer says when the books were last read; a source with
        // contacts in it has nothing to add but its edit link.
        const canOpenSettings =
          source.kind === "mac" && source.needsAccess === "settings";
        const hasDetail = Boolean(
          explanation || link || source.lastError || canOpenSettings
        );

        return (
          <li
            key={source.key}
            className={cn(
              "rounded-2xl bg-[var(--mail-chrome)]",
              !source.enabled && "opacity-55"
            )}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                aria-expanded={hasDetail ? open : undefined}
                aria-controls={hasDetail ? detailId : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => hasDetail && flip(source.key)}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900">
                  {name}
                </span>
                {status ? (
                  <span
                    className={cn(
                      "shrink-0 text-sm tabular-nums",
                      status.tone === "warn" ? "text-amber-700" : "text-stone-500"
                    )}
                  >
                    {status.text}
                  </span>
                ) : null}
              </button>
              <SourceToggle
                label={name}
                enabled={source.enabled}
                disabled={toggling === source.key}
                onChange={(next) => void toggle(source.key, next)}
              />
              {hasDetail ? (
                <button
                  type="button"
                  aria-label={open ? t("hideDetails") : t("details")}
                  aria-expanded={open}
                  aria-controls={detailId}
                  className="-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200/60 hover:text-stone-700"
                  onClick={() => flip(source.key)}
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform",
                      open && "rotate-90"
                    )}
                    aria-hidden
                  />
                </button>
              ) : (
                // Keeps the switches in one column when a row has no chevron.
                <span aria-hidden className="-mr-1.5 h-7 w-7 shrink-0" />
              )}
            </div>

            {open && hasDetail ? (
              <div
                id={detailId}
                className="mx-4 border-t border-stone-200 pb-3.5 pt-3 text-sm leading-relaxed text-stone-500"
              >
                <p>
                  {explanation}
                  {link ? (
                    <>
                      {" "}
                      <a
                        href={link.href}
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                        className="inline-flex items-center gap-0.5 font-semibold text-teal-700 hover:underline"
                      >
                        {link.label}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    </>
                  ) : null}
                  {canOpenSettings ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="font-semibold text-teal-700 hover:underline"
                        onClick={() => void openContactsPrivacySettings()}
                      >
                        {t("openSystemSettings")}
                      </button>
                    </>
                  ) : null}
                </p>
                {source.lastError ? (
                  <p className="mt-1 text-amber-700">
                    {source.lastError}
                    {needsReconnect && reconnect ? (
                      <>
                        {" · "}
                        <a
                          href={mailConnectHref(reconnect.provider, reconnect.email)}
                          onClick={(event) => {
                            event.preventDefault();
                            connect(reconnect.provider, reconnect.email);
                          }}
                          className="font-semibold underline"
                        >
                          {connecting ? t("opening") : t("reconnect")}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Contact sources, as the Contacts category in Settings.
 *
 * A second dialog in the middle of the window made the same surface jump.
 * This one is a page of the settings popover, under the Settings button.
 */
export function ContactSourcesPanel({ onDone }: { onDone: () => void }) {
  const book = useContactSources(true);
  const t = book.t;
  return (
    <SettingsPane
      title={t("contactSources")}
      description={t("settingsContactsHint")}
      onDone={onDone}
      footerStart={
        <>
          <p className="min-w-0 text-xs leading-relaxed text-stone-400">
            <ContactSourcesFooterLine book={book} />
          </p>
          <ContactSourcesSyncButton
            syncing={book.syncing}
            onSync={() => void book.sync()}
          />
        </>
      }
    >
      <ContactSourcesList {...book} />
    </SettingsPane>
  );
}

/**
 * The standalone dialog. The recipient field still opens this, and it
 * closes to nothing.
 */
export function ContactSourcesDialog({
  open,
  onClose,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
}) {
  const book = useContactSources(open);
  const t = book.t;
  if (!open) return null;
  return (
    <SettingsDialog
      title={t("contactSources")}
      onBack={onBack}
      backLabel={t("settings")}
      onClose={onClose}
      width="w-[480px]"
      footer={
        <>
          <p className="mr-auto pl-4 text-xs leading-relaxed text-stone-400">
            <ContactSourcesFooterLine book={book} />
          </p>
          <ContactSourcesSyncButton
            syncing={book.syncing}
            onSync={() => void book.sync()}
          />
        </>
      }
    >
      <ContactSourcesList {...book} />
    </SettingsDialog>
  );
}

/** Mount once; opens when typeahead footer or accounts menu asks. */
export function ContactSourcesDialogHost() {
  const [open, setOpen] = React.useState(false);
  const [returnTo, setReturnTo] = React.useState<"settings" | null>(null);

  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as { returnTo?: string } | undefined)
          : undefined;
      setReturnTo(detail?.returnTo === "settings" ? "settings" : null);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONTACT_SOURCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONTACT_SOURCES_EVENT, onOpen);
  }, []);

  const close = () => {
    setOpen(false);
    setReturnTo(null);
  };

  return (
    <ContactSourcesDialog
      open={open}
      onClose={close}
      onBack={
        returnTo === "settings"
          ? () => {
              close();
              openMailAccountsMenu({ category: "contacts" });
            }
          : undefined
      }
    />
  );
}
