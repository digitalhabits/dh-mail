"use client";

/**
 * "Rule for <sender>": every choice of a rule for a sender
 * (lib/mail/sender-rules.ts), opened by "More options…" and by "Always
 * move to a folder…" in a row's menu (sender-rule-menu.tsx).
 *
 * Which mail: this address, or everyone at its domain. The domain is not
 * offered for the domains many unrelated people write from. Send it to:
 * Junk, Archive, a folder of this mailbox, or Trash. And whether the mail
 * of theirs that is in the inbox now goes too.
 *
 * The page holds the dialog (SenderRuleDialogHost): the menu that opens it
 * is gone by the time it shows.
 */

import * as React from "react";
import { Archive, ChevronDown, Folder, Globe, ShieldAlert, Trash2, User } from "lucide-react";

import { useMailFolders } from "@/components/mail/MailFolders";
import { SettingsDialog, settingsPrimaryButton } from "@/components/mail/settings-ui";
import { buildFolderTree, filterFolderTree, type FolderTreeNode } from "@/lib/mail/folder-tree";
import { useMailT } from "@/lib/mail/i18n";
import type { SenderRuleAction, SenderRuleMatch } from "@/lib/mail/sender-rules";
import { onSenderRuleDialog, saveSenderRuleFromUi, type SenderRuleDialogInput } from "@/lib/mail/sender-rule-ui";
import { cn } from "@/lib/utils";

/** Mounted once by the page. Draws nothing until a menu opens the dialog. */
export function SenderRuleDialogHost() {
  const [input, setInput] = React.useState<SenderRuleDialogInput | null>(null);
  React.useEffect(() => onSenderRuleDialog(setInput), []);
  if (!input) return null;
  // A new sender is a new dialog: nothing of the last one's choices stays.
  return <SenderRuleDialog key={`${input.account}|${input.state.sender.email}`} input={input} onClose={() => setInput(null)} />;
}

function SenderRuleDialog({ input, onClose }: { input: SenderRuleDialogInput; onClose: () => void }) {
  const t = useMailT();
  const { account, state } = input;
  const { sender, domain, rule, here } = state;
  const [match, setMatch] = React.useState<SenderRuleMatch>(rule?.match === "domain" && domain ? "domain" : "sender");
  const [action, setAction] = React.useState<SenderRuleAction>(input.action ?? rule?.action ?? "junk");
  const [folderName, setFolderName] = React.useState(rule?.folderName ?? "");
  const [moveExisting, setMoveExisting] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const count = match === "domain" ? here.domain : here.sender;
  const ready = action !== "folder" || Boolean(folderName);
  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const kept = await saveSenderRuleFromUi({
      account,
      match,
      value: match === "domain" ? domain : sender.email,
      name: sender.name,
      action,
      ...(action === "folder" ? { folderName } : null),
      moveExisting: moveExisting && count > 0,
    });
    setSaving(false);
    if (kept) onClose();
  };

  return (
    <SettingsDialog
      title={t("ruleDialogTitle", { name: sender.name })}
      onClose={onClose}
      closeLabel={t("cancel")}
      footer={
        <>
          <button
            type="button"
            className="rounded-control px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100"
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button type="button" className={settingsPrimaryButton} disabled={!ready || saving} onClick={() => void save()}>
            {t("ruleSave")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <Heading>{t("ruleWhichMail")}</Heading>
          <div role="radiogroup" aria-label={t("ruleWhichMail")} className="flex flex-col gap-2">
            <MatchCard
              chosen={match === "sender"}
              icon={<User className="h-4 w-4 shrink-0 text-stone-600" aria-hidden />}
              name={t("ruleThisSender")}
              what={sender.email}
              onPick={() => setMatch("sender")}
            />
            {domain ? (
              <MatchCard
                chosen={match === "domain"}
                icon={<Globe className="h-4 w-4 shrink-0 text-stone-600" aria-hidden />}
                name={t("ruleEveryoneAt", { domain })}
                what={t("ruleEveryoneAtHint", { domain })}
                onPick={() => setMatch("domain")}
              />
            ) : null}
          </div>
        </section>

        <section>
          <Heading>{t("ruleSendItTo")}</Heading>
          <Destinations action={action} onAction={setAction} />
          {action === "folder" ? <FolderChoice account={account} chosen={folderName} onChoose={setFolderName} /> : null}
        </section>

        {count > 0 ? (
          <label className="flex cursor-pointer items-center gap-3 text-sm text-stone-800">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-700"
              checked={moveExisting}
              onChange={(event) => setMoveExisting(event.target.checked)}
            />
            {count === 1 ? t("ruleAlsoMoveOne") : t("ruleAlsoMove", { count })}
          </label>
        ) : null}
      </div>
    </SettingsDialog>
  );
}

/** Not an h3: the app sets its headings in the serif face, and these are labels. */
function Heading({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-sans text-sm font-semibold text-stone-700">{children}</p>;
}

/** One answer of "Which mail": a card with a ring, as the hours questions have. */
function MatchCard({
  chosen,
  icon,
  name,
  what,
  onPick,
}: {
  chosen: boolean;
  icon: React.ReactNode;
  name: string;
  what: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onPick}
      className={cn(
        "flex items-center gap-3 rounded-control border px-4 py-3 text-left transition-colors",
        chosen ? "border-teal-600/70 bg-teal-600/10" : "border-stone-200 hover:bg-stone-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          chosen ? "border-teal-600" : "border-stone-300"
        )}
      >
        {chosen ? <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> : null}
      </span>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-stone-900">{name}</span>
        <span className="block truncate text-xs text-stone-500">{what}</span>
      </span>
    </button>
  );
}

/** Junk | Archive | Folder | Trash, as one row of tabs. */
function Destinations({ action, onAction }: { action: SenderRuleAction; onAction: (action: SenderRuleAction) => void }) {
  const t = useMailT();
  const mark = "h-3.5 w-3.5";
  const all: { id: SenderRuleAction; icon: React.ReactNode; label: string }[] = [
    { id: "junk", icon: <ShieldAlert className={mark} aria-hidden />, label: t("ruleToJunk") },
    { id: "archive", icon: <Archive className={mark} aria-hidden />, label: t("ruleToArchive") },
    { id: "folder", icon: <Folder className={mark} aria-hidden />, label: t("ruleToFolder") },
    { id: "trash", icon: <Trash2 className={mark} aria-hidden />, label: t("ruleToTrash") },
  ];
  return (
    <div role="radiogroup" aria-label={t("ruleSendItTo")} className="flex gap-1 rounded-surface bg-[var(--mail-segment-track,rgba(0,0,0,0.05))] p-1">
      {all.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={action === option.id}
          onClick={() => onAction(option.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-control px-3 py-1.5 text-sm transition-colors",
            action === option.id
              ? "bg-[var(--mail-segment-active)] font-semibold text-[var(--mail-segment-active-fg)] shadow-sm"
              : "text-[var(--mail-segment-fg)] hover:text-[var(--mail-segment-active-fg)]"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A folder a rule can file into: one somebody made, on this mailbox. */
const fileable = (node: FolderTreeNode) => !node.implied && !node.virtual && !node.role;

/** The folders somebody made, with the parents that hold them. The provider's own (Inbox, Sent, …) go. */
function ownFolders(nodes: FolderTreeNode[]): FolderTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: ownFolders(node.children) }))
    .filter((node) => fileable(node) || node.children.length > 0);
}

/** The folder of the mailbox the rule files into: a filter box over the folder tree. */
function FolderChoice({ account, chosen, onChoose }: { account: string; chosen: string; onChoose: (name: string) => void }) {
  const t = useMailT();
  // Every mailbox's folders, as the rail reads them, and this mailbox's taken
  // from that. Asking for one mailbox's alone put that answer in the list the
  // rail shares, and the rail then said the other mailboxes had no folders.
  const { accountFolders } = useMailFolders("all");
  const [query, setQuery] = React.useState("");
  const tree = React.useMemo(() => {
    const mine = accountFolders.filter((folder) => folder.account.toLowerCase() === account.toLowerCase());
    return filterFolderTree(ownFolders(buildFolderTree(mine)), query);
  }, [accountFolders, account, query]);

  const rows = (nodes: FolderTreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => (
      <React.Fragment key={node.name}>
        <button
          type="button"
          role="option"
          aria-selected={chosen === node.name}
          disabled={!fileable(node)}
          onClick={() => onChoose(node.name)}
          style={{ paddingLeft: 12 + depth * 18 }}
          className={cn(
            "flex w-full items-center gap-2 rounded-control py-1.5 pr-3 text-left text-sm text-stone-800 disabled:text-stone-400",
            chosen === node.name ? "bg-teal-600/10 font-semibold" : "enabled:hover:bg-stone-100"
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
          <span className="truncate">{node.label}</span>
        </button>
        {rows(node.children, depth + 1)}
      </React.Fragment>
    ));

  return (
    <div className="mt-2 rounded-control border border-stone-200">
      <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2 text-sm">
        <Folder className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
        <span className={cn("flex-1 truncate", chosen ? "font-medium text-stone-900" : "text-stone-500")}>
          {chosen || t("ruleChooseFolder")}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
      </div>
      <div className="p-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("filterFoldersPlaceholder")}
          aria-label={t("filterFolders")}
          className="w-full rounded-control border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-teal-600"
        />
        <div role="listbox" aria-label={t("ruleChooseFolder")} className="mt-1 max-h-44 overflow-y-auto">
          {tree.length ? rows(tree, 0) : <p className="px-3 py-2 text-sm text-stone-500">{t("ruleNoFolders")}</p>}
        </div>
      </div>
    </div>
  );
}
