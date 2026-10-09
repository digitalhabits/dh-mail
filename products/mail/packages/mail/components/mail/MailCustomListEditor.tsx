"use client";

import * as React from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_SCHEDULE_FROM,
  DEFAULT_SCHEDULE_TO,
  EVERY_DAY,
  SCHEDULE_DAY_LABELS,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  normalizeScheduleDays,
  sameDaySet,
  type MailCustomListMember,
  type MailCustomListSchedule,
  type MailScheduleDay,
} from "@/lib/mail/custom-lists";
import type { MailContactSuggestion } from "@/lib/mail/contact-suggestion";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";


let contactsCache: Promise<MailContactSuggestion[]> | null = null;

function loadContacts(): Promise<MailContactSuggestion[]> {
  if (!contactsCache) {
    contactsCache = apiJson<{ contacts: MailContactSuggestion[] }>(
      "/api/mail/contacts"
    )
      .then((r) => r.contacts ?? [])
      .catch(() => {
        contactsCache = null;
        return [];
      });
  }
  return contactsCache;
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function filterContacts(
  query: string,
  contacts: MailContactSuggestion[],
  taken: Set<string>
): MailContactSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { contact: MailContactSuggestion; score: number }[] = [];
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (taken.has(email)) continue;
    const name = contact.name.toLowerCase();
    const org = contact.recordName.toLowerCase();
    let score = -1;
    if (email.startsWith(q) || name.startsWith(q)) score = 0;
    else if (email.includes(q) || name.includes(q)) score = 1;
    else if (org.includes(q)) score = 2;
    if (score >= 0) hits.push({ contact, score });
  }
  hits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.contact.name || a.contact.email).localeCompare(
      b.contact.name || b.contact.email,
      undefined,
      { sensitivity: "base" }
    );
  });
  return hits.slice(0, 8).map((h) => h.contact);
}

const fieldClass =
  "w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-teal-600 focus:bg-white";

function TimeField({
  label,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  "aria-label": string;
}) {
  return (
    <div className="w-fit">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <input
        type="time"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value || DEFAULT_SCHEDULE_FROM)}
        className="mt-1 w-auto rounded-xl border border-stone-200 bg-white py-1.5 pl-2 pr-[2px] text-sm tabular-nums text-stone-900 outline-none focus:border-teal-600 [&::-webkit-calendar-picker-indicator]:ml-0.5 [&::-webkit-calendar-picker-indicator]:mr-[2px] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:p-0"
      />
    </div>
  );
}

function toggleDay(
  days: MailScheduleDay[],
  day: MailScheduleDay
): MailScheduleDay[] {
  if (days.includes(day)) {
    if (days.length <= 1) return days;
    return days.filter((d) => d !== day).sort((a, b) => a - b);
  }
  return [...days, day].sort((a, b) => a - b) as MailScheduleDay[];
}

/** Inline editor card under the tab row (not a popover). */
export function MailCustomListEditor({
  open,
  onCancel,
  initial,
  title = "New list",
  submitLabel = "Create list",
  onSubmit,
  onDelete,
  scheduleOnly = false,
}: {
  open: boolean;
  onCancel: () => void;
  initial?: {
    name: string;
    members: MailCustomListMember[];
    scheduleDefault?: boolean;
    scheduleFrom?: string;
    scheduleTo?: string;
    scheduleDays?: MailScheduleDay[];
  };
  title?: string;
  submitLabel?: string;
  onSubmit: (
    name: string,
    members: MailCustomListMember[],
    schedule: MailCustomListSchedule
  ) => void;
  onDelete?: () => void;
  /**
   * The schedule and nothing else.
   *
   * For the built-in filters. There is no name of yours on All or In
   * Contacts and no list of people in them — the only thing there is to say
   * about one is when it should be the tab Mail opens on.
   */
  scheduleOnly?: boolean;
}) {
  const t = useMailT();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [members, setMembers] = React.useState<MailCustomListMember[]>(
    initial?.members ?? []
  );
  const [scheduleDefault, setScheduleDefault] = React.useState(
    Boolean(initial?.scheduleDefault)
  );
  const [scheduleFrom, setScheduleFrom] = React.useState(
    initial?.scheduleFrom || DEFAULT_SCHEDULE_FROM
  );
  const [scheduleTo, setScheduleTo] = React.useState(
    initial?.scheduleTo || DEFAULT_SCHEDULE_TO
  );
  const [scheduleDays, setScheduleDays] = React.useState<MailScheduleDay[]>(
    () => normalizeScheduleDays(initial?.scheduleDays)
  );
  const [query, setQuery] = React.useState("");
  const [contacts, setContacts] = React.useState<MailContactSuggestion[]>([]);
  const [highlight, setHighlight] = React.useState(0);
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const initialKey = `${initial?.name ?? ""}\0${(initial?.members ?? [])
    .map((m) => m.email)
    .join(",")}\0${initial?.scheduleDefault ? "1" : "0"}\0${
    initial?.scheduleFrom ?? ""
  }\0${initial?.scheduleTo ?? ""}\0${(initial?.scheduleDays ?? []).join(",")}`;

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setMembers(initial?.members ?? []);
    setScheduleDefault(Boolean(initial?.scheduleDefault));
    setScheduleFrom(initial?.scheduleFrom || DEFAULT_SCHEDULE_FROM);
    setScheduleTo(initial?.scheduleTo || DEFAULT_SCHEDULE_TO);
    setScheduleDays(normalizeScheduleDays(initial?.scheduleDays));
    setQuery("");
    setHighlight(0);
    void loadContacts().then(setContacts);
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // Reset whenever the editor opens for a different list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);

  const taken = React.useMemo(
    () => new Set(members.map((m) => m.email.toLowerCase())),
    [members]
  );
  const suggestions = React.useMemo(
    () => filterContacts(query, contacts, taken),
    [query, contacts, taken]
  );

  const addMember = (member: MailCustomListMember) => {
    const email = member.email.trim().toLowerCase();
    if (!email || taken.has(email)) return;
    setMembers((prev) => [...prev, { email, name: member.name.trim() }]);
    setQuery("");
    setHighlight(0);
  };

  const addFromQuery = () => {
    const raw = query.trim();
    if (!raw) return;
    if (suggestions[highlight]) {
      const hit = suggestions[highlight];
      addMember({ email: hit.email, name: hit.name });
      return;
    }
    if (isEmail(raw)) {
      addMember({ email: raw, name: "" });
    }
  };

  const canSubmit = scheduleOnly || name.trim().length > 0;

  if (!open) return null;

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">
        {title}
      </p>
      {scheduleOnly ? null : (
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("listNamePlaceholder")}
          className={cn(fieldClass, "mt-2.5")}
        />
      )}
      {scheduleOnly ? null : (
        <>
      <div className="relative mt-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) =>
                Math.min(h + 1, Math.max(0, suggestions.length - 1))
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              addFromQuery();
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder={t("searchForPeople")}
          className={fieldClass}
        />
        {suggestions.length ? (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-md">
            {suggestions.map((contact, index) => (
              <li key={contact.email}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() =>
                    addMember({
                      email: contact.email,
                      name: contact.name,
                    })
                  }
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-1.5 text-left text-sm",
                    index === highlight
                      ? "bg-teal-50 text-stone-900"
                      : "hover:bg-stone-50"
                  )}
                >
                  <span className="truncate font-medium">
                    {contact.name || contact.email}
                  </span>
                  <span className="truncate text-xs text-stone-500">
                    {contact.name ? contact.email : contact.recordName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {members.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {members.map((member) => (
            <span
              key={member.email}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-900"
            >
              <span className="truncate">{member.name || member.email}</span>
              <button
                type="button"
                title={`Remove ${member.name || member.email}`}
                aria-label={`Remove ${member.name || member.email}`}
                className="rounded-full p-0.5 text-teal-700/70 hover:bg-teal-100 hover:text-teal-900"
                onClick={() =>
                  setMembers((prev) =>
                    prev.filter((m) => m.email !== member.email)
                  )
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
        </>
      )}

      <div className="mt-3 border-t border-stone-200 pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
          <button
            type="button"
            role="checkbox"
            aria-checked={scheduleDefault}
            onClick={() => setScheduleDefault((v) => !v)}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              scheduleDefault
                ? "border-teal-700 bg-teal-700 text-white"
                : "border-stone-300 bg-white"
            )}
          >
            {scheduleDefault ? (
              <Check className="h-3 w-3" strokeWidth={3} />
            ) : null}
          </button>
          <span>{t("defaultTabAtSetTimes")}</span>
        </label>
        {scheduleDefault ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-end gap-2">
              <TimeField
                label={t("start")}
                aria-label={t("scheduleStartTime")}
                value={scheduleFrom}
                onChange={setScheduleFrom}
              />
              <span
                className="mb-2.5 shrink-0 text-stone-400"
                aria-hidden
              >
                →
              </span>
              <TimeField
                label={t("endTime")}
                aria-label={t("scheduleEndTime")}
                value={scheduleTo}
                onChange={setScheduleTo}
              />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                {t("days")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SCHEDULE_DAY_LABELS.map(({ day, label }) => {
                  const selected = scheduleDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setScheduleDays((prev) => toggleDay(prev, day))
                      }
                      className={cn(
                        "min-w-[2.75rem] rounded-xl px-2.5 py-1.5 text-xs font-semibold",
                        selected
                          ? "bg-teal-700 text-white"
                          : "border border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  [
                    { label: "Weekdays", days: WEEKDAY_DAYS },
                    { label: "Weekends", days: WEEKEND_DAYS },
                    { label: "Every day", days: EVERY_DAY },
                  ] as const
                ).map((preset) => {
                  const active = sameDaySet(scheduleDays, preset.days);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setScheduleDays([...preset.days])}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold",
                        active
                          ? "border border-teal-600 bg-teal-50 text-teal-800"
                          : "border border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-sm text-stone-600 hover:text-stone-900"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          {onDelete ? (
            <button
              type="button"
              className="text-sm text-rose-600 hover:text-rose-700"
              onClick={onDelete}
            >
              {t("delete")}
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          className="rounded-lg bg-teal-700 px-3 text-white hover:bg-teal-800 disabled:opacity-50"
          onClick={() => {
            if (!canSubmit) return;
            onSubmit(name.trim(), members, {
              enabled: scheduleDefault,
              from: scheduleFrom,
              to: scheduleTo,
              days: scheduleDays,
            });
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
