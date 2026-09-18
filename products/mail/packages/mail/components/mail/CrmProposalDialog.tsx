"use client";

import * as React from "react";
import {
  Building2,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  Flag,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  StickyNote,
  Table2,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  SettingsDialog,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import { mailApiJson } from "@/lib/mail/api";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { showPlannerRecord } from "@/lib/native-shell";
import { meetingWhenLabel } from "@/lib/mail/date-format";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import {
  CardHeading,
  CardLine,
  CardText,
  ChipField,
  ChipMenu,
  ChipRow,
  PersonLine,
  PropertyList,
  PropertyRow,
  ProposalCard,
  bareFieldClass,
  chipClass,
  chipIconClass,
  chipInputClass,
  chipSetClass,
} from "@/components/mail/ProposalCardParts";
import {
  TaskProposalFields,
  type TaskListChoice,
  type TaskPersonChoice,
} from "@/components/mail/TaskProposalFields";

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

type Row = { proposal: CrmProposal; checked: boolean; input: Record<string, unknown> };

/**
 * The zones a meeting is agreed in around here, the configured one first
 * in the picker. Anything else arrives from the model or the thread and
 * joins the list by being the chosen value.
 */
const MEETING_TIME_ZONES = [
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

const TOOL_LABEL: Record<CrmProposal["tool"], string> = {
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

/** A course change's fields, as the course form names them, in the form's order. */
const COURSE_FIELD_LABELS: [string, string][] = [
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
const COURSE_LONG_FIELDS = new Set(["meetingPoint", "food", "socialActivities", "accommodation", "location"]);

/** The mark beside each kind of proposal, so a list of them reads at a glance. */
const TOOL_ICON: Record<CrmProposal["tool"], LucideIcon> = {
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
function LogoField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
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
          // eslint-disable-next-line @next/next/no-img-element
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
function viaLabel(c: CrmCandidate): string {
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

function RecordChip({ candidate, name, source }: { candidate?: CrmCandidate; name: string; source: string }) {
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
    // eslint-disable-next-line @next/next/no-img-element
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
                  // eslint-disable-next-line @next/next/no-img-element
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
function FieldValue({
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
function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function CrmProposalDialog({
  loading,
  stage,
  result,
  attachmentCount = 0,
  attachmentsIncluded = false,
  onIncludeAttachments,
  onClose,
  onApplied,
}: {
  loading: boolean;
  /** What is happening right now, when it is not the model: "Reading x.pdf…". */
  stage?: string;
  result: CrmProposeResult | null;
  /** PDFs in the thread the AI could read, if the reader says so. */
  attachmentCount?: number;
  /** True when this result already had them. */
  attachmentsIncluded?: boolean;
  /** Run again with the attachments' text. */
  onIncludeAttachments?: () => void;
  onClose: () => void;
  /**
   * Called after Apply, with how many proposals went through and whether
   * the reader asked for the thread to be filed away afterwards.
   */
  onApplied: (applied: number, options: { archive: boolean }) => void;
}) {
  const t = useMailT();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [applying, setApplying] = React.useState(false);
  /**
   * File the thread away once the changes are in.
   *
   * On by default: reading a thread, telling the AI what it changed and
   * approving that is the whole of the work the message asked for, and a
   * message whose work is done belongs out of the inbox. Untick it for the
   * thread that is still waiting on a reply.
   */
  const [archiveAfter, setArchiveAfter] = React.useState(true);

  // How long the model has been at it. A number that moves is the
  // difference between "working" and "stuck".
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  React.useEffect(() => {
    setRows(
      (result?.proposals ?? []).map((proposal) => ({
        proposal,
        // A meeting sends mail to other people. It waits for a deliberate tick.
        // Both of these mail people at once — they start unticked, so
        // sending is always something the reader did on purpose.
        checked:
          proposal.tool !== "create_meeting" &&
          proposal.tool !== "update_meeting",
        input: { ...proposal.input },
      }))
    );
  }, [result]);

  const setInput = (id: string, patch: Record<string, unknown>) =>
    setRows((prev) =>
      prev.map((r) => (r.proposal.id === id ? { ...r, input: { ...r.input, ...patch } } : r))
    );
  const setChecked = (id: string, checked: boolean) =>
    setRows((prev) => prev.map((r) => (r.proposal.id === id ? { ...r, checked } : r)));

  const candidates = result?.candidates ?? [];
  /** Sent only when a proposal names an organisation — see the picker. */
  const organisations = result?.organisations ?? [];
  /** The values one column of one table accepts, when it accepts only some. */
  const choicesFor = (source: string, column: string) =>
    result?.fieldChoices?.find(
      (c) =>
        c.source === source &&
        c.column.trim().toLowerCase() === column.trim().toLowerCase()
    )?.options;
  const recordName = (id: unknown) =>
    candidates.find((c) => c.recordId === id)?.recordName ?? "(record)";

  const apply = async () => {
    const chosen = rows.filter((r) => r.checked);
    if (!chosen.length) return;
    setApplying(true);
    try {
      const json = await mailApiJson<{
        results: { id: string; tool: string; ok: boolean; error?: string }[];
      }>("/api/mail/crm-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: chosen.map((r) => ({
            id: r.proposal.id,
            tool: r.proposal.tool,
            input: r.input,
          })),
        }),
      });
      const failed = json.results.filter((r) => !r.ok);
      const applied = json.results.length - failed.length;
      if (applied) {
        // Every record the applied changes touched, by table: the ones the
        // proposals named and the ones a create made. View opens the table
        // with the most of them, showing those rows.
        const okIds = new Set(json.results.filter((r) => r.ok).map((r) => r.id));
        const bySource = new Map<string, string[]>();
        const touch = (source: string, recordId: string) => {
          if (!source || !recordId) return;
          const ids = bySource.get(source) ?? [];
          if (!ids.includes(recordId)) ids.push(recordId);
          bySource.set(source, ids);
        };
        for (const r of chosen) {
          if (okIds.has(r.proposal.id) && "recordId" in r.input) {
            touch(str(r.input.source), str(r.input.recordId));
          }
        }
        for (const r of json.results) {
          if (!r.ok || r.tool !== "create_record") continue;
          const made = (r as { result?: { record?: { source?: string; id?: string } } }).result?.record;
          if (made?.id) touch(str(made.source), made.id);
        }
        const [best] = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
        const target = best ? { source: best[0], recordId: best[1].join(",") } : null;
        const others = bySource.size > 1 ? bySource.size - 1 : 0;
        toast.success(applied === 1 ? "CRM updated" : `CRM updated: ${applied} changes`, {
          ...(others ? { description: `Also in ${others} other table${others > 1 ? "s" : ""}.` } : {}),
          ...(target
            ? {
                action: {
                  label: "View",
                  onClick: () => {
                    void showPlannerRecord(target).then((shown) => {
                      if (!shown) toast.info(mailSay("openPlannerToSee"));
                    });
                  },
                },
              }
            : {}),
        });
      }
      for (const f of failed) {
        toast.error(`${TOOL_LABEL[f.tool as CrmProposal["tool"]] ?? f.tool}: ${f.error ?? "failed"}`);
      }
      onApplied(applied, { archive: archiveAfter });
      if (!failed.length) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply");
    } finally {
      setApplying(false);
    }
  };

  const recordPicker = (row: Row) => {
    if (!("recordId" in row.input)) return null;
    // One candidate: the subtitle names it, and every row is about it.
    // Saying it again on each row is noise.
    if (candidates.length < 2 && candidates[0]?.recordId === row.input.recordId) return null;
    const current = candidates.find((c) => c.recordId === row.input.recordId);
    const chip = (
      <RecordChip
        candidate={current}
        name={current?.recordName ?? recordName(row.input.recordId)}
        source={str(row.input.source)}
      />
    );
    // One candidate: nothing to pick. More: the record is a chip that opens
    // the candidates, each with its logo, as the other chips open theirs.
    if (candidates.length < 2) return chip;
    return (
      <ChipMenu
        label={t("record")}
        value={str(row.input.recordId)}
        display={chip}
        className="h-7 max-w-full px-1.5"
        menuWidth="w-72"
        options={candidates.map((c) => ({
          value: c.recordId,
          label: c.recordName,
          render: <RecordChip candidate={c} name={c.recordName} source={c.source} />,
        }))}
        onPick={(recordId) => {
          const c = candidates.find((x) => x.recordId === recordId);
          setInput(row.proposal.id, { recordId, ...(c ? { source: c.source } : {}) });
        }}
      />
    );
  };

  /** Names for the parts of a person line, in the reader's language. */
  const personLabels = {
    name: t("fieldName"),
    email: t("fieldEmail"),
    title: t("fieldJobTitle"),
    remove: t("removeThisPerson"),
  };

  /** The zones a meeting's time can be on: the proposal's, the diary's, the usual ones. */
  const zoneOptions = (row: Row) =>
    [
      ...new Set(
        [str(row.input.timeZone), result?.meetingTarget?.timeZone ?? "", ...MEETING_TIME_ZONES].filter(Boolean)
      ),
    ].map((zone) => ({ value: zone, label: zone }));

  /**
   * When a meeting starts, how long it is, and on whose clock: a chip each.
   *
   * Whose clock matters. The model writes the start on the clock the thread
   * agreed in, and a 9am agreed "UK time" sent on the Copenhagen
   * configuration went out an hour early while the reader could not see it.
   */
  const meetingTimeChips = (row: Row) => {
    const id = row.proposal.id;
    return (
      <>
        <ChipField icon={<CalendarClock className={chipIconClass} aria-hidden />} title={t("crmStart")}>
          <input
            type="datetime-local"
            aria-label={t("crmStart")}
            className={chipInputClass}
            value={str(row.input.start).slice(0, 16)}
            onChange={(e) => setInput(id, { start: e.target.value })}
          />
        </ChipField>
        {/* The unit beside the number: a length on its own is a number with
            no idea attached. The line under the chips says what they come to. */}
        <ChipField icon={<Clock className={chipIconClass} aria-hidden />} title={t("minutes")}>
          <input
            type="number"
            min={5}
            step={5}
            aria-label={t("minutes")}
            className={cn(chipInputClass, "w-9 text-right")}
            value={Number(row.input.durationMinutes ?? 30)}
            onChange={(e) => setInput(id, { durationMinutes: Number(e.target.value) })}
          />
          <span className="font-normal text-stone-500">{t("minutes")}</span>
        </ChipField>
        {result?.meetingTarget ? (
          <ChipMenu
            icon={<Globe className={chipIconClass} aria-hidden />}
            label={t("fieldTimeZone")}
            value={str(row.input.timeZone) || result.meetingTarget.timeZone}
            options={zoneOptions(row)}
            onPick={(zone) => setInput(id, { timeZone: zone })}
          />
        ) : null}
      </>
    );
  };

  /** What the chips come to, in words: "Tue 22 Sept, 09:00–09:30 · Europe/London". */
  const meetingWhenLine = (row: Row, extra?: string) => {
    if (!str(row.input.start)) return null;
    const zone = str(row.input.timeZone) || result?.meetingTarget?.timeZone || "";
    return (
      <p className="mt-2 text-xs text-stone-500">
        {meetingWhenLabel(str(row.input.start), Number(row.input.durationMinutes ?? 30))}
        {zone ? ` · ${zone}` : ""}
        {extra ? ` · ${extra}` : ""}
      </p>
    );
  };

  const fields = (row: Row) => {
    const { tool } = row.proposal;
    const id = row.proposal.id;
    switch (tool) {
      case "log_interaction":
        return (
          <ProposalCard>
            <CardText
              ariaLabel={t("crmNoteText")}
              value={str(row.input.summary)}
              onChange={(summary) => setInput(id, { summary })}
            />
            {/*
              A note goes into Notes under a date, newest at the top, and
              the date is the newest message in the thread rather than the
              day the reader got round to filing it — which is right, and
              was invisible until it had been applied. A thread read a
              fortnight late files under the fortnight-old exchange.
            */}
            <ChipRow>
              <ChipField icon={<Calendar className={chipIconClass} aria-hidden />} title={t("notedOn")}>
                <span className="font-normal text-stone-500">{t("notedOn")}</span>
                <input
                  type="date"
                  aria-label={t("notedOn")}
                  className={chipInputClass}
                  value={str(row.input.date) || todayIsoDate()}
                  onChange={(e) => setInput(id, { date: e.target.value })}
                />
              </ChipField>
            </ChipRow>
          </ProposalCard>
        );
      case "set_next_step":
        return (
          <ProposalCard className="py-2.5">
            <CardText
              ariaLabel={t("nextStep")}
              value={str(row.input.nextStep)}
              onChange={(nextStep) => setInput(id, { nextStep })}
            />
          </ProposalCard>
        );
      case "advance_status": {
        const options = result?.statusOptions[str(row.input.source)] ?? [];
        const toStatus = str(row.input.toStatus);
        // A status on its own is one choice: a chip, with no card round it.
        return (
          <ChipRow className="mt-0">
            <ChipMenu
              icon={<Flag className={chipIconClass} aria-hidden />}
              label={t("status")}
              value={toStatus}
              menuWidth="w-64"
              options={[...options, ...(toStatus && !options.includes(toStatus) ? [toStatus] : [])].map(
                (o) => ({ value: o, label: o })
              )}
              onPick={(next) => setInput(id, { toStatus: next })}
            />
          </ChipRow>
        );
      }
      case "add_contact":
        // The job title only when the thread said one — a signature, usually.
        // A blank box for it on every proposal is a third of the line asking
        // a question the thread has already failed to answer.
        return (
          <ProposalCard className="py-1.5">
            <PersonLine
              name={str(row.input.name)}
              email={str(row.input.email)}
              title={row.input.title === undefined ? undefined : str(row.input.title)}
              labels={personLabels}
              onChange={(patch) => setInput(id, patch)}
            />
          </ProposalCard>
        );
      case "update_record": {
        // Everything it would write is on show and editable: this is the one
        // proposal that can go over something already there, and the reader
        // is the one who decides that it should.
        const extra =
          row.input.fields && typeof row.input.fields === "object"
            ? Object.entries(row.input.fields as Record<string, unknown>)
            : [];
        const setField = (key: string, value: string) =>
          setInput(id, { fields: { ...(row.input.fields as object), [key]: value } });
        return (
          <ProposalCard className="py-1.5">
            <PropertyList first>
              {row.input.name !== undefined ? (
                <PropertyRow label={t("fieldName")}>
                  <input
                    className={bareFieldClass}
                    aria-label={t("fieldName")}
                    value={str(row.input.name)}
                    onChange={(e) => setInput(id, { name: e.target.value })}
                  />
                </PropertyRow>
              ) : null}
              {extra.map(([key, value]) => (
                <PropertyRow key={key} label={key}>
                  <FieldValue
                    column={key}
                    value={str(value)}
                    choices={choicesFor(str(row.input.source), key)}
                    organisations={organisations}
                    onChange={(next) => setField(key, next)}
                  />
                </PropertyRow>
              ))}
            </PropertyList>
          </ProposalCard>
        );
      }
      case "set_logo":
        return (
          <ProposalCard className="py-2.5">
            <LogoField
              url={str(row.input.imageUrl)}
              onChange={(url) => setInput(id, { imageUrl: url })}
            />
          </ProposalCard>
        );
      case "create_record": {
        // Everything the create writes is on show: a hidden field is a
        // write the reader never saw.
        const source = str(row.input.source);
        const options = result?.statusOptions[source] ?? [];
        const status = str(row.input.status);
        const contacts = Array.isArray(row.input.contacts)
          ? (row.input.contacts as { email?: string; name?: string; title?: string }[])
          : [];
        const extra =
          row.input.fields && typeof row.input.fields === "object"
            ? Object.entries(row.input.fields as Record<string, unknown>)
            : [];
        const setContact = (i: number, patch: Record<string, string | undefined>) => {
          const next = contacts.map((c, j) => (j === i ? { ...c, ...patch } : c));
          setInput(id, { contacts: next });
        };
        const removeContact = (i: number) =>
          setInput(id, { contacts: contacts.filter((_, j) => j !== i) });
        const setField = (key: string, value: string) =>
          setInput(id, { fields: { ...(row.input.fields as object), [key]: value } });
        /*
          A facilitator is a person on a course, so the course is always a
          row — filled or not.

          Left out, it said nothing about where this person would appear,
          and "no course" read exactly like "the model did not say". Drawn
          empty it says which: nobody has chosen one yet, and the reader
          can, from the same list the Facilitators tab uses.
        */
        const columns =
          source === "facilitators" &&
          !extra.some(([key]) => key.trim().toLowerCase() === "course")
            ? [...extra, ["Course", ""] as [string, unknown]]
            : extra;
        return (
          <ProposalCard>
            <CardLine
              strong
              ariaLabel={t("fieldName")}
              placeholder={t("fieldName")}
              value={str(row.input.name)}
              onChange={(name) => setInput(id, { name })}
            />
            {row.input.note !== undefined ? (
              <CardText
                className="mt-1"
                ariaLabel={t("crmNoteText")}
                value={str(row.input.note)}
                onChange={(note) => setInput(id, { note })}
              />
            ) : null}
            <ChipRow>
              <ChipMenu
                icon={<Table2 className={chipIconClass} aria-hidden />}
                label={t("crmTable")}
                value={source}
                options={["clients", "collaborations", "facilitators"].map((s) => ({
                  value: s,
                  label: s,
                }))}
                onPick={(next) => setInput(id, { source: next })}
              />
              <ChipMenu
                icon={<Flag className={chipIconClass} aria-hidden />}
                label={t("status")}
                value={status}
                menuWidth="w-64"
                options={[
                  { value: "", label: t("noneDash") },
                  ...options.map((o) => ({ value: o, label: o })),
                  ...(status && !options.includes(status) ? [{ value: status, label: status }] : []),
                ]}
                onPick={(next) => setInput(id, { status: next || undefined })}
              />
            </ChipRow>
            {source !== "facilitators" || columns.length ? (
              <PropertyList>
                {source !== "facilitators" ? (
                  <PropertyRow label={t("nextStep")}>
                    <input
                      className={bareFieldClass}
                      aria-label={t("nextStep")}
                      value={str(row.input.nextStep)}
                      onChange={(e) => setInput(id, { nextStep: e.target.value })}
                    />
                  </PropertyRow>
                ) : null}
                {columns.map(([key, value]) => (
                  <PropertyRow key={key} label={key}>
                    <FieldValue
                      column={key}
                      value={str(value)}
                      choices={choicesFor(source, key)}
                      organisations={organisations}
                      onChange={(next) => setField(key, next)}
                    />
                  </PropertyRow>
                ))}
              </PropertyList>
            ) : null}
            {row.input.logoUrl !== undefined ? (
              <div className="mt-2.5 border-t border-stone-100 pt-2.5">
                <LogoField
                  url={str(row.input.logoUrl)}
                  onChange={(url) => setInput(id, { logoUrl: url || undefined })}
                />
              </div>
            ) : null}
            {contacts.length ? (
              <div className="mt-2.5 border-t border-stone-100 pt-2">
                <CardHeading>{t("peopleOnRecord")}</CardHeading>
                {contacts.map((c, i) => (
                  <PersonLine
                    key={i}
                    name={str(c.name)}
                    email={str(c.email)}
                    title={c.title === undefined ? undefined : str(c.title)}
                    labels={personLabels}
                    onChange={(patch) => setContact(i, patch)}
                    onRemove={() => removeContact(i)}
                  />
                ))}
              </div>
            ) : null}
          </ProposalCard>
        );
      }
      case "create_task":
        // Drawn the way To-Do draws a task being added: title, note, and
        // chips for the list and the people.
        return (
          <TaskProposalFields
            text={str(row.input.text)}
            note={str(row.input.note)}
            listId={str(row.input.listId)}
            assigneeIds={
              Array.isArray(row.input.assigneeIds) ? (row.input.assigneeIds as string[]) : []
            }
            lists={result?.taskLists ?? []}
            people={result?.taskPeople ?? []}
            onChange={(patch) => setInput(id, patch)}
          />
        );
      /*
        A meeting that has been sent, moving.

        No title, no invitees, no calendar: those stay as they are, and
        the whole of this is the new time. The meeting it names is shown
        rather than picked — the model chose it from the ones this
        thread's people are on, and a wrong one is a proposal to untick.
      */
      /*
        What the thread settled about a course: each field it changes, with
        what the course says now under it, so the reader sees what goes
        over what. Every value can be corrected before it is applied.
      */
      case "update_course": {
        const course = result?.courses?.find((c) => c.key === str(row.input.key));
        const present = COURSE_FIELD_LABELS.filter(([name]) => row.input[name] !== undefined);
        return (
          <ProposalCard className="py-1.5">
            <p className="pt-1 text-[15px] font-medium text-stone-900">
              {course?.title ?? str(row.input.key)}
            </p>
            <PropertyList>
              {present.map(([name, label]) => {
                const was = course?.current[name]?.trim();
                return (
                  <PropertyRow key={name} label={label}>
                    <div className="min-w-0 flex-1">
                      {COURSE_LONG_FIELDS.has(name) ? (
                        <CardText
                          ariaLabel={label}
                          value={str(row.input[name])}
                          onChange={(next) => setInput(id, { [name]: next })}
                        />
                      ) : (
                        <input
                          className={bareFieldClass}
                          aria-label={label}
                          value={str(row.input[name])}
                          onChange={(e) =>
                            setInput(id, {
                              // Places are a number to the tool; the box holds text.
                              [name]:
                                name === "capacity" && /^\d+$/.test(e.target.value)
                                  ? Number(e.target.value)
                                  : e.target.value,
                            })
                          }
                        />
                      )}
                      {was ? (
                        <p className="mt-0.5 truncate text-xs text-stone-400" title={was}>
                          Now: {was}
                        </p>
                      ) : null}
                    </div>
                  </PropertyRow>
                );
              })}
            </PropertyList>
          </ProposalCard>
        );
      }
      case "update_meeting": {
        const moving = result?.threadMeetings?.find(
          (m) => m.eventId === str(row.input.eventId)
        );
        return (
          <ProposalCard>
            {moving ? (
              <>
                <p className="text-[15px] font-medium text-stone-900">{moving.title}</p>
                <p className="text-xs text-stone-500">
                  {meetingWhenLabel(moving.start.slice(0, 16), 0)}
                  {moving.attendees.length ? ` · ${moving.attendees.join(", ")}` : ""}
                </p>
              </>
            ) : null}
            <ChipRow className={moving ? undefined : "mt-0"}>{meetingTimeChips(row)}</ChipRow>
            {meetingWhenLine(row)}
            <p className="mt-1 text-xs text-stone-500">{t("everyoneOnItIsTold")}</p>
          </ProposalCard>
        );
      }
      case "create_meeting": {
        const target = result?.meetingTarget;
        const emails = Array.isArray(row.input.attendeeEmails)
          ? (row.input.attendeeEmails as string[])
          : [];
        const location =
          row.input.location === undefined ? (target?.location ?? "") : str(row.input.location);
        return (
          <ProposalCard>
            <CardLine
              strong
              ariaLabel={t("fieldTitle")}
              placeholder={t("fieldTitle")}
              value={str(row.input.title)}
              onChange={(title) => setInput(id, { title })}
            />
            <ChipRow>
              {meetingTimeChips(row)}
              {/*
                Which diary, and where. Both come from the configuration and
                answer for nearly every meeting, and both are the reader's to
                change here: a lecture theatre instead of the standing room,
                a shared calendar instead of the blocked one. What is not
                shown cannot be corrected.
              */}
              {target ? (
                target.calendars?.length ? (
                  <ChipMenu
                    icon={<Calendar className={chipIconClass} aria-hidden />}
                    label={t("fieldCalendar")}
                    value={str(row.input.calendarName) || target.calendarName}
                    options={target.calendars.map((name) => ({ value: name, label: name }))}
                    onPick={(calendarName) => setInput(id, { calendarName })}
                  />
                ) : (
                  <span className={cn(chipClass, chipSetClass, "cursor-default")} title={t("fieldCalendar")}>
                    <Calendar className={chipIconClass} aria-hidden />
                    <span className="max-w-[12rem] truncate">{target.calendarName}</span>
                  </span>
                )
              ) : null}
              {target ? (
                <ChipField
                  icon={<MapPin className={chipIconClass} aria-hidden />}
                  title={t("fieldLocation")}
                  set={Boolean(location.trim())}
                >
                  <input
                    aria-label={t("fieldLocation")}
                    placeholder={t("fieldLocation")}
                    className={cn(chipInputClass, "w-40")}
                    value={location}
                    onChange={(e) => setInput(id, { location: e.target.value })}
                  />
                </ChipField>
              ) : null}
            </ChipRow>
            {meetingWhenLine(row, target?.accountEmail)}
            {/*
              Who is being invited, said as such and added to one at a time.
              A comma-separated line of addresses is a format to get right
              rather than a list of people, and it did not say what the
              addresses were for — an invitation goes to them.
            */}
            <div className="mt-2.5 border-t border-stone-100 pt-2">
              <CardHeading>{t("fieldInvitees")}</CardHeading>
              {emails.map((email, index, all) => (
                <PersonLine
                  key={index}
                  email={email}
                  labels={personLabels}
                  onChange={(patch) =>
                    setInput(id, {
                      attendeeEmails: all.map((v, i) => (i === index ? (patch.email ?? v) : v)),
                    })
                  }
                  onRemove={() =>
                    setInput(id, { attendeeEmails: all.filter((_, i) => i !== index) })
                  }
                />
              ))}
              <button
                type="button"
                className={cn(chipClass, "mt-1")}
                onClick={() => setInput(id, { attendeeEmails: [...emails, ""] })}
              >
                <Plus className={chipIconClass} aria-hidden />
                {t("addAnother")}
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">{t("invitationOnApply")}</p>
          </ProposalCard>
        );
      }
      default:
        return null;
    }
  };

  const chosen = rows.filter((r) => r.checked).length;

  // The team layer only. The public app never mounts this; if it did, it
  // would show nothing rather than offer a CRM it does not have.
  if (!mailUsesCrmPeople()) return null;

  return (
    <SettingsDialog
      title={t("updateCrmFromThread")}
      subtitle={
        loading && !result
          ? "Reading the thread and matching records…"
          : result?.error
            ? t("crmAskFailed")
            : candidates.length
              ? (
                  <span className="flex flex-col gap-1">
                    {candidates.slice(0, 3).map((c) => (
                      <span key={c.recordId} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                        <RecordChip candidate={c} name={c.recordName} source={c.source} />
                        <span className="text-stone-500">— {viaLabel(c)}</span>
                      </span>
                    ))}
                  </span>
                )
              : "No CRM record matches this thread."
      }
      onClose={onClose}
      width="w-[640px]"
      /* Carried by its heading: what these proposals are about is the thread
         underneath, and a reader checking a quoted line against it could
         only close the card and open it again. */
      draggable
      footer={
        <div className="flex items-center justify-end gap-2">
          {rows.length ? (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-stone-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-teal-700"
                checked={archiveAfter}
                onChange={(e) => setArchiveAfter(e.target.checked)}
              />
              {t("archiveAfterApplying")}
            </label>
          ) : null}
          {/*
            While the AI is working, this ends it — so it says so. "Close"
            over a spinner reads as "put this away and let it finish", which
            is what it used to do: the dialog went and the work carried on.
          */}
          <button type="button" className={settingsSecondaryButton} onClick={onClose}>
            {loading ? "Stop" : rows.length ? "Skip" : "Close"}
          </button>
          {rows.length ? (
            <button
              type="button"
              className={settingsPrimaryButton}
              disabled={applying || !chosen}
              onClick={() => void apply()}
            >
              {applying ? "Applying…" : chosen === 1 ? "Apply" : `Apply ${chosen}`}
            </button>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2 py-6 text-sm text-stone-500">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {stage
              ? stage
              : result
                ? `Asking the AI what changed… ${elapsed}s`
                : "Reading the thread and matching records…"}
          </div>
          {result?.candidates.length ? (
            <p className="text-xs text-stone-400">
              Matched {result.candidates.length === 1 ? "one record" : `${result.candidates.length} records`}
              ; the model reads the thread against{" "}
              {result.candidates.length === 1 ? "its" : "their"} status and notes and proposes
              changes.
            </p>
          ) : null}
        </div>
      ) : !rows.length ? (
        <div className="py-4 text-sm text-stone-600">
          <p>{result?.note ?? result?.error ?? mailSay("nothingToPropose")}</p>
          {result?.debug ? (
            <details className="mt-3 text-xs text-stone-400">
              <summary className="cursor-pointer">{t("whatTheAiSaw")}</summary>
              <p className="mt-1">
                {result.debug.messages.length} message
                {result.debug.messages.length === 1 ? "" : "s"} ·{" "}
                {result.debug.messages
                  .map((m) => `${m.own ? "us" : m.from}: ${m.sentToModel}/${m.chars} chars`)
                  .join(" · ")}{" "}
                · {result.debug.candidates} candidate record
                {result.debug.candidates === 1 ? "" : "s"}
              </p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2">
                {result.debug.modelAnswer}
              </pre>
            </details>
          ) : null}
        </div>
      ) : (
        <ul className="-mx-1 flex flex-col gap-4 py-1">
          {rows.map((row) => {
            const Icon = TOOL_ICON[row.proposal.tool];
            return (
              <li
                key={row.proposal.id}
                className={cn("px-1 transition-opacity", !row.checked && "opacity-55")}
              >
                {/* Only the box and its name tick the proposal. The whole row
                    used to be the label, so a click on the card round a field
                    ticked or unticked it without the reader meaning to. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-stone-300 accent-teal-700"
                      checked={row.checked}
                      onChange={(e) => setChecked(row.proposal.id, e.target.checked)}
                    />
                    <Icon className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                    <span className="font-semibold text-stone-900">
                      {TOOL_LABEL[row.proposal.tool]}
                    </span>
                  </label>
                  {recordPicker(row)}
                </div>
                <div className="mt-1.5 pl-6">
                  {fields(row)}
                  {row.proposal.why ? (
                    <p className="mt-1.5 text-xs text-stone-500">{row.proposal.why}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && attachmentCount > 0 && onIncludeAttachments ? (
        <p className="mt-3 text-xs text-stone-500">
          {attachmentsIncluded ? (
            <>Read with the {attachmentCount === 1 ? "attached PDF" : `${attachmentCount} attached PDFs`}.</>
          ) : (
            <>
              The thread has {attachmentCount === 1 ? "a PDF" : `${attachmentCount} PDFs`}.{" "}
              <button
                type="button"
                className="font-medium text-teal-700 underline-offset-2 hover:underline"
                onClick={onIncludeAttachments}
              >
                Read {attachmentCount === 1 ? "it" : "them"} too and ask again
              </button>{" "}
              — the text goes to the AI as background.
            </>
          )}
        </p>
      ) : null}
      {result?.dropped.length ? (
        <p className="mt-3 text-xs text-stone-400">
          {result.dropped.length} suggestion{result.dropped.length === 1 ? "" : "s"} did not pass
          the checks and {result.dropped.length === 1 ? "was" : "were"} left out.
        </p>
      ) : null}
    </SettingsDialog>
  );
}
