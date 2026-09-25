"use client";

/*
 * The CRM proposal dialog's types, and the parts its cards are drawn with:
 * the labels and icons of each kind of proposal, the fields a course has,
 * a record's chip and logo, the picker for a record or a value, and how a
 * value is shown.
 *
 * The dialog itself is CrmProposalDialog.tsx.
 */

import * as React from "react";
import {
  Building2,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Flag,
  Image as ImageIcon,
  ListChecks,
  PencilLine,
  StickyNote,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { mailApiJson } from "@/lib/mail/api";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { bareFieldClass, chipClass, chipSetClass } from "@/components/mail/ProposalCardParts";
import { type TaskListChoice, type TaskPersonChoice } from "@/components/mail/TaskProposalFields";

/**
 * The AI's proposals for a thread, for the reader to keep, change or drop.
 *
 * The model proposed calls to the same tools an agent has — a dated note,
 * a status move, a next step, a new contact, a new record, a meeting — and
 * nothing has happened yet. Each is a row: a checkbox, the record it is
 * for, and the fields, all editable. Apply runs the checked ones through
 * the planner, audited as the reader; a meeting sends real invitations, so
 * it starts unchecked.
 */

export type CrmCandidate = {
  source: string;
  recordId: string;
  recordName: string;
  via: "participant" | "body" | "domain" | "name" | "reader" | "model";
  match: string;
  confidence: "high" | "medium" | "low";
  logoUrl?: string;
};

export type CrmProposal = {
  id: string;
  tool:
    | "log_interaction"
    | "advance_status"
    | "set_next_step"
    | "add_contact"
    | "set_logo"
    | "create_record"
    | "update_record"
    | "create_task"
    | "create_meeting"
    | "update_meeting"
    | "update_course";
  input: Record<string, unknown>;
  why: string;
};

export type CrmProposeResult = {
  candidates: CrmCandidate[];
  proposals: CrmProposal[];
  statusOptions: Record<string, string[]>;
  /** Every organisation the CRM knows, when a proposal names one. */
  organisations?: { name: string; logo?: string }[];
  /** The values a filled column accepts, where it accepts only some. */
  fieldChoices?: {
    source: string;
    column: string;
    options: { value: string; logo?: string }[];
  }[];
  /** The board's lists, when a task is proposed. */
  taskLists?: TaskListChoice[];
  /** The board's people, for a proposed task's assignees. */
  taskPeople?: TaskPersonChoice[];
  /** Whose calendar a proposed meeting goes on, and with what link. */
  meetingTarget?: {
    accountEmail: string;
    calendarName: string;
    location: string | null;
    timeZone: string;
    /** The account's writable calendars, for the picker. */
    calendars?: string[];
  };
  /** The meetings this thread's people are on, named by a move. */
  threadMeetings?: {
    eventId: string;
    title: string;
    start: string;
    end: string;
    attendees: string[];
    url: string;
  }[];
  /** The courses a proposed course change names, with what each says now. */
  courses?: { key: string; title: string; current: Record<string, string> }[];
  dropped: { tool: string; error: string }[];
  note?: string;
  error?: string;
  debug?: {
    messages: { own: boolean; from: string; chars: number; sentToModel: number }[];
    candidates: number;
    modelAnswer: string;
  };
};

export type Row = { proposal: CrmProposal; checked: boolean; input: Record<string, unknown> };

/**
 * The zones a meeting is agreed in around here, the configured one first
 * in the picker. Anything else arrives from the model or the thread and
 * joins the list by being the chosen value.
 */
export const MEETING_TIME_ZONES = [
  "Europe/London",
  "Europe/Copenhagen",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

export const TOOL_LABEL: Record<CrmProposal["tool"], string> = {
  log_interaction: "Note",
  advance_status: "Status",
  set_next_step: "Next step",
  add_contact: "Add contact",
  set_logo: "Logo",
  create_record: "New record",
  update_record: "Fill in",
  create_task: "To-do",
  create_meeting: "Meeting invitation",
  update_meeting: "Move the meeting",
  update_course: "Course details",
};

/** Changes a course, which has a Course key and no `crm_records` id. */
export const COURSE_TOOLS = new Set<CrmProposal["tool"]>(["update_course"]);

/** A table by the name on its tab. Every CRM source is that one word. */
export const tableLabel = (source: string) =>
  source.charAt(0).toUpperCase() + source.slice(1);

/** A course change's fields, as the course form names them, in the form's order. */
export const COURSE_FIELD_LABELS: [string, string][] = [
  ["startDate", "First day"],
  ["endDate", "Last day"],
  ["startTime", "Start time"],
  ["endTime", "End time"],
  ["timeZone", "Time zone"],
  ["format", "Format"],
  ["location", "Address"],
  ["link", "Joining link"],
  ["meetingPoint", "Meeting point"],
  ["food", "Food"],
  ["socialActivities", "Social activities"],
  ["accommodation", "Accommodation"],
  ["capacity", "Places"],
  ["shortLabel", "Name"],
  ["kind", "Kind"],
];

/** The long ones are written as sentences, in a box that grows. */
export const COURSE_LONG_FIELDS = new Set(["meetingPoint", "food", "socialActivities", "accommodation", "location"]);

/** The mark beside each kind of proposal, so a list of them reads at a glance. */
export const TOOL_ICON: Record<CrmProposal["tool"], LucideIcon> = {
  log_interaction: StickyNote,
  advance_status: Flag,
  set_next_step: ListChecks,
  add_contact: UserPlus,
  set_logo: ImageIcon,
  create_record: Building2,
  update_record: PencilLine,
  create_task: ListChecks,
  create_meeting: CalendarPlus,
  update_meeting: CalendarClock,
  update_course: CalendarClock,
};

/**
 * An image URL with the image beside it, so the reader sees what the logo
 * will be before it is stored. Clearing the URL is "no logo".
 */
export function LogoField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const t = useMailT();
  const [broken, setBroken] = React.useState(false);
  const [site, setSite] = React.useState("");
  const [looking, setLooking] = React.useState(false);
  const [lookNote, setLookNote] = React.useState<string | null>(null);
  React.useEffect(() => setBroken(false), [url]);

  // "Not this one — look on cocoda.ch": the planner looks for a logo on
  // that site and the URL here becomes it. Nothing is stored yet.
  const look = async () => {
    const wanted = site.trim();
    if (!wanted || looking) return;
    setLooking(true);
    setLookNote(null);
    try {
      const answer = await mailApiJson<{ imageUrl: string | null; note?: string }>(
        "/api/mail/crm-find-logo",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: wanted }) }
      );
      if (answer.imageUrl) {
        onChange(answer.imageUrl);
        setSite("");
      } else {
        setLookNote(answer.note ?? `Nothing found on ${wanted}.`);
      }
    } catch (err) {
      setLookNote(err instanceof Error ? err.message : "Couldn't look.");
    } finally {
      setLooking(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white">
        {url && !broken ? (
          <img
            src={url}
            alt=""
            className="max-h-full max-w-full object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="text-[10px] text-stone-400">{url ? "?" : "none"}</span>
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1">
          <input
            className={bareFieldClass}
            aria-label={t("imageUrl")}
            placeholder={t("imageUrl")}
            value={url}
            onChange={(e) => onChange(e.target.value)}
          />
          {url ? (
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              aria-label={t("noLogo")}
              title={t("noLogo")}
              onClick={() => onChange("")}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-1.5 text-xs text-stone-500">
          <span className="shrink-0">{t("wrongOneLookOn")}</span>
          <input
            className={cn(
              chipClass,
              "w-48 cursor-text text-stone-800 placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-0"
            )}
            placeholder="their website, e.g. cocoda.ch"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void look();
              }
            }}
          />
          <button
            type="button"
            className={cn(chipClass, site.trim() && !looking && chipSetClass, "disabled:opacity-50")}
            disabled={!site.trim() || looking}
            onClick={() => void look()}
          >
            {looking ? "Looking…" : "Look"}
          </button>
        </div>
        {lookNote ? <p className="px-1.5 text-xs text-stone-500">{lookNote}</p> : null}
      </div>
    </div>
  );
}

/** How a candidate was found, said with what found it: "christian@… in the thread". */
export function viaLabel(c: CrmCandidate): string {
  switch (c.via) {
    case "participant":
      return `${c.match} in the thread`;
    case "body":
      return `${c.match} in the text`;
    case "domain":
      return `${c.match} by its domain`;
    // Named in the thread, and named by the reader. Both existed in the
    // proposer and neither had a line here, so a record found either way
    // was shown with nothing under it.
    case "name":
      return `“${c.match}” in the thread`;
    case "reader":
      return "you asked for this record";
    case "model":
      return `the AI read “${c.match}”`;
  }
}

/** A record as a chip: logo or initial, name, table. Same look as the planner's pickers. */
/** The tab a table shows on: grants are what the Applications tab holds. */
function sourceLabel(source: string): string {
  return source === "grants" ? "applications" : source;
}

export function RecordChip({ candidate, name, source }: { candidate?: CrmCandidate; name: string; source: string }) {
  // A logo that does not load falls back to the initial, not to the
  // webview's broken-image mark.
  const [logoFailed, setLogoFailed] = React.useState(false);
  React.useEffect(() => setLogoFailed(false), [candidate?.logoUrl]);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {candidate?.logoUrl && !logoFailed ? (
        <img
          src={candidate.logoUrl}
          alt=""
          className="h-5 w-5 shrink-0 rounded object-contain"
          draggable={false}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-stone-200 text-[10px] font-medium text-stone-600">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 truncate font-medium text-stone-900">{name}</span>
      <span className="shrink-0 text-xs text-stone-400">{sourceLabel(source)}</span>
    </span>
  );
}

/**
 * A value picked from the ones we hold, with the picture that names it.
 *
 * Two columns want this and want it slightly differently. A facilitator's
 * Organisation is plain text — the crest beside it in the table is the
 * client record's, found by that name — so the box has to take anything,
 * and offer what we already hold or the same organisation ends up in the
 * CRM twice under two spellings. A Course is one of a list the table keeps,
 * and typing into it can only produce a key that matches nothing.
 *
 * Either way the logo shows in the closed box and not only in the list.
 * "Oxford 2026 Sept 29–1 Oct" beside Linacre's crest is a course the reader
 * recognises; the same words in a bare box are a sentence the model wrote,
 * and there was no way to tell one from the other.
 */
function PickerField({
  value,
  options,
  allowNew = false,
  onChange,
}: {
  value: string;
  options: { value: string; logo?: string }[];
  /** True where anything may be typed: the column is free text. */
  allowNew?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const needle = value.trim().toLowerCase();
  const held = options.find((o) => o.value.toLowerCase() === needle);
  const shown = (
    needle && allowNew
      ? options.filter((o) => o.value.toLowerCase().includes(needle))
      : options
  ).slice(0, allowNew ? 8 : 20);

  const logo = held?.logo ? (
    <img
      src={held.logo}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
    />
  ) : null;

  return (
    <div ref={boxRef} className="relative">
      {allowNew ? (
        <div className="flex items-center gap-1.5 rounded-md px-1.5 hover:bg-stone-100 focus-within:bg-white focus-within:ring-1 focus-within:ring-teal-600">
          {logo}
          <input
            className="w-full min-w-0 border-0 bg-transparent py-1 text-sm text-stone-900 shadow-none outline-none focus:ring-0"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </div>
      ) : (
        /* A list and nothing else: what is typed here could only be a key
           that matches no course. */
        <button
          type="button"
          className={cn(bareFieldClass, "flex items-center gap-1.5 text-left")}
          onClick={() => setOpen((v) => !v)}
        >
          {logo}
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-stone-400")}>
            {value || "—"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
        </button>
      )}
      {open && shown.length ? (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg">
          {shown.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100",
                  held?.value === o.value && "bg-stone-100"
                )}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.logo ? (
                  <img
                    src={o.logo}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-contain"
                  />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{o.value}</span>
                {held?.value === o.value ? (
                  <Check className="h-4 w-4 shrink-0 text-stone-800" strokeWidth={2.5} aria-hidden />
                ) : null}
              </button>
            </li>
          ))}
          {allowNew && needle && !held ? (
            <li className="px-2.5 py-1.5 text-xs text-stone-500">
              {`Or keep “${value.trim()}” as a new one.`}
            </li>
          ) : null}
          {/* The model wrote something the list does not have. Shown, so the
              reader can see what they are replacing rather than a blank. */}
          {!allowNew && value && !held ? (
            <li className="px-2.5 py-1.5 text-xs text-stone-500">
              {`“${value}” is not one of these yet.`}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One column of a proposed create or update: the right control for it.
 *
 * A column with a list of values gets that list. A column that names an
 * organisation gets the ones we hold, and still takes a new name. Anything
 * else is a box, which is all the table can say about it.
 */
export function FieldValue({
  column,
  value,
  choices,
  organisations,
  onChange,
}: {
  column: string;
  value: string;
  choices?: { value: string; logo?: string }[];
  organisations: { name: string; logo?: string }[];
  onChange: (value: string) => void;
}) {
  if (choices?.length) {
    return <PickerField value={value} options={choices} onChange={onChange} />;
  }
  if (namesAnOrganisation(column) && organisations.length) {
    return (
      <PickerField
        value={value}
        options={organisations.map((o) => ({ value: o.name, logo: o.logo }))}
        allowNew
        onChange={onChange}
      />
    );
  }
  return (
    <input
      className={bareFieldClass}
      aria-label={column}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The column that names an organisation, whichever table it is on. */
function namesAnOrganisation(column: string): boolean {
  return column.trim().toLowerCase() === "organisation";
}

/** Today where the reader is, for a note the model gave no date. */
export function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
