/**
 * Folder names, read as the hierarchy they already are.
 *
 * Both providers keep nesting in the name: Gmail writes a nested label
 * `Academia/Figenbladet`, and the Outlook path comes back the same way. The
 * old menu drew those names whole, one flat row each, so a reader looking
 * for Figenbladet read the word Academia on every line and the shape of
 * their own filing was nowhere on screen.
 *
 * Nothing here fetches or renders. It turns a flat list into a tree and
 * narrows a tree by a typed word, and both are worth testing on their own.
 */

import type {
  MailAccountFolder,
  MailFolderRole,
} from "@/lib/mail/folder-types";

export const FOLDER_PATH_SEPARATOR = "/";

export type FolderTreeNode = {
  account: string;
  /** The whole name, the way the provider writes it: `Academia/Figenbladet`. */
  name: string;
  /** The last part. Its parents stand for the rest, so the row need not. */
  label: string;
  count: number;
  /** Set when the provider manages this folder, not the person filing. */
  role?: MailFolderRole;
  /** The row stands for a search, not a folder. Nothing files into one. */
  virtual?: boolean;
  /**
   * No folder of this name exists — it is here because something under it
   * does. Both providers let `Academia/Figenbladet` be made without anyone
   * ever making `Academia`, and a tree with a hole where the parent goes
   * cannot be drawn. Nothing can be filed into one of these.
   */
  implied: boolean;
  children: FolderTreeNode[];
};

function splitFolderName(name: string): string[] {
  return name
    .split(FOLDER_PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Inbox, Archive, Drafts, Sent, Deleted — in that order, above the rest.
 *
 * Alphabetical among the folders somebody made would scatter the ones the
 * provider made through the list, so Sent lands between ScanSoc and
 * thank-you-notes. Every mail client puts them together at the top, and
 * this is that order — the inbox first, because it is the one the others
 * are named in relation to.
 */
/** The order the head of the rail uses, so every account reads the same. */
const ROLE_ORDER: MailFolderRole[] = [
  "inbox",
  "sent",
  "archive",
  "drafts",
  "junk",
  "trash",
];

function rank(node: FolderTreeNode): number {
  const at = node.role ? ROLE_ORDER.indexOf(node.role) : -1;
  return at === -1 ? ROLE_ORDER.length : at;
}

function sortNodes(nodes: FolderTreeNode[]): FolderTreeNode[] {
  nodes.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
  for (const node of nodes) sortNodes(node.children);
  return nodes;
}

/**
 * One account's folders as a tree.
 *
 * Counts are not added up the tree. A parent folder holds what it holds;
 * Academia says 500 because 500 conversations are in Academia, not because
 * its children come to that.
 */
export function buildFolderTree(rows: MailAccountFolder[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = [];
  const byPath = new Map<string, FolderTreeNode>();

  // Shortest names first, so a real parent is made before anything implies
  // one — otherwise `Academia/Figenbladet` arriving first would leave an
  // implied Academia that the real row then has to correct.
  const ordered = [...rows].sort(
    (a, b) => splitFolderName(a.name).length - splitFolderName(b.name).length
  );

  for (const row of ordered) {
    const parts = splitFolderName(row.name);
    if (!parts.length) continue;
    let siblings = roots;
    let path = "";
    parts.forEach((part, depth) => {
      path = path ? `${path}${FOLDER_PATH_SEPARATOR}${part}` : part;
      const key = path.toLowerCase();
      let node = byPath.get(key);
      if (!node) {
        node = {
          account: row.account,
          name: path,
          label: part,
          count: 0,
          implied: true,
          children: [],
        };
        byPath.set(key, node);
        siblings.push(node);
      }
      // The row names this node itself, rather than passing through it.
      if (depth === parts.length - 1) {
        node.implied = false;
        node.count = row.count;
        node.role = row.role;
        node.virtual = row.virtual;
      }
      siblings = node.children;
    });
  }

  return sortNodes(roots);
}

/** Does anything in this subtree answer to the word? */
function subtreeMatches(node: FolderTreeNode, needle: string): boolean {
  if (node.label.toLowerCase().includes(needle)) return true;
  return node.children.some((child) => subtreeMatches(child, needle));
}

/**
 * The tree, narrowed to a typed word.
 *
 * A folder is kept when its own name answers to the word. Its parents come
 * with it — `Figenbladet` on its own says less than `Academia` above it —
 * and so does everything inside it, because narrowing to Academia and then
 * being shown an Academia with nothing in it is not narrowing, it is
 * hiding.
 *
 * Matched against the last part of the name only. The parents are on screen
 * already, so a word that matches one of them keeps their whole subtree
 * through that rule rather than through every child's full path.
 */
export function filterFolderTree(
  nodes: FolderTreeNode[],
  query: string
): FolderTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const keep = (node: FolderTreeNode): FolderTreeNode | null => {
    if (node.label.toLowerCase().includes(needle)) return node;
    if (!subtreeMatches(node, needle)) return null;
    return {
      ...node,
      children: node.children
        .map(keep)
        .filter((child): child is FolderTreeNode => child !== null),
    };
  };
  return nodes
    .map(keep)
    .filter((node): node is FolderTreeNode => node !== null);
}

/** Every folder name in the tree, parents before children. */
export function flattenFolderTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  const out: FolderTreeNode[] = [];
  const walk = (list: FolderTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Every folder standing over this one, outermost first.
 *
 * What a collapsed parent has to be told to open before a folder found by
 * filtering — or aimed at by a drag — can be seen at all.
 */
export function folderAncestors(name: string): string[] {
  const parts = splitFolderName(name);
  const out: string[] = [];
  let path = "";
  for (const part of parts.slice(0, -1)) {
    path = path ? `${path}${FOLDER_PATH_SEPARATOR}${part}` : part;
    out.push(path);
  }
  return out;
}
