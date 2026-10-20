"use client";

/**
 * Settings > General: the drafts folder (mail_native::drafts_inbox). Where
 * it is, and the instructions for a program that writes drafts into it, to
 * copy and give to that program. Only in the desktop app, which has the
 * folder.
 */

import * as React from "react";

import { SettingsRow } from "@/components/mail/settings-ui";
import { useMailT } from "@/lib/mail/i18n";

type Invoke = (cmd: string) => Promise<unknown>;

function instructions(path: string): string {
  return [
    "Digital Habits Mail has a drafts folder. To leave a draft in the person's Mail, write one JSON file per draft into:",
    path,
    "",
    "Write the file as <name>.json.part and then rename it to <name>.json: Mail reads only .json files.",
    "",
    "Fields:",
    '- "from": the mailbox it is from. It must be connected in Mail.',
    '- "to": a list of addresses. "cc" and "bcc" likewise, optional.',
    '- "subject": the subject of a new message.',
    '- "body": plain text; a blank line starts a new paragraph. Or "bodyHtml" for HTML.',
    '- "attachments": a list of absolute paths to files on this computer, 25 MB each at most. A file that cannot be read keeps the draft back.',
    '- "replyTo", for a reply in a Gmail thread: {"threadId": Gmail\'s thread id, "mode": "reply" or "replyAll"}. A reply also needs "to".',
    "",
    "Within a few seconds, while Mail is open, each file becomes a draft in Mail's Drafts. Mail never sends it: the person reads it and sends it.",
    "A file that could not be made into a draft is moved to not-made/ in the same folder, with the reason.",
    "",
    "Example:",
    JSON.stringify(
      { from: "you@example.org", to: ["someone@example.org"], subject: "Hello", body: "Hi,\n\nThe first paragraph.\n\nBest wishes" },
      null,
      2
    ),
  ].join("\n");
}

export function DraftsFolderSetting() {
  const t = useMailT();
  const [path, setPath] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"path" | "instructions" | null>(null);

  React.useEffect(() => {
    const invoke = (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
    if (!invoke) return;
    void invoke("drafts_inbox_path")
      .then((p) => setPath(typeof p === "string" ? p : null))
      .catch(() => {});
  }, []);

  if (!path) return null;
  const copy = (what: "path" | "instructions") => {
    void navigator.clipboard.writeText(what === "path" ? path : instructions(path)).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };
  const button =
    "rounded-inner border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50";
  return (
    <SettingsRow
      label={t("draftsFolder")}
      hint={t("draftsFolderHint")}
      control={
        <span className="flex shrink-0 gap-1.5">
          <button type="button" className={button} onClick={() => copy("path")}>
            {copied === "path" ? t("copied") : t("draftsFolderCopyPath")}
          </button>
          <button type="button" className={button} onClick={() => copy("instructions")}>
            {copied === "instructions" ? t("copied") : t("draftsFolderCopyInstructions")}
          </button>
        </span>
      }
    />
  );
}
