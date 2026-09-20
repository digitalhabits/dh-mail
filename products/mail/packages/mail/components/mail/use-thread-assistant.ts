"use client";

/*
 * The open thread's AI and CRM panel, off the pane component: the diary
 * proposal, the CRM proposal request, the AI reply draft with its notes
 * strip, and the chat style switch. ThreadPane hands in the thread and one
 * lever on the composer: a way to put new words in the box. What comes back
 * is the panel's state and the functions its buttons call.
 *
 * The per-send "update CRM notes" switch is not here. It belongs to the
 * message being written, so it lives with the composer's state — see
 * use-thread-composer.ts.
 *
 * The state lives here. The pane reads it, and writes only through what
 * this hook returns. New AI or CRM work for the open thread goes in this
 * file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiFetch, mailApiJson as apiJson } from "@/lib/mail/api";
import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { chatTitleFromCounterpart, type MailChatRef } from "@/lib/mail/chat-types";
import { proposeCrmFromThread } from "@/components/mail/CrmProposalHost";
import type { DiaryProposal } from "@/components/mail/DiaryEntriesDialog";
import type { AiReplyDraftResult } from "@/components/mail/AiReplyNotes";
import type { MailThreadDetail } from "@/lib/mail/types";
import { useMailT } from "@/lib/mail/i18n";

/** One PDF of the thread that the reader can give the AI as context. */
export type ReadableThreadAttachment = {
  messageId: string;
  filename: string;
  mimeType: string;
  attachmentId: string;
};

export function useThreadAssistant(input: {
  account: string;
  threadId: string;
  /** Null until the thread arrives. The functions that need it do nothing. */
  thread: MailThreadDetail | null;
  counterpartName: string;
  counterpartEmail: string;
  onChatPromoted: (chat: MailChatRef) => void;
  /** True while CrmProposalHost reads this thread — see useCrmProposing. */
  updatingCrm: boolean;
  readableAttachments: ReadableThreadAttachment[];
  /** The words in the reply box, as plain text. They are the AI's brief. */
  replyText: string;
  /** Put new words in the box, in a new editor — see useThreadComposer. */
  replaceWords: (html: string) => void;
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>;
}) {
  const {
    account,
    threadId,
    thread,
    counterpartName,
    counterpartEmail,
    onChatPromoted,
    updatingCrm,
    readableAttachments,
    replyText,
    replaceWords,
    setThread,
  } = input;
  const t = useMailT();

  const [chatStyleBusy, setChatStyleBusy] = React.useState(false);
  /*
    Up here with the rest, and not beside the function that uses them.

    A thread that has not arrived yet returns early — `if (!thread)` — so a
    hook declared below that line is called on the render after the thread
    lands and not on the one before it. React counts hooks, so the second
    render found more than the first and took the pane down with it. Every
    hook belongs above the first return; the handler can live where it reads
    best, because it is not one.
  */
  const [diaryBusy, setDiaryBusy] = React.useState(false);
  const [diaryProposal, setDiaryProposal] = React.useState<DiaryProposal | null>(
    null
  );
  /** An AI reply draft in flight, and the notes on the last one until dismissed. */
  const [draftingReply, setDraftingReply] = React.useState(false);
  const [aiReplyNotes, setAiReplyNotes] = React.useState<AiReplyDraftResult | null>(null);
  /** Which part of the draft is running, for the strip above the composer. */
  const [aiReplyWorking, setAiReplyWorking] = React.useState<"reading" | "writing" | null>(null);

  /**
   * The draft in flight, and the way to call it off.
   *
   * A model writing a reply takes tens of seconds, and a reader who pressed
   * the button by mistake — or read the thread again and changed their mind
   * — had nothing to press: the button that started it went grey and the
   * strip only spun. So the run is held, and stopping it puts the composer
   * back the way it was.
   *
   * Stopping is not failing. The reader asked for this one, so no error is
   * raised for it and nothing is said in red.
   */
  const aiReplyRun = React.useRef<AbortController | null>(null);

  const stopAiReply = React.useCallback(() => {
    aiReplyRun.current?.abort();
    aiReplyRun.current = null;
    // Said here rather than waited for: a transport that does not carry the
    // signal answers in its own time, and the reader who pressed Stop is
    // owed the box back now.
    setDraftingReply(false);
    setAiReplyWorking(null);
    setAiReplyNotes(null);
  }, []);

  const setChatStyle = async (noQuote: boolean) => {
    if (!thread) return;
    setChatStyleBusy(true);
    try {
      const json = await apiJson<{ chat: MailChatRef }>(
        "/api/mail/chat-style",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account,
            threadId,
            noQuote,
            title: counterpartName || chatTitleFromCounterpart(
              counterpartName,
              counterpartEmail
            ),
            subject: thread.subject,
            counterpartName,
            counterpartEmail: counterpartEmail || undefined,
            participantEmails: [
              ...new Set(
                [
                  counterpartEmail,
                  ...thread.reply.to,
                  ...thread.reply.allTo,
                ].filter(Boolean)
              ),
            ],
            messageCount: thread.messages.length,
          }),
        }
      );
      setThread((current) =>
        current ? { ...current, chat: json.chat } : current
      );
      onChatPromoted(json.chat);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't update chat style"
      );
    } finally {
      setChatStyleBusy(false);
    }
  };

  /*
    The thread, read for the reader's own diary.

    Nothing to do with the CRM: no record is touched and no invitation is
    sent. The entries come back and the dialog is where they are approved,
    which is the same bargain the CRM proposal makes — the AI says what it
    found, the reader says which of it is true.
  */
  const proposeDiaryFromThread = async (hint?: string) => {
    if (diaryBusy || !thread) return;
    setDiaryBusy(true);
    const reading = toast.loading(t("diaryReading"));
    try {
      const res = await mailApiFetch("/api/mail/diary-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, threadId: thread.threadId, hint }),
      });
      const json = (await res.json()) as DiaryProposal & { error?: string };
      if (!res.ok) throw new Error(json.error || t("couldNotReadDiary"));
      toast.dismiss(reading);
      setDiaryProposal({ entries: json.entries ?? [], target: json.target ?? null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotReadDiary"), {
        id: reading,
      });
    } finally {
      setDiaryBusy(false);
    }
  };

  /**
   * ✨: ask the planner what this thread changes, and show the proposals.
   * Nothing is written until the reader applies. The thread's participants,
   * the addresses in its text and, failing those, the AI's guess decide
   * which records it is about — so a forward from yourself works too.
   */
  const updateCrmFromThread = (hint?: string) => {
    if (updatingCrm) return;
    proposeCrmFromThread({
      account,
      threadId,
      hint,
      attachments: readableAttachments,
    });
  };

  /**
   * Draft this reply with the AI: the planner reads the thread, the CRM
   * records it matches and past mail with them, and answers a draft. The
   * draft replaces the box — after asking, if the reader had written
   * something — and the notes on it (what it drew on, what it did not know)
   * sit above the composer until dismissed. Nothing is stored or sent.
   */
  const draftReplyWithAi = async (hint: string) => {
    if (draftingReply || !threadId) return;
    /*
      What is already in the box is the brief.

      A reader who puts three bullets in and presses the button is saying
      what the reply has to say — so the notes go with the request and the
      draft writes them out. They used to be an obstacle: the button asked
      whether to throw them away, and then threw them away.

      Nothing is lost either way. The notes come back from the strip above
      the composer, which now holds them.
    */
    const notes = replyText.trim();
    const run = new AbortController();
    aiReplyRun.current?.abort();
    aiReplyRun.current = run;
    setDraftingReply(true);
    setAiReplyNotes(null);
    setAiReplyWorking("reading");
    try {
      // Two calls, as the CRM proposal does: the match is a second, the
      // model is the wait. The strip names the records it is drafting from
      // as soon as the first answers, so the spinner has something to say.
      // A match that fails costs only the label — the draft still runs.
      try {
        const matched = await apiJson<Partial<AiReplyDraftResult>>("/api/mail/reply-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, threadId, phase: "match" }),
          signal: run.signal,
        });
        if (run.signal.aborted) return;
        if (matched.scenario) {
          setAiReplyNotes({
            body: "",
            scenario: matched.scenario,
            usedRecords: matched.usedRecords ?? [],
            gaps: [],
          });
        }
      } catch {
        // Keep the plain "reading" line and go on to the draft.
      }
      if (run.signal.aborted) return;
      setAiReplyWorking("writing");
      const result = await apiJson<Partial<AiReplyDraftResult>>("/api/mail/reply-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          threadId,
          hint: hint || undefined,
          notes: notes || undefined,
        }),
        signal: run.signal,
      });
      // Called off while the model was writing: the draft that arrives now
      // belongs to nobody, and must not land in the box.
      if (run.signal.aborted) return;
      // A transport that does not know the path answers something empty
      // rather than failing; say so instead of crashing on the shape.
      if (typeof result.body !== "string" || !result.body.trim()) {
        throw new Error(t("aiReplyEmpty"));
      }
      // The editor takes its words from defaultValue when it mounts, so a
      // new draft means a new editor — the same way an imported provider
      // draft arrives. `replaceWords` makes one.
      replaceWords(plainTextToEditorHtml(result.body));
      setAiReplyNotes({
        body: result.body,
        ...(result.subject ? { subject: result.subject } : {}),
        scenario: result.scenario ?? "ongoing",
        usedRecords: result.usedRecords ?? [],
        gaps: result.gaps ?? [],
        // What the reader had written, so the strip can hand it back. A
        // draft written from notes is still a draft somebody may not want.
        ...(notes ? { brief: notes } : {}),
      });
    } catch (err) {
      // Stopped, not failed: the reader called it off, and has nothing to
      // read about a thing they asked to end.
      if (run.signal.aborted) return;
      // No half-written strip left over a composer that never got a draft.
      setAiReplyNotes(null);
      toast.error(
        `${t("aiReplyFailed")}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // Only the run that is still the current one clears the spinner. A
      // stopped run's own ending must not take down the one after it.
      if (aiReplyRun.current === run) {
        aiReplyRun.current = null;
        setDraftingReply(false);
        setAiReplyWorking(null);
      }
    }
  };

  /** The strip's "give me my notes back": the brief returns to the box. */
  const restoreAiReplyBrief = (brief: string) => {
    replaceWords(plainTextToEditorHtml(brief));
    setAiReplyNotes(null);
  };

  const dismissAiReplyNotes = () => setAiReplyNotes(null);
  const closeDiaryProposal = () => setDiaryProposal(null);

  return {
    chatStyleBusy,
    setChatStyle,
    diaryBusy,
    diaryProposal,
    closeDiaryProposal,
    proposeDiaryFromThread,
    updateCrmFromThread,
    draftingReply,
    aiReplyNotes,
    aiReplyWorking,
    stopAiReply,
    draftReplyWithAi,
    restoreAiReplyBrief,
    dismissAiReplyNotes,
  };
}
