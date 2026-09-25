/*
 * The rules for a drop on the folder rail: which rows take a conversation,
 * and which folders a folder can be moved into.
 *
 * Pure, so a suite can read them. The rail's rows (folder-rail-rows.tsx)
 * ask here.
 */

import { type FolderTreeNode } from "@/lib/mail/folder-tree";

/**
 * Nobody files into Sent or Drafts.
 *
 * The same rule as the unified rows above, where those two dim mid-drag —
 * and it has to hold here too, or the rule reads as "mail cannot go in
 * Sent, unless you scroll down to the other Sent".
 */
export const ROLE_REFUSES_DROP = new Set<string>(["sent", "drafts"]);

/**
 * A folder being carried to a new parent.
 *
 * Its own channel, not the thread one: the rail refuses a thread wherever
 * a folder may go and the other way about, and one flag standing for both
 * would have each answering the other's question.
 */
export type FolderDrag = { account: string; name: string; label: string };

/** Everything above this folder in its own name, or "" at the top. */
export function folderParentPath(name: string): string {
  return name.split("/").slice(0, -1).join("/");
}

/**
 * May this folder be dropped into that one?
 *
 * The same mailbox, because a folder is a place on a mailbox and there is
 * no moving it to another. Not into itself, and not into anything already
 * inside it — a folder cannot hold the folder that holds it, and asked to
 * do that a provider loses the subtree. And not into the parent it already
 * has, which would be a rename to the name it already has.
 *
 * A stand-in parent takes one. It is drawn for a name that has children in
 * the list but no row of its own, and the commonest of those is the
 * Outlook inbox: the rail leaves it out because the list beside it is the
 * inbox already, and people file real folders under it all the same. The
 * move is a rename — `Inbox/Receipts` — and the provider resolves the
 * parent by path against its own tree, where the inbox is a folder like
 * any other. A search row still refuses: there is nothing behind it.
 */
export function folderAcceptsFolder(drag: FolderDrag, node: FolderTreeNode): boolean {
  if (node.virtual) return false;
  if (drag.account.toLowerCase() !== node.account.toLowerCase()) return false;
  const from = drag.name.toLowerCase();
  const to = node.name.toLowerCase();
  if (from === to || to.startsWith(`${from}/`)) return false;
  return folderParentPath(from).toLowerCase() !== to;
}

/**
 * What a row does while a conversation is in the air.
 *
 * "live" takes the drop. "dim" is still readable and refuses it — the row
 * keeps its place either way, because a rail that reshuffles mid-drag moves
 * the folder the reader was aiming at.
 */
export type DropState = "rest" | "live" | "dim";

/**
 * What a folder row does with what is being dragged.
 *
 * While a folder is being carried, that is the only question being asked,
 * so it answers instead of the thread rules rather than alongside them,
 * and a row that will not take the folder dims the way a foreign mailbox
 * dims for a thread.
 */
export function folderRowDropState(input: {
  node: FolderTreeNode;
  /** What the rail says about a conversation over this mailbox. */
  drop: DropState;
  folderDrag: FolderDrag | null;
  renaming: boolean;
  busy: boolean;
}): {
  /** A row mail does not go into: a search, or Archived. */
  refuses: boolean;
  carrying: boolean;
  beingCarried: boolean;
  state: DropState;
  takesDrop: boolean;
  canMoveThisFolder: boolean;
} {
  const { node, drop, folderDrag, renaming, busy } = input;
  // A row standing for a search has no folder behind it to file into, and
  // "Archived" is not somewhere you put mail in any case — you archive it.
  const refuses =
    node.virtual || Boolean(node.role && ROLE_REFUSES_DROP.has(node.role));
  const carrying = folderDrag !== null;
  const beingCarried =
    carrying &&
    folderDrag.account.toLowerCase() === node.account.toLowerCase() &&
    folderDrag.name.toLowerCase() === node.name.toLowerCase();
  const state: DropState = carrying
    ? folderAcceptsFolder(folderDrag, node)
      ? "live"
      : "dim"
    : drop;
  // A conversation cannot be filed into a stand-in parent: the rail knows
  // the name but not what is behind it, and on Gmail there is often
  // nothing. A folder can — see `folderAcceptsFolder`, where the move goes
  // through the provider's own tree rather than this one.
  const takesDrop = carrying
    ? state === "live"
    : drop === "live" && !node.implied && !refuses;
  /** A stand-in parent and a search are not folders anybody can move. */
  const canMoveThisFolder =
    !node.implied && !node.virtual && !renaming && !busy;
  return { refuses, carrying, beingCarried, state, takesDrop, canMoveThisFolder };
}
