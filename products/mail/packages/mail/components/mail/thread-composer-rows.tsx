"use client";

/*
 * The fields of a reply or a forward with its recipients open, as rows at
 * the top of the card: To, then Cc and Bcc when they are shown, then the
 * subject when there is one. Each row is a label and its field, with what
 * belongs to the row at its right end.
 *
 * They were boxes of their own above the card, four of them and a line of
 * "Add Cc", and took more room than the message did. Now:
 *
 * - On a forward, Cc and Bcc are buttons at the end of the To row until
 *   asked for. A reply shows its Cc row at once (most replies keep somebody
 *   on copy), with Bcc at its end.
 * - From goes at the end of the Subject row when there is one, else at the
 *   end of the Cc row, else of the To row: the last row of the head.
 * - The rows scroll away with the message; Send stays at the bottom.
 */

import * as React from "react";

import { FromAccountMenu } from "@/components/mail/FromAccountMenu";
import { RecipientCarryProvider, RecipientField } from "@/components/mail/RecipientField";
import type { ThreadPaneModel } from "@/components/mail/use-thread-pane";
import { cn } from "@/lib/utils";

const ROW = "flex items-start gap-2 border-b border-stone-200/80 px-3 py-1.5";
/**
 * The labels' column. As wide as "Subject" only while the subject row is
 * there: for To, Cc and Bcc alone it left a wide gap before the first chip.
 */
const LABEL = "shrink-0 pt-[3px] text-[15px] text-stone-500";
const labelWidth = (subjectShown: boolean) => (subjectShown ? "w-16" : "w-9");
const LINK = "shrink-0 text-[15px] text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline";

export function ComposerFieldRows({ m }: { m: ThreadPaneModel }) {
  const {
    account,
    accounts,
    ccList,
    composer,
    forwardSubject,
    forwarding,
    fromAccount,
    recipientInputRef,
    ccInputRef,
    replySubject,
    setCcList,
    setFromAccount,
    setShowCc,
    setSubjectDraft,
    setToList,
    showCc,
    subjectDraft,
    subjectOpen,
    t,
    toList,
  } = m;
  const { bccList, showBcc, setBccList, setShowBcc } = composer;
  const ccShown = !forwarding || showCc || ccList.length > 0;
  const bccShown = showBcc || bccList.length > 0;
  const subjectShown = forwarding || subjectOpen;
  const fromOn = subjectShown ? "subject" : ccShown ? "cc" : "to";

  const from = (
    <span className="flex shrink-0 items-baseline gap-1.5 text-[15px] text-stone-500">
      from
      {accounts.length > 1 ? (
        <FromAccountMenu
          value={fromAccount}
          accounts={accounts}
          onChange={setFromAccount}
          triggerClassName="text-[15px] font-semibold text-stone-800"
        />
      ) : (
        <span className="font-semibold text-stone-800">{account}</span>
      )}
    </span>
  );
  /*
    Cc and Bcc were clicked to add somebody, so the new box takes the
    cursor. It is drawn on the next frame, so it is focused after that.
    Before, the field appeared and the cursor stayed where it was.
  */
  const bccInputRef = React.useRef<HTMLInputElement>(null);
  const focusSoon = (ref: React.RefObject<HTMLInputElement | null>) =>
    requestAnimationFrame(() => requestAnimationFrame(() => ref.current?.focus()));
  const bccButton = bccShown ? null : (
    <button
      type="button"
      className={LINK}
      onClick={() => {
        setShowBcc(true);
        focusSoon(bccInputRef);
      }}
    >
      {t("fieldBcc")}
    </button>
  );
  /** What stands at the right end of a row, with a rule between two. */
  const end = (...parts: React.ReactNode[]) => {
    const shown = parts.filter(Boolean);
    if (!shown.length) return undefined;
    return (
      <span className="flex items-baseline gap-3">
        {shown.map((part, i) => (
          <React.Fragment key={i}>
            {i ? <span aria-hidden className="h-4 w-px self-center bg-stone-200" /> : null}
            {part}
          </React.Fragment>
        ))}
      </span>
    );
  };
  const field = (
    label: string,
    values: typeof toList,
    onChange: (next: typeof toList) => void,
    placeholder: string,
    actions?: React.ReactNode,
    extra?: { inputRef?: typeof recipientInputRef; allowSaveList?: boolean }
  ) => (
    <div className={ROW}>
      <span className={cn(LABEL, labelWidth(subjectShown))}>{label}</span>
      <RecipientField
        label={label}
        variant="inline"
        values={values}
        onChange={onChange}
        collapseAfter={6}
        ownAccounts={accounts}
        directoryAccount={fromAccount}
        placeholder={placeholder}
        actions={actions}
        inputRef={extra?.inputRef}
        allowSaveList={extra?.allowSaveList}
      />
    </div>
  );

  return (
    // The provider is what lets a chip be dragged from To to Cc.
    <RecipientCarryProvider>
      <div className="mail-composer-rows">
        {field(
          t("fieldTo"),
          toList,
          setToList,
          forwarding ? "name@example.com, second@example.com" : t("addRecipient"),
          end(
            ccShown ? null : (
              <span className="flex items-baseline gap-3">
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setShowCc(true);
                    focusSoon(ccInputRef);
                  }}
                >
                  Cc
                </button>
                {bccButton}
              </span>
            ),
            fromOn === "to" ? from : null
          ),
          { inputRef: recipientInputRef, allowSaveList: true }
        )}
        {ccShown
          ? field(t("fieldCc"), ccList, setCcList, t("addRecipient"), end(bccButton, fromOn === "cc" ? from : null), {
              inputRef: ccInputRef,
            })
          : null}
        {bccShown
          ? field(t("fieldBcc"), bccList, setBccList, t("addRecipient"), undefined, { inputRef: bccInputRef })
          : null}
        {subjectShown ? (
          <label className={cn(ROW, "items-baseline")}>
            <span className={cn(LABEL, labelWidth(subjectShown))}>{t("fieldSubject")}</span>
            <span className="min-w-0 flex-1">
              <input
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                placeholder={forwarding ? forwardSubject : replySubject}
                autoFocus={subjectOpen && !forwarding}
                className="w-full bg-transparent py-0.5 text-[15px] text-stone-800 outline-none placeholder:text-stone-400"
              />
              {/* Said where it is done. A forward starts its own
                  conversation whatever it is called. */}
              {!forwarding ? (
                <span className="block pb-0.5 text-xs text-stone-500">{t("newSubjectStartsConversation")}</span>
              ) : null}
            </span>
            {fromOn === "subject" ? from : null}
          </label>
        ) : null}
      </div>
    </RecipientCarryProvider>
  );
}
