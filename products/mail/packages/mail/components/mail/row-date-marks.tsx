"use client";

/**
 * The small marks before the date of a list row, in one place for the
 * three forms of a row: the mailbox is hidden, who in the team has it, the
 * team's comments on it, and the arrow of a thread that the reader forwarded.
 */

import { HiddenAccountMark } from "@/components/mail/hidden-account-mark";
import { TeamRowCommentMark, TeamRowMark } from "@/components/mail/team-layer";
import { ForwardedRowMark } from "@/components/mail/thread-forward-mark";

export function RowDateMarks({
  account,
  threadId,
  forwardedAt,
  repliedApartAt,
  tipId,
  tipRefs,
}: {
  account: string;
  threadId: string;
  forwardedAt?: string;
  repliedApartAt?: string;
  /** The row's newest Message-ID and the ones it names: what a build's marks know the conversation by. */
  tipId?: string;
  tipRefs?: string[];
}) {
  return (
    <>
      <HiddenAccountMark account={account} />
      <TeamRowMark account={account} threadId={threadId} />
      <TeamRowCommentMark thread={{ account, threadId, tipId, tipRefs }} />
      <ForwardedRowMark forwardedAt={forwardedAt} repliedApartAt={repliedApartAt} />
    </>
  );
}
