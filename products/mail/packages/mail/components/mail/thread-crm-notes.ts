"use client";

import { toast } from "@/lib/mail/toast";
import { mailSay } from "@/lib/mail/i18n";

/** Sonner toast for CRM notes LLM results (toolbar + after-send). */
export function toastCrmNotesResult(
  result: CrmNotesToastResult,
  options?: { toastId?: string | number; onApplied?: () => void }
): void {
  const toastId = options?.toastId;
  const changes = result.changes ?? [];
  const applied = changes.filter((c) => c.applied);
  const unchanged = changes.filter((c) => !c.applied);
  const context = crmNotesContextLine(result);

  if (result.skipped && !result.matched?.length && !changes.length) {
    toast.message(result.skipped, { id: toastId });
    return;
  }

  if (applied.length) {
    const changeLines = applied
      .map((c) => {
        const note =
          c.noteEntry.length > 220
            ? `${c.noteEntry.slice(0, 220)}…`
            : c.noteEntry;
        return `${c.recordName} (${crmSourceLabel(c.source)})\n→ Notes: ${note}\nWhy: ${c.rationale}`;
      })
      .join("\n\n");
    const description = [context, changeLines].filter(Boolean).join("\n\n");
    toast.success(
      applied.length === 1
        ? `Updated Notes on ${applied[0].recordName}`
        : `Updated Notes on ${applied.length} CRM records`,
      { id: toastId, description, duration: 14_000 }
    );
    options?.onApplied?.();
    return;
  }

  if (result.errors.length && !unchanged.length) {
    toast.error(result.errors[0] ?? "Couldn't update CRM notes", {
      id: toastId,
      description: context ?? undefined,
    });
    return;
  }

  const why =
    unchanged
      .map((c) => `${c.recordName}: ${c.rationale}`)
      .join("\n") ||
    result.skipped ||
    "Nothing new to add to Notes.";
  toast.message(mailSay("noCrmNoteChanges"), {
    id: toastId,
    description: [context, why].filter(Boolean).join("\n\n"),
    duration: 10_000,
  });
}

type CrmNotesToastResult = {
  updated: string[];
  matched?: { recordName: string; source: string }[];
  messageCount?: number;
  changes?: Array<{
    recordName: string;
    source: string;
    field: string;
    noteEntry: string;
    rationale: string;
    applied: boolean;
  }>;
  skipped?: string;
  errors: string[];
};
function crmSourceLabel(source: string): string {
  return CRM_SOURCE_LABELS[source] ?? source;
}
function crmNotesContextLine(result: CrmNotesToastResult): string | null {
  const parts: string[] = [];
  if (result.messageCount != null) {
    parts.push(
      `Reviewed ${result.messageCount} message${
        result.messageCount === 1 ? "" : "s"
      }`
    );
  }
  if (result.matched?.length) {
    parts.push(
      `matched ${result.matched
        .map((m) => `${m.recordName} (${crmSourceLabel(m.source)})`)
        .join(", ")}`
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

const CRM_SOURCE_LABELS: Record<string, string> = {
  clients: "Clients",
  collaborations: "Collaborations",
  facilitators: "Facilitators",
  grants: "Applications",
};
