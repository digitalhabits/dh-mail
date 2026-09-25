"use client";

/*
 * Contact lists in the address field: a list as one chip, its editor, the
 * menu of lists, and the control that saves the people on a message as a
 * list.
 *
 * RecipientField.tsx draws the field; recipient-suggestions.ts reads the
 * lists.
 */

import * as React from "react";
import { SquarePen, Users } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  type MailContactList,
  type MailContactListMember,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  mailSay,
  useMailT,
  type MailStringKey,
} from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  type ContactSuggestion,
  type MenuItem,
  avatarTone,
  filterMenu,
  initials,
  memberInitials,
  nameForEmail,
  parseEmails,
  refreshLists,
} from "@/components/mail/recipient-suggestions";

/**
 * "Save as list…", for a set of people already gathered.
 *
 * Exported because the compose field is not the only place a group of
 * addresses sits together: a circular that arrives in the inbox has the
 * whole club on it, and that is a list you want long before you write the
 * reply. The thread header uses it — see ThreadPane.
 */
export function SaveAsListControl({
  people,
  contacts = [],
  onSaved,
  className,
  align = "end",
  noteKey = "saveListNote",
  labelKey = "saveAsList",
}: {
  people: { email: string; name?: string }[];
  /** Only to fill in a name the caller does not have. */
  contacts?: ContactSuggestion[];
  onSaved?: (list: MailContactList) => void;
  className?: string;
  align?: "start" | "end";
  /** The small print under the box: it reads differently while composing. */
  noteKey?: MailStringKey;
  /** Its own control in the composer; part of a sentence in a thread. */
  labelKey?: MailStringKey;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const members = people.map((p) => ({
    email: p.email,
    name: p.name || nameForEmail(p.email, contacts) || "",
  }));

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const json = await apiJson<{ list: MailContactList }>(
        "/api/mail/contact-lists",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), members }),
        }
      );
      await refreshLists();
      onSaved?.(json.list);
      setOpen(false);
      setName("");
      toast.success(mailSay("savedListNamed", { name: json.list.name }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : mailSay("couldNotSaveList")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "shrink-0 text-xs text-teal-700 underline-offset-2 hover:underline",
            className
          )}
        >
          {t(labelKey)}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align={align} className="w-72 p-3">
        <p className="text-sm font-medium text-stone-800">
          {t("saveTheseAsList", { count: people.length })}
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={t("listName")}
          className="mt-2 w-full rounded-lg border border-teal-600 px-2.5 py-1.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-teal-600/20"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {saving ? t("saving") : t("save")}
          </button>
          <button
            type="button"
            className="text-sm text-teal-700 hover:underline"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-stone-400">
          {t(noteKey)}
        </p>
      </MailPopoverContent>
    </Popover>
  );
}

function EditListPanel({
  name,
  setName,
  members,
  setMembers,
  addDraft,
  setAddDraft,
  contacts,
  saving,
  onDone,
  onDelete,
}: {
  name: string;
  setName: (v: string) => void;
  members: MailContactListMember[];
  setMembers: React.Dispatch<React.SetStateAction<MailContactListMember[]>>;
  addDraft: string;
  setAddDraft: (v: string) => void;
  contacts: ContactSuggestion[];
  saving: boolean;
  onDone: () => void;
  onDelete: () => void;
}) {
  const t = useMailT();
  const [editingInitialsEmail, setEditingInitialsEmail] = React.useState<
    string | null
  >(null);
  const [initialsDraft, setInitialsDraft] = React.useState("");
  const initialsInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (editingInitialsEmail) {
      initialsInputRef.current?.focus();
      initialsInputRef.current?.select();
    }
  }, [editingInitialsEmail]);

  const beginEditInitials = (m: MailContactListMember) => {
    setEditingInitialsEmail(m.email);
    setInitialsDraft(memberInitials(m));
  };

  const commitInitialsDraft = (email: string, raw: string) => {
    const next = raw.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
    setMembers((current) =>
      current.map((m) => {
        if (m.email !== email) return m;
        if (!next) {
          const { initials: _drop, ...rest } = m;
          return rest;
        }
        return { ...m, initials: next };
      })
    );
    setEditingInitialsEmail(null);
  };

  const addSuggestions = filterMenu(
    addDraft,
    contacts,
    [],
    members.map((m) => ({ kind: "email" as const, email: m.email }))
  ).filter((i): i is Extract<MenuItem, { kind: "contact" }> => i.kind === "contact");

  const addPerson = (email: string, personName?: string) => {
    const e = email.toLowerCase();
    if (members.some((m) => m.email === e)) {
      setAddDraft("");
      return;
    }
    setMembers((current) => [
      ...current,
      {
        email: e,
        name: personName || nameForEmail(e, contacts) || "",
      },
    ]);
    setAddDraft("");
  };

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm font-semibold text-stone-900 outline-none focus:border-teal-600"
        />
        <span className="shrink-0 text-xs text-stone-400">
          {members.length === 1
            ? t("onePersonCount")
            : t("peopleCount", { count: members.length })}
        </span>
      </div>
      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">
        {members.map((m) => (
          <li
            key={m.email}
            className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-stone-50"
          >
            {editingInitialsEmail === m.email ? (
              <input
                ref={initialsInputRef}
                value={initialsDraft}
                maxLength={2}
                aria-label={`Initials for ${m.name || m.email}`}
                title={t("editInitials")}
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full text-center text-[10px] font-semibold uppercase outline-none ring-2 ring-teal-600",
                  avatarTone(m.email)
                )}
                onChange={(e) =>
                  setInitialsDraft(
                    e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase()
                  )
                }
                onBlur={() => commitInitialsDraft(m.email, initialsDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitInitialsDraft(m.email, initialsDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingInitialsEmail(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                title={t("editInitials")}
                aria-label={`Edit initials for ${m.name || m.email}`}
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold hover:ring-2 hover:ring-teal-500/60",
                  avatarTone(m.email)
                )}
                onClick={() => beginEditInitials(m)}
              >
                {memberInitials(m)}
              </button>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-stone-800">
                {m.name || m.email}
              </span>
              {m.name ? (
                <span className="block truncate text-xs text-stone-400">
                  {m.email}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              aria-label={`Remove ${m.name || m.email}`}
              className="rounded px-1 text-stone-400 hover:text-red-700"
              onClick={() =>
                setMembers((current) =>
                  current.filter((x) => x.email !== m.email)
                )
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="relative mt-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-2 py-1.5">
          <span className="text-stone-400">+</span>
          <input
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addDraft.trim()) {
                e.preventDefault();
                const hit = addSuggestions[0];
                if (hit) addPerson(hit.contact.email, hit.contact.name);
                else {
                  const emails = parseEmails(addDraft);
                  if (emails[0]) addPerson(emails[0]);
                }
              }
            }}
            placeholder={t("addPerson")}
            // Names and addresses: the Mac's own suggestions stand down
            // here for the same reason they do in the To field.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
          />
        </div>
        {addDraft.trim() && addSuggestions.length ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
            {addSuggestions.slice(0, 5).map((item) => (
              <li key={item.contact.email}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-stone-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addPerson(item.contact.email, item.contact.name);
                  }}
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold",
                      avatarTone(item.contact.email)
                    )}
                  >
                    {initials(item.contact.name, item.contact.email)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-800">
                      {item.contact.name || item.contact.email}
                    </span>
                    <span className="block truncate text-xs text-stone-400">
                      {item.contact.email}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          disabled={saving || members.length < 2 || !name.trim()}
          onClick={() => void onDone()}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
        >
          {saving ? t("saving") : t("done")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onDelete()}
          className="text-sm text-red-600 hover:underline"
        >
          {t("deleteList")}
        </button>
      </div>
    </div>
  );
}

export function ListChip({
  recipient,
  contacts,
  variant,
  selected,
  onSelect,
  onRelease,
  onChange,
  onExpand,
  onRemove,
  carry,
}: {
  recipient: Extract<MailRecipient, { kind: "list" }>;
  contacts: ContactSuggestion[];
  variant: "boxed" | "inline";
  selected?: boolean;
  /** Set where the chip may be carried to another field. */
  carry?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  onSelect: (e: React.MouseEvent) => void;
  /** The mouse let go without a drag: give the input its focus back. */
  onRelease?: () => void;
  onChange: (next: Extract<MailRecipient, { kind: "list" }>) => void;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(recipient.name);
  const [members, setMembers] = React.useState(recipient.members);
  const [addDraft, setAddDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setEditing(false);
      setName(recipient.name);
      setMembers(recipient.members);
      setAddDraft("");
    }
  }, [open, recipient.name, recipient.members]);

  const preview = members.slice(0, 3);
  const more = Math.max(0, members.length - preview.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          {...carry}
          className={cn(
            "select-none inline-flex cursor-pointer items-center gap-1 rounded-full bg-teal-100 py-0.5 pl-2 pr-1 text-teal-900",
            variant === "inline"
              ? "text-[13px]"
              : "mb-1 mr-1.5 align-middle text-xs",
            selected && "ring-2 ring-teal-600 ring-offset-1"
          )}
          aria-selected={selected}
          /* Focusable for the same reason as an address chip: see there. */
          tabIndex={-1}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onSelect(e);
          }}
          onMouseUp={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onRelease?.();
          }}
        >
          <Users className="h-3.5 w-3.5 shrink-0 text-teal-700" />
          <button
            type="button"
            className="max-w-[16ch] truncate font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            {recipient.name}
          </button>
          <span className="text-teal-700/80">· {recipient.members.length}</span>
          <button
            type="button"
            data-chip-remove
            aria-label={`Remove ${recipient.name}`}
            title={`Remove ${recipient.name}`}
            className="rounded-full px-1 text-teal-700/70 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        </span>
      </PopoverTrigger>
      <MailPopoverContent
        align="start"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!editing ? (
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">
                {recipient.name}
              </p>
              <button
                type="button"
                className="shrink-0 text-xs text-teal-700 hover:underline"
                onClick={() => setEditing(true)}
              >
                {t("editList")}
              </button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {preview.map((m) => (
                <li key={m.email} className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">
                    {m.name || m.email}
                  </p>
                  {m.name ? (
                    <p className="truncate text-xs text-stone-400">{m.email}</p>
                  ) : null}
                </li>
              ))}
              {more > 0 ? (
                <li className="text-xs text-stone-400">+ {more} more</li>
              ) : null}
            </ul>
            <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
              <button
                type="button"
                className="text-sm text-teal-700 hover:underline"
                onClick={() => {
                  setOpen(false);
                  onExpand();
                }}
              >
                {t("expandToRecipients", { count: members.length })}
              </button>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={Boolean(recipient.sendAsBcc)}
                  onChange={(e) =>
                    onChange({ ...recipient, sendAsBcc: e.target.checked })
                  }
                  className="rounded border-stone-300 text-teal-600 focus:ring-teal-600"
                />
                  {t("sendAsBcc")}
                </label>
            </div>
          </div>
        ) : (
          <EditListPanel
            name={name}
            setName={setName}
            members={members}
            setMembers={setMembers}
            addDraft={addDraft}
            setAddDraft={setAddDraft}
            contacts={contacts}
            saving={saving}
            onDone={async () => {
              setSaving(true);
              try {
                const json = await apiJson<{ list: MailContactList }>(
                  "/api/mail/contact-lists",
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: recipient.listId,
                      name: name.trim(),
                      members,
                    }),
                  }
                );
                await refreshLists();
                onChange({
                  ...recipient,
                  name: json.list.name,
                  members: json.list.members,
                });
                setEditing(false);
                toast.success(mailSay("listUpdated"));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Couldn't update list"
                );
              } finally {
                setSaving(false);
              }
            }}
            onDelete={async () => {
              if (!window.confirm(`Delete list “${recipient.name}”?`)) return;
              setSaving(true);
              try {
                await apiJson(
                  `/api/mail/contact-lists?id=${encodeURIComponent(recipient.listId)}`,
                  { method: "DELETE" }
                );
                await refreshLists();
                onRemove();
                setOpen(false);
                toast.success(mailSay("listDeleted"));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Couldn't delete list"
                );
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}

/**
 * One list, open for editing, in the place the menu was.
 *
 * A list could only be edited from a chip: you had to put it into a message
 * first, open it, and press Edit — three steps, and the first one leaves
 * something in a message you may not be writing. The pencils in the
 * suggestions and in the lists menu both come here instead.
 *
 * It takes the same spot under the field the suggestions use, so the menu
 * you pressed the pencil in becomes the thing you pressed it for, rather
 * than a second panel over the top of the first.
 */
export function ListEditorCard({
  list,
  contacts,
  above,
  maxHeight,
  onClose,
  onSaved,
  onDeleted,
}: {
  list: MailContactList;
  contacts: ContactSuggestion[];
  above: boolean;
  maxHeight: number;
  onClose: () => void;
  onSaved: (list: MailContactList) => void;
  onDeleted: (listId: string) => void;
}) {
  const [name, setName] = React.useState(list.name);
  const [members, setMembers] = React.useState<MailContactListMember[]>(
    list.members
  );
  const [addDraft, setAddDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  // A second pencil, on a different list, without closing the first.
  React.useEffect(() => {
    setName(list.name);
    setMembers(list.members);
    setAddDraft("");
  }, [list.id, list.name, list.members]);

  /*
    A way out that is not "Done" and not "Delete list".

    Both of those do something to the list, and a reader who opened the
    wrong one, or came to look rather than to change, needs neither. Click
    away or press Escape, same as the menu this replaced — and the edits
    are dropped, because nothing has been sent until Done.
  */
  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (saving) return;
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, saving]);

  return (
    <div
      ref={cardRef}
      // The reply band clips what hangs out of it; see mail.css.
      data-recipient-menu=""
      className={cn(
        "absolute left-0 right-0 z-30 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 shadow-lg",
        above ? "bottom-full mb-1" : "top-full mt-1"
      )}
      style={{ maxHeight }}
      // The field's own blur would otherwise commit whatever was typed and
      // shut the menu the moment a name here is clicked into.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <EditListPanel
        name={name}
        setName={setName}
        members={members}
        setMembers={setMembers}
        addDraft={addDraft}
        setAddDraft={setAddDraft}
        contacts={contacts}
        saving={saving}
        onDone={async () => {
          setSaving(true);
          try {
            const json = await apiJson<{ list: MailContactList }>(
              "/api/mail/contact-lists",
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: list.id,
                  name: name.trim(),
                  members,
                }),
              }
            );
            await refreshLists();
            // The store answers with the list it kept; without one there is
            // nothing to copy onto the chips, and closing is still right.
            if (json.list) onSaved(json.list);
            onClose();
            toast.success(mailSay("listUpdated"));
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUpdateList")
            );
          } finally {
            setSaving(false);
          }
        }}
        onDelete={async () => {
          if (!window.confirm(mailSay("deleteListNamed", { name: list.name }))) {
            return;
          }
          setSaving(true);
          try {
            await apiJson(
              `/api/mail/contact-lists?id=${encodeURIComponent(list.id)}`,
              { method: "DELETE" }
            );
            await refreshLists();
            onDeleted(list.id);
            onClose();
            toast.success(mailSay("listDeleted"));
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotDeleteList")
            );
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}

/**
 * Every list you have, at the end of the field.
 *
 * A list could only be found by typing the first letters of its name, which
 * works when you remember it and not at all otherwise — and a reader who
 * has just made one has no reason to think it is in there. So: a button,
 * the lists behind it, and the same pencil on each.
 */
export function ListsMenu({
  lists,
  onPick,
  onEdit,
  className,
}: {
  lists: MailContactList[];
  onPick: (list: MailContactList) => void;
  onEdit: (list: MailContactList) => void;
  className?: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("yourLists")}
          title={t("yourLists")}
          className={cn(
            "shrink-0 rounded-md p-1 text-[var(--mail-chip-muted)] transition-colors hover:bg-[var(--mail-action-2-hover)] hover:text-[var(--mail-chip-fg)]",
            open && "bg-[var(--mail-action-2-hover)] text-[var(--mail-chip-fg)]",
            className
          )}
        >
          <Users className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="w-64 p-1">
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t("yourLists")}
        </p>
        {lists.map((list) => (
          <div
            key={list.id}
            className="group flex items-center rounded-md hover:bg-stone-100"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2 text-left"
              onClick={() => {
                setOpen(false);
                onPick(list);
              }}
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                <Users className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-stone-900">
                  {list.name}
                </span>
                <span className="block text-xs text-stone-500">
                  {listSubtitle(t, list.members.length)}
                </span>
              </span>
            </button>
            <EditListButton
              className="mr-1 text-stone-400 hover:text-stone-700"
              onEdit={() => {
                setOpen(false);
                onEdit(list);
              }}
            />
          </div>
        ))}
      </MailPopoverContent>
    </Popover>
  );
}

/** The little pencil that opens a list for editing. */
export function EditListButton({
  onEdit,
  className,
}: {
  onEdit: () => void;
  className?: string;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      aria-label={t("editList")}
      title={t("editList")}
      // mousedown, and stopped: the field is watching for a blur, and a
      // click that lands after one arrives at a closed menu.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      }}
      className={cn(
        "shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 focus-visible:opacity-100",
        className
      )}
    >
      <SquarePen className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** How a list says what it is, under its name. */
export function listSubtitle(t: ReturnType<typeof useMailT>, count: number): string {
  return count === 1
    ? t("listOnePerson")
    : t("listPeopleCount", { count });
}
