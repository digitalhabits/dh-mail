"use client";

/**
 * A proposed to-do task, drawn the way To-Do draws the task being added.
 *
 * The title, the note under it, and a row of chips: the list the task goes
 * on, and who it is for. Who it is for is a menu of the board's people with
 * their avatars, not a row of names to press — the same menu the board has,
 * so a reader who assigns tasks there knows this one.
 *
 * Built from the parts every proposal uses; see ProposalCardParts.
 */

import * as React from "react";
import { ChevronDown, List, User, X } from "lucide-react";

import {
  CardLine,
  CardText,
  ChipRow,
  MenuRow,
  PersonAvatar,
  ProposalCard,
  chipClass,
  chipIconClass,
  chipSetClass,
} from "@/components/mail/ProposalCardParts";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { useMailT } from "@/lib/mail/i18n";
import { firstName, shortPersonName } from "@/lib/mail/task-people";
import { cn } from "@/lib/utils";

export type TaskListChoice = { id: string; name: string; group: string | null };

export type TaskPersonChoice = {
  id: string;
  name: string;
  email: string | null;
  colour?: string | null;
  photoUrl?: string | null;
};

/** Overlapping avatars, three at most and a count for the rest. */
function AssigneeStack({ people, size }: { people: TaskPersonChoice[]; size: number }) {
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  const step = size - Math.round(size * 0.35);
  const width = size + (shown.length - 1) * step + (extra > 0 ? step : 0);
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width, height: size }}>
      {shown.map((person, i) => (
        <span
          key={person.id}
          className="absolute top-0 overflow-hidden rounded-full leading-none ring-[1.5px] ring-stone-100"
          style={{ left: i * step, zIndex: i + 1, width: size, height: size }}
        >
          <PersonAvatar
            name={person.name}
            colour={person.colour}
            photoUrl={person.photoUrl}
            size={size}
          />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="absolute top-0 inline-flex items-center justify-center rounded-full bg-stone-200 font-bold text-stone-600 ring-[1.5px] ring-stone-100"
          style={{
            left: shown.length * step,
            zIndex: shown.length + 1,
            width: size,
            height: size,
            fontSize: size * 0.38,
          }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

export function TaskProposalFields({
  text,
  note,
  listId,
  assigneeIds,
  lists,
  people,
  onChange,
}: {
  text: string;
  note: string;
  listId: string;
  assigneeIds: string[];
  lists: TaskListChoice[];
  people: TaskPersonChoice[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const t = useMailT();
  const [listOpen, setListOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);

  const list = lists.find((l) => l.id === listId) ?? null;
  const assigned = assigneeIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is TaskPersonChoice => Boolean(p));

  // Lists under the name of their group, in the board's order.
  const groups: { name: string | null; lists: TaskListChoice[] }[] = [];
  for (const l of lists) {
    const at = groups.find((g) => g.name === l.group);
    if (at) at.lists.push(l);
    else groups.push({ name: l.group, lists: [l] });
  }

  const toggle = (personId: string) =>
    onChange({
      assigneeIds: assigneeIds.includes(personId)
        ? assigneeIds.filter((id) => id !== personId)
        : [...assigneeIds, personId],
    });

  return (
    <ProposalCard>
      <CardLine
        strong
        ariaLabel={t("taskTitle")}
        value={text}
        onChange={(value) => onChange({ text: value })}
      />
      {/* The task's note: what the card cannot hold, such as the link or the
          lines of the thread it depends on. Always there, so a note can be
          added to a task the model gave none. */}
      <CardText
        className="mt-1"
        ariaLabel={t("taskNote")}
        placeholder={t("taskNotePlaceholder")}
        value={note}
        onChange={(value) => onChange({ note: value })}
      />

      <ChipRow>
        {lists.length ? (
          <Popover open={listOpen} onOpenChange={setListOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={t("taskList")}
                aria-haspopup="listbox"
                aria-expanded={listOpen}
                className={cn(chipClass, list && chipSetClass)}
              >
                <List className={chipIconClass} strokeWidth={1.75} aria-hidden />
                <span className="max-w-[12rem] truncate">{list ? list.name : t("taskNoList")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
              </button>
            </PopoverTrigger>
            <MailPopoverContent align="start" className="max-h-72 w-60 overflow-y-auto rounded-xl p-1.5">
              <div role="listbox" aria-label={t("taskList")}>
                {groups.map((group, index) => (
                  <div key={group.name ?? ""}>
                    {group.name ? (
                      <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                        {group.name}
                      </p>
                    ) : index > 0 ? (
                      // Lists in no group, after a group: a rule, or they
                      // read as the last lists of the group above.
                      <div aria-hidden className="mx-1.5 my-1 border-t border-stone-100" />
                    ) : null}
                    {group.lists.map((l) => (
                      <MenuRow
                        key={l.id}
                        selected={l.id === listId}
                        onClick={() => {
                          onChange({ listId: l.id });
                          setListOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      </MenuRow>
                    ))}
                  </div>
                ))}
              </div>
            </MailPopoverContent>
          </Popover>
        ) : null}

        {people.length ? (
          <span className="inline-flex min-w-0 items-center">
            <Popover open={assignOpen} onOpenChange={setAssignOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={t("taskAssign")}
                  aria-haspopup="listbox"
                  aria-expanded={assignOpen}
                  className={cn(
                    chipClass,
                    assigned.length && chipSetClass,
                    assigned.length && "rounded-r-none pr-1.5"
                  )}
                >
                  {assigned.length ? (
                    <>
                      <AssigneeStack people={assigned} size={18} />
                      <span className="max-w-[12rem] truncate">
                        {assigned.map((p) => firstName(p.name)).join(", ")}
                      </span>
                    </>
                  ) : (
                    <>
                      <User className={chipIconClass} strokeWidth={2} aria-hidden />
                      <span>{t("taskAssign")}</span>
                    </>
                  )}
                </button>
              </PopoverTrigger>
              <MailPopoverContent align="start" className="max-h-72 w-56 overflow-y-auto rounded-xl p-1.5">
                <div role="listbox" aria-multiselectable aria-label={t("taskAssign")}>
                  {people.map((person) => (
                    <MenuRow
                      key={person.id}
                      selected={assigneeIds.includes(person.id)}
                      onClick={() => toggle(person.id)}
                    >
                      <PersonAvatar
                        name={person.name}
                        colour={person.colour}
                        photoUrl={person.photoUrl}
                        size={26}
                      />
                      <span className="min-w-0 flex-1 truncate">{shortPersonName(person.name)}</span>
                    </MenuRow>
                  ))}
                </div>
              </MailPopoverContent>
            </Popover>
            {assigned.length ? (
              <button
                type="button"
                title={t("taskClearAssignees")}
                aria-label={t("taskClearAssignees")}
                onClick={() => onChange({ assigneeIds: [] })}
                className={cn(chipClass, chipSetClass, "rounded-l-none pl-1 pr-2 font-normal text-stone-500")}
              >
                <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
              </button>
            ) : null}
          </span>
        ) : null}
      </ChipRow>
    </ProposalCard>
  );
}
