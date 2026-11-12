"use client";

/**
 * "Rules for <sender>" in a row's menu, and the panel it opens beside the
 * menu: where this sender's future mail goes.
 *
 * Four rules that need one click, and "More options…" for the rest
 * (SenderRuleDialog): a rule for the whole domain, or without moving the
 * mail already in the inbox. A sender with a rule shows which one, and a
 * way to remove it.
 *
 * The line is not drawn for a conversation that is all the reader's own:
 * there is no sender to make a rule for.
 *
 * The panel is inside the menu's own box, so a click in it is a click in
 * the menu (MenuShell closes on a click outside).
 */

import * as React from "react";
import { Archive, Check, ChevronRight, Folder, ListFilter, ShieldAlert, SlidersHorizontal, Trash2, X } from "lucide-react";

import { MENU_ICON, MENU_ITEM } from "@/components/mail/MenuShell";
import { useMailT } from "@/lib/mail/i18n";
import type { SenderRuleAction } from "@/lib/mail/sender-rules";
import {
  openSenderRuleDialog,
  readSenderRuleState,
  removeSenderRuleFromUi,
  saveSenderRuleFromUi,
  type SenderRuleState,
} from "@/lib/mail/sender-rule-ui";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 304;

type Option = { action: SenderRuleAction; icon: React.ReactNode; title: string; hint: string };

export function SenderRulesRow({
  account,
  threadId,
  onDismiss,
}: {
  /** Absent on a menu that is not for one conversation: nothing is drawn. */
  account?: string;
  threadId?: string;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const [state, setState] = React.useState<SenderRuleState | null>(null);
  const [open, setOpen] = React.useState(false);
  const rowRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  /** Where the panel sits against the menu: which side, and how far it is lifted to stay in the window. */
  const [place, setPlace] = React.useState<{ side: "right" | "left"; top: number } | null>(null);

  React.useEffect(() => {
    let alive = true;
    if (!account || !threadId) return;
    void readSenderRuleState({ account, threadId })
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, threadId]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const row = rowRef.current;
    const panel = panelRef.current;
    const menu = row?.closest("[role=menu]");
    if (!row || !panel || !menu) return;
    const box = menu.getBoundingClientRect();
    const height = panel.getBoundingClientRect().height;
    const side = box.right + PANEL_WIDTH + 12 <= window.innerWidth || box.left < PANEL_WIDTH + 12 ? "right" : "left";
    // Its foot level with the foot of the menu, as far as the window allows.
    const wanted = box.height - height;
    const top = Math.max(8 - box.top, Math.min(wanted, window.innerHeight - 8 - height - box.top));
    setPlace({ side, top });
  }, [open, state]);

  const sender = state?.sender;
  if (!account || !state || !sender) return null;
  const rule = state.rule;

  const options: Option[] = [
    { action: "junk", icon: <ShieldAlert className={MENU_ICON} aria-hidden />, title: t("ruleAlwaysJunk"), hint: t("ruleAlwaysJunkHint") },
    { action: "archive", icon: <Archive className={MENU_ICON} aria-hidden />, title: t("ruleAlwaysArchive"), hint: t("ruleAlwaysArchiveHint") },
    {
      action: "folder",
      icon: <Folder className={MENU_ICON} aria-hidden />,
      title: rule?.action === "folder" && rule.folderName ? t("ruleAlwaysFolderNow", { name: rule.folderName }) : t("ruleAlwaysFolder"),
      hint: t("ruleAlwaysFolderHint"),
    },
    { action: "trash", icon: <Trash2 className={MENU_ICON} aria-hidden />, title: t("ruleAlwaysTrash"), hint: t("ruleAlwaysTrashHint") },
  ];

  const dialog = (action?: SenderRuleAction) => {
    onDismiss();
    openSenderRuleDialog({ account, state: { ...state, sender }, action });
  };
  const pick = (action: SenderRuleAction) => {
    // A folder is picked in the dialog.
    if (action === "folder") return dialog("folder");
    onDismiss();
    void saveSenderRuleFromUi({
      account,
      match: "sender",
      value: sender.email,
      name: sender.name,
      action,
      moveExisting: true,
    });
  };
  const remove = () => {
    onDismiss();
    if (rule) void removeSenderRuleFromUi(rule.id);
  };

  return (
    <>
      <div className="my-1 border-t border-stone-200" role="separator" />
      <button
        ref={rowRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(MENU_ITEM, open && "bg-stone-100")}
        // The pointer over the line opens the panel, so a click must not
        // close it again: both only open it.
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
      >
        <ListFilter className={MENU_ICON} aria-hidden />
        <span className="max-w-[16rem] truncate">{t("rulesFor", { name: sender.name })}</span>
        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={t("rulesFor", { name: sender.name })}
          style={{
            width: PANEL_WIDTH,
            top: place?.top ?? 0,
            ...(place?.side === "left" ? { right: "calc(100% + 4px)" } : { left: "calc(100% + 4px)" }),
            visibility: place ? "visible" : "hidden",
          }}
          className="absolute rounded-surface border border-stone-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-stone-200 px-3 pb-2 pt-1.5">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-stone-500">{t("ruleFutureMailFrom")}</div>
            <div className="truncate text-sm font-semibold text-stone-900">{sender.email}</div>
          </div>
          <div className="py-1">
            {options.map((option) => {
              const inUse = rule?.action === option.action;
              return (
                <button
                  key={option.action}
                  type="button"
                  role="menuitem"
                  className={cn(MENU_ITEM, "items-start py-2")}
                  onClick={() => pick(option.action)}
                >
                  <span className="mt-0.5">{option.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-stone-900">{option.title}</span>
                    <span className="block text-xs text-stone-500">{inUse ? t("ruleInUse") : option.hint}</span>
                  </span>
                  {inUse ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="border-t border-stone-200 pt-1">
            <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => dialog()}>
              <SlidersHorizontal className={MENU_ICON} aria-hidden />
              {t("ruleMoreOptions")}
            </button>
            {rule ? (
              <button type="button" role="menuitem" className={MENU_ITEM} onClick={remove}>
                <X className={MENU_ICON} aria-hidden />
                {t("ruleRemove")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
