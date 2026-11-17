"use client";

/**
 * The small marks before the date of a list row, in one place for the
 * three forms of a row: the mailbox is hidden, who in the team has it, and
 * the arrow of a thread that the reader forwarded.
 */

import { HiddenAccountMark } from "@/components/mail/hidden-account-mark";
import { TeamRowMark } from "@/components/mail/team-layer";
import { ForwardedRowMark } from "@/components/mail/thread-forward-mark";

export function RowDateMarks({
  account,
  threadId,
  forwardedAt,
  repliedApartAt,
}: {
  account: string;
  threadId: string;
  forwardedAt?: string;
  repliedApartAt?: string;
}) {
  return (
    <>
      <HiddenAccountMark account={account} />
      <TeamRowMark account={account} threadId={threadId} />
      <ForwardedRowMark forwardedAt={forwardedAt} repliedApartAt={repliedApartAt} />
    </>
  );
}
