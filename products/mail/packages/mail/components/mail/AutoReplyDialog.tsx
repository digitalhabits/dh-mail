"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  SettingsDialog,
  SettingsGroup,
  SettingsHeading,
  SettingsRow,
  SettingsToggle,
} from "@/components/mail/settings-ui";
import { AccountMark } from "@/components/mail/AccountMark";
import { AiReplyMenu } from "@/components/mail/AiReplyMenu";
import { ComposerToolbar } from "@/components/mail/ComposerToolbar";
import { DateField } from "@/components/ui/calendar";
import { accountChipLabels } from "@/lib/mail/account-labels";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { readAccountOrder, sortAccountsByOrder } from "@/lib/mail/account-order";
import { useAccountOrder } from "@/lib/mail/use-account-order";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/ui/RichTextEditor";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { mailOrgAiAllowed } from "@/lib/mail/product-flavor";
import { mailApiFetch } from "@/lib/mail/api";
import type { MailProvider } from "@/lib/mail/types";

/** Mirror of the server's MailAutoReply (lib/mail/inbox.ts). */
export type AutoReplyDto = {
  account: string;
  provider: MailProvider;
  /** False when the reply cannot carry a subject of its own. */
  subjectSupported: boolean;
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  restrictToContacts: boolean;
  startTime: number | null;
  endTime: number | null;
  needsReconnect: boolean;
  /** Set when this mailbox has no auto-reply to manage — say so, don't offer. */
  unavailable?: string;
};

/** True when this auto-reply is currently sending (on, and not past its last day). */
export function autoReplyActive(a: AutoReplyDto, now = Date.now()): boolean {
  return a.enabled && (a.endTime === null || a.endTime > now);
}

type FormState = {
  enabled: boolean;
  firstDay: string; // yyyy-mm-dd, "" = unset
  lastDay: string; // "" = no end date
  subject: string;
  bodyHtml: string;
  restrictToContacts: boolean;
};

/** Sets one of the two dates to today. */
function TodayButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded px-1 text-[11px] font-medium text-stone-500 hover:text-stone-900 hover:underline"
    >
      {t("today")}
    </button>
  );
}

function msToDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Local midnight at the start of the given yyyy-mm-dd. */
function dateInputToMs(value: string, extraDays = 0): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d + extraDays).getTime();
}

function toFormState(a: AutoReplyDto): FormState {
  return {
    enabled: a.enabled,
    firstDay: a.startTime !== null ? msToDateInput(a.startTime) : "",
    // Gmail's endTime is the midnight *after* the last day (exclusive).
    lastDay: a.endTime !== null ? msToDateInput(a.endTime - 1) : "",
    subject: a.subject,
    bodyHtml: a.bodyHtml,
    restrictToContacts: a.restrictToContacts,
  };
}

/**
 * The same small capitals every other settings surface uses.
 *
 * Its own spacing rather than the shared margins: these headings sit inside a
 * dialog whose sections are already spaced apart, not stacked straight onto
 * one another the way a settings panel's are.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <SettingsHeading className="mb-0 mt-0">{children}</SettingsHeading>;
}

export function AutoReplyDialog({
  open,
  initialAccount,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Account tab to open on (from the accounts menu links). */
  initialAccount?: string | null;
  onClose: () => void;
  /** Fired with the fresh server state after a successful save. */
  onSaved: (updated: AutoReplyDto) => void;
}) {
  const t = useMailT();
  const [items, setItems] = React.useState<AutoReplyDto[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [forms, setForms] = React.useState<Record<string, FormState>>({});
  /*
    The dialog saves itself — there is no Save button to press.

    A switch that only took effect on Save looked ignored: the dots kept
    reporting the responder still on, because it still was. Now every
    change is written on its own — the switch, the dates and the contacts
    checkbox almost at once, the words after a moment's pause in the
    typing — and the footer says where the writing stands. One guard
    holds: a responder switched on with nothing written waits, and says
    what it is waiting for, rather than answering people with an empty
    message.
  */
  const [saveStatus, setSaveStatus] = React.useState<
    Record<string, "pending" | "saving" | "saved" | "held" | "error">
  >({});
  const formsRef = React.useRef(forms);
  formsRef.current = forms;
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const saveTimersRef = React.useRef(new Map<string, number>());
  const [drafting, setDrafting] = React.useState(false);
  // Remounts the rich text editors (uncontrolled) when fresh content arrives.
  const [loadStamp, setLoadStamp] = React.useState(0);
  /* The tabs name each mailbox the way the mail list does: the reader's own
     picture where they set one, and the shortest name that tells it apart. */
  const marks = useAccountMarks();
  const order = useAccountOrder();
  /** For the toolbar, which reaches the editor through it. */
  const editorHandle = React.useRef<RichTextEditorHandle | null>(null);
  /*
    And in the reader's own order, which is the one thing a row of mailboxes
    must never disagree about. They arrange it by dragging — on the folder
    rail, or on the tabs over the list — and a second row in the order the
    server happened to answer in is a row they have to read twice.
  */
  const tabs = React.useMemo(() => {
    if (!items) return [];
    const byAccount = new Map(items.map((a) => [a.account, a]));
    return sortAccountsByOrder(
      items.map((a) => a.account),
      order
    )
      .map((account) => byAccount.get(account))
      .filter((a): a is AutoReplyDto => a !== undefined);
  }, [items, order]);
  const tabLabels = React.useMemo(
    () => accountChipLabels(tabs.map((a) => a.account)),
    [tabs]
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    setLoadError(null);
    setSaveStatus({});
    for (const timer of saveTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    saveTimersRef.current.clear();
    setActive(initialAccount ?? null);
    (async () => {
      try {
        const res = await mailApiFetch("/api/mail/autoreply");
        const json = (await res.json()) as {
          autoReplies?: AutoReplyDto[];
          error?: string;
        };
        if (!res.ok || !json.autoReplies) {
          throw new Error(json.error || t("couldNotLoadAutoReply"));
        }
        if (cancelled) return;
        setItems(json.autoReplies);
        setForms(
          Object.fromEntries(
            json.autoReplies.map((a) => [a.account, toFormState(a)])
          )
        );
        // The leading tab, not whichever mailbox the server answered with
        // first — the dialog opens on the tab the reader sees on the left.
        const first = sortAccountsByOrder(
          (json.autoReplies ?? []).map((a) => a.account),
          readAccountOrder()
        )[0];
        setActive((current) => current ?? first ?? null);
        setLoadStamp((n) => n + 1);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : t("couldNotLoadAutoReply")
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialAccount]);

  const updateForm = (account: string, patch: Partial<FormState>) => {
    setForms((prev) => {
      const next = { ...prev[account], ...patch };
      // A last day before the first day is not a range anyone means. Move it
      // up to the first day rather than refuse the edit. Both dates are
      // yyyy-mm-dd, so they compare as strings. An empty last day means "no
      // end date" and must stay empty.
      if (next.firstDay && next.lastDay && next.lastDay < next.firstDay) {
        next.lastDay = next.firstDay;
      }
      return { ...prev, [account]: next };
    });
    /*
      Writing follows the change on its own, at two paces. The switch, the
      dates and the contacts checkbox are single decisions — they go almost
      at once. The words go after a pause in the typing, long enough that a
      sentence being written is not posted clause by clause: these writes
      land on the provider's own settings, and a polite client coalesces
      them. Closing the dialog sends whatever is still waiting.
    */
    const textual = "subject" in patch || "bodyHtml" in patch;
    scheduleSave(account, textual ? 2_500 : 300);
  };

  const scheduleSave = (account: string, delayMs: number) => {
    const timers = saveTimersRef.current;
    const standing = timers.get(account);
    if (standing != null) window.clearTimeout(standing);
    setSaveStatus((prev) => ({ ...prev, [account]: "pending" }));
    timers.set(
      account,
      window.setTimeout(() => {
        timers.delete(account);
        void save(account);
      }, delayMs)
    );
  };

  /** Send whatever is still waiting — the dialog closing, a tab left. */
  const flushPendingSaves = () => {
    const timers = saveTimersRef.current;
    for (const [account, timer] of timers) {
      window.clearTimeout(timer);
      void save(account);
    }
    timers.clear();
  };

  const draftForMe = async (account: string, hint: string) => {
    const form = forms[account];
    if (!form) return;
    setDrafting(true);
    try {
      const res = await mailApiFetch("/api/mail/autoreply/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          firstDay: form.firstDay || null,
          lastDay: form.lastDay || null,
          subject: form.subject,
          bodyHtml: form.bodyHtml,
          // What the reader asked for. Left out when they asked for nothing,
          // which is the same one-press draft this used to be.
          ...(hint ? { hint } : null),
        }),
      });
      const json = (await res.json()) as {
        draft?: { subject: string; bodyHtml: string };
        error?: string;
      };
      if (!res.ok || !json.draft) {
        throw new Error(json.error || t("couldNotDraft"));
      }
      updateForm(account, {
        subject: json.draft.subject,
        bodyHtml: json.draft.bodyHtml,
      });
      setLoadStamp((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotDraft"));
    } finally {
      setDrafting(false);
    }
  };

  const save = async (account: string) => {
    // Read through the refs: a debounced call must send what stands now,
    // not what stood when the timer was wound.
    const form = formsRef.current[account];
    if (!form) return;
    const saved = itemsRef.current?.find((a) => a.account === account);
    // Nothing actually differs from what the provider holds — post nothing.
    if (
      saved &&
      JSON.stringify(toFormState(saved)) === JSON.stringify(form)
    ) {
      setSaveStatus((prev) => ({ ...prev, [account]: "saved" }));
      return;
    }
    const plainBody = form.bodyHtml.replace(/<[^>]*>/g, "").trim();
    if (form.enabled && !plainBody) {
      // Switched on with nothing written: wait, and say what for, rather
      // than answering people with an empty message.
      setSaveStatus((prev) => ({ ...prev, [account]: "held" }));
      return;
    }
    setSaveStatus((prev) => ({ ...prev, [account]: "saving" }));
    try {
      const res = await mailApiFetch("/api/mail/autoreply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          enabled: form.enabled,
          subject: form.subject,
          bodyHtml: form.bodyHtml,
          restrictToContacts: form.restrictToContacts,
          startTime: form.firstDay ? dateInputToMs(form.firstDay) : null,
          // Exclusive end: midnight after the chosen last day.
          endTime: form.lastDay ? dateInputToMs(form.lastDay, 1) : null,
        }),
      });
      const json = (await res.json()) as { autoReply?: AutoReplyDto; error?: string };
      if (!res.ok || !json.autoReply) {
        throw new Error(json.error || t("couldNotSaveAutoReply"));
      }
      // Announced only when the responder itself turned on or off — the
      // decision worth a word. Text finding its way to the server is the
      // footer's quiet business.
      const wasEnabled = saved?.enabled ?? false;
      setItems((prev) =>
        prev?.map((a) => (a.account === account ? json.autoReply! : a)) ?? prev
      );
      onSaved(json.autoReply);
      setSaveStatus((prev) => ({ ...prev, [account]: "saved" }));
      if (json.autoReply.enabled !== wasEnabled) {
        toast.success(
          json.autoReply.enabled
            ? `Auto-reply on for ${account}`
            : `Auto-reply off for ${account}`
        );
      }
    } catch (err) {
      setSaveStatus((prev) => ({ ...prev, [account]: "error" }));
      toast.error(
        err instanceof Error ? err.message : t("couldNotSaveAutoReply")
      );
    }
  };

  if (!open) return null;

  const activeItem = items?.find((a) => a.account === active) ?? null;
  const form = active ? forms[active] : undefined;

  return (
    <SettingsDialog
      title={t("autoReplyTitle")}
      width="w-[640px]"
      onClose={() => {
        flushPendingSaves();
        onClose();
      }}
      nav={
        tabs.length > 1 ? (
          /*
            The same tabs the mail list wears: a track, a pill for the one
            chosen, each mailbox by its picture and its short name. Four
            addresses written out in full ran off the end of the dialog and
            read as nothing the reader had seen before — and whose mailbox
            this is is the same question here as it is over the list, so it
            should be asked in the same shape. The row scrolls sideways for
            a fifth mailbox rather than squeezing them all.
          */
          <div className="-mx-0.5 overflow-x-auto px-0.5 pb-1 [scrollbar-width:thin]">
            <div className="flex w-max items-center gap-1 rounded-full bg-[var(--mail-segment-track)] p-1">
              {tabs.map((a) => {
                const label = tabLabels.get(a.account);
                const chosen = active === a.account;
                return (
                  <button
                    key={a.account}
                    type="button"
                    title={a.account}
                    aria-pressed={chosen}
                    onClick={() => setActive(a.account)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors",
                      chosen
                        ? "bg-[var(--mail-segment-active)] font-semibold text-[var(--mail-segment-active-fg)] shadow-sm"
                        : "text-[var(--mail-segment-fg)] hover:text-[var(--mail-segment-active-fg)]"
                    )}
                  >
                    <AccountMark
                      mark={marks[a.account.trim().toLowerCase()]}
                      provider={a.provider}
                    />
                    <span className="max-w-[10rem] truncate">
                      {label?.primary ?? a.account}
                    </span>
                    {label?.suffix ? (
                      <span className="text-stone-400">· {label.suffix}</span>
                    ) : null}
                    {autoReplyActive(a) ? (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                        title={t("autoReplyOn")}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null
      }
      footer={
        activeItem && !activeItem.needsReconnect && active ? (
          /*
            Where the writing stands, instead of buttons. There is nothing
            to press: changes go to the mailbox on their own, and this line
            says so — or says what a switched-on responder with no message
            is waiting for.
          */
          (() => {
            const status = saveStatus[active] ?? "idle";
            if (status === "held") {
              return (
                <span className="text-xs text-amber-600">
                  {t("writeAutoReplyFirst")}
                </span>
              );
            }
            if (status === "pending" || status === "saving") {
              return (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("autoReplySaving")}
                </span>
              );
            }
            if (status === "error") {
              return (
                <span className="text-xs text-red-600">
                  {t("couldNotSaveAutoReply")}
                </span>
              );
            }
            return (
              <span className="text-xs text-muted-foreground">
                {status === "saved"
                  ? t("autoReplySaved")
                  : t("autoReplyAutosaves")}
              </span>
            );
          })()
        ) : null
      }
    >
        {items === null ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            {loadError ?? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingSettings")}
              </>
            )}
          </div>
        ) : (
          <>
            {activeItem?.unavailable ? (
              <div className="py-8 text-sm text-muted-foreground">
                {activeItem.unavailable}
              </div>
            ) : activeItem?.needsReconnect ? (
              <div className="py-8 text-sm text-muted-foreground">
                {t("autoReplyNeedsReconnectBefore")}
                <strong>{activeItem.account}</strong>
                {t("autoReplyNeedsReconnectAfter")}
              </div>
            ) : form && active ? (
              <div className="space-y-4">
                <SettingsGroup>
                  <SettingsRow
                    label={t("autoReply")}
                    control={
                      <SettingsToggle
                        checked={form.enabled}
                        onChange={(next) =>
                          updateForm(active, { enabled: next })
                        }
                        label={t("autoReply")}
                      />
                    }
                  />
                </SettingsGroup>

                <div className="space-y-2">
                  <SectionLabel>{t("when")}</SectionLabel>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-start gap-1">
                      <DateField
                        ariaLabel={t("firstDay")}
                        value={form.firstDay}
                        onChange={(key) =>
                          updateForm(active, { firstDay: key })
                        }
                      />
                      <TodayButton
                        label={t("firstDayToday")}
                        onClick={() =>
                          updateForm(active, { firstDay: msToDateInput(Date.now()) })
                        }
                      />
                    </div>
                    <span className="py-1.5 text-stone-400">→</span>
                    <div className="flex flex-col items-start gap-1">
                      <DateField
                        ariaLabel={t("lastDayOptional")}
                        placeholder={t("noEndDate")}
                        value={form.lastDay}
                        // The calendar cannot offer a day before the first one.
                        min={form.firstDay || undefined}
                        clearable
                        onChange={(key) => updateForm(active, { lastDay: key })}
                      />
                      <TodayButton
                        label={t("lastDayToday")}
                        onClick={() =>
                          updateForm(active, { lastDay: msToDateInput(Date.now()) })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SectionLabel>{t("message")}</SectionLabel>
                    {/* Writing the message is the only part that needs an AI
                        key. Setting the out-of-office is a plain provider
                        setting, so the rest of this dialog is not gated.

                        The same menu the composer asks with, so asking the AI
                        for something looks and works the same wherever it is
                        asked: the sparkle, a box to say what this one is
                        about, and nothing written until Draft is pressed. */}
                    {mailOrgAiAllowed() ? (
                      <AiReplyMenu
                        purpose="autoreply"
                        drafting={drafting}
                        onDraft={(hint) => void draftForMe(active, hint)}
                      />
                    ) : null}
                  </div>

                  {/* No overflow-hidden: the editor's link card can poke above. */}
                  <div className="mail-autoreply-card rounded-lg border border-stone-200">
                    {/* A reply that cannot carry its own subject gets no
                        box for one. A box that changes nothing is worse
                        than no box. */}
                    {activeItem?.subjectSupported === false ? null : (
                    <label className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
                      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                        {t("subject")}
                      </span>
                      <input
                        type="text"
                        value={form.subject}
                        onChange={(e) =>
                          updateForm(active, { subject: e.target.value })
                        }
                        placeholder={t("autoReplySubjectPlaceholder")}
                        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-stone-400"
                      />
                    </label>
                    )}
                    {/* The composer's own row, in the composer's own order.
                        Rendered before the editor, because Quill takes its
                        toolbar by id and the element has to be there first. */}
                    <ComposerToolbar
                      id="mail-autoreply-toolbar"
                      editorHandle={editorHandle}
                    />
                    <RichTextEditor
                      key={`${active}-${loadStamp}`}
                      className="mail-message-editor"
                      toolbarId="mail-autoreply-toolbar"
                      handleRef={editorHandle}
                      defaultValue={form.bodyHtml}
                      onChange={(html) => updateForm(active, { bodyHtml: html })}
                      placeholder={t("autoReplyBodyPlaceholder")}
                      minHeight={150}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                      {t("autoReplyRate")}
                    </p>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-stone-600">
                      <input
                        type="checkbox"
                        checked={form.restrictToContacts}
                        onChange={(e) =>
                          updateForm(active, { restrictToContacts: e.target.checked })
                        }
                      />
                      {t("onlySendToContacts")}
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
    </SettingsDialog>
  );
}
