/**
 * Folder names read as the hierarchy they already are.
 *
 * Both providers keep nesting in the name — `Academia/Figenbladet` — and the
 * rail draws that as a tree. What is checked here is the reading: where the
 * parents come from when nobody made them, what a typed word keeps, and
 * that two mailboxes with the same folder name stay two folders.
 */

import assert from "node:assert/strict";

import {
  buildFolderTree,
  filterFolderTree,
  flattenFolderTree,
  folderAncestors,
} from "@/lib/mail/folder-tree";
import {
  accountsWithFolders,
  isImapNamespaceFolder,
  mergeFoldersByName,
} from "@/lib/mail/folder-types";

import { check, suite } from "./harness.mjs";

const GMAIL = "you@gmail.com";
const OUTLOOK = "you@outlook.com";

const row = (name, count = 0, account = GMAIL) => ({ account, name, count });

suite(async () => {
  /** ── the tree ──────────────────────────────────────────────────────── */

  const tree = buildFolderTree([
    row("Academia", 500),
    row("Academia/Figenbladet", 35),
    row("Academia/AEPS blog", 5),
    row("Archive", 500),
    row("62 Abingdon", 85),
  ]);

  check(
    "top-level folders come back sorted, and nested ones are not among them",
    tree.map((n) => n.label).join(", ") === "62 Abingdon, Academia, Archive",
    tree.map((n) => n.label).join(", ")
  );

  const academia = tree.find((n) => n.label === "Academia");
  check(
    "a nested name becomes a child, drawn by its last part alone",
    academia.children.map((c) => c.label).join(", ") ===
      "AEPS blog, Figenbladet",
    academia.children.map((c) => c.label).join(", ")
  );
  check(
    "the child keeps its whole name, which is what the provider is asked for",
    academia.children[1].name === "Academia/Figenbladet",
    academia.children[1].name
  );
  check(
    "a parent holds what it holds — counts are not added up the tree",
    academia.count === 500,
    String(academia.count)
  );

  /**
   * Both providers let `A/B` be made without anyone ever making `A`, and a
   * tree with a hole where the parent goes cannot be drawn.
   */
  const orphan = buildFolderTree([row("Clients/2026/Acme", 3)]);
  check(
    "a parent nobody made is stood in for, so the child has somewhere to hang",
    orphan[0].label === "Clients" && orphan[0].children[0].label === "2026",
    JSON.stringify(orphan.map((n) => n.label))
  );
  check(
    "and it is marked as one, because nothing can be filed into it",
    orphan[0].implied === true &&
      orphan[0].children[0].implied === true &&
      orphan[0].children[0].children[0].implied === false
  );
  check(
    "a parent that does exist is not marked, whichever order it arrived in",
    buildFolderTree([row("A/B", 1), row("A", 9)])[0].implied === false
  );

  /** ── the four the provider manages ─────────────────────────────────── */

  const withSystem = buildFolderTree([
    row("ScanSoc", 500),
    row("Archive", 36, GMAIL),
    row("62 Abingdon", 85),
    { account: GMAIL, name: "Sent Items", count: 0, role: "sent" },
    { account: GMAIL, name: "Deleted Items", count: 33, role: "trash" },
    { account: GMAIL, name: "Archive", count: 36, role: "archive" },
    { account: GMAIL, name: "Drafts", count: 14, role: "drafts" },
    { account: GMAIL, name: "Junk Email", count: 4, role: "junk" },
  ]);
  check(
    "they sort to the top of the mailbox, in their own order, above what somebody made",
    // The order the head of the rail uses, so an account reads the same as
    // the six above it: inbox, sent, archived, drafts, junk, trash.
    withSystem.map((n) => n.label).join(", ") ===
      "Sent Items, Archive, Drafts, Junk Email, Deleted Items, 62 Abingdon, ScanSoc",
    withSystem.map((n) => n.label).join(", ")
  );
  /*
   * Junk above the bin.
   *
   * They are not the same kind of place: one holds what the provider is
   * unsure about and the reader may want back, the other holds what the
   * reader has already thrown away. Reaching junk used to mean a menu
   * beside the list, and on Outlook it was hidden from the tree outright.
   */
  check(
    "junk stands above the bin, not in it",
    withSystem.findIndex((n) => n.role === "junk") <
      withSystem.findIndex((n) => n.role === "trash")
  );
  check(
    "each keeps what it is, so the rail can draw it as itself",
    withSystem[0].role === "sent" && withSystem[4].role === "trash"
  );
  check(
    "a folder somebody made carries no role and sorts by name as before",
    withSystem[5].role === undefined && withSystem[6].role === undefined
  );

  /** ── the filter ────────────────────────────────────────────────────── */

  const found = filterFolderTree(tree, "fig");
  check(
    "a word keeps what answers to it, and drops what does not",
    found.length === 1 && found[0].label === "Academia",
    JSON.stringify(found.map((n) => n.label))
  );
  check(
    "the parents come with it — Figenbladet alone says less than under Academia",
    found[0].children.length === 1 &&
      found[0].children[0].label === "Figenbladet"
  );
  check(
    "a word that matches a parent keeps everything inside it",
    filterFolderTree(tree, "academia")[0].children.length === 2
  );
  check("an empty word keeps the whole tree", filterFolderTree(tree, "  ") === tree);
  check(
    "a word nothing answers to keeps nothing",
    filterFolderTree(tree, "zzz").length === 0
  );
  check(
    "matching ignores case",
    filterFolderTree(tree, "FIGEN")[0].children[0].label === "Figenbladet"
  );

  /** ── mailboxes stay apart ──────────────────────────────────────────── */

  const both = [row("Archive", 4, GMAIL), row("Archive", 9, OUTLOOK)];
  const merged = mergeFoldersByName(both);
  check(
    "the old single list still folds them into one row with the counts added",
    merged.length === 1 && merged[0].count === 13,
    JSON.stringify(merged)
  );
  check(
    "the rail's own tree is built per mailbox, so they never meet",
    buildFolderTree(both.filter((f) => f.account === GMAIL))[0].count === 4
  );
  check(
    "every mailbox that has a folder is named, once, in the order it came",
    accountsWithFolders([...both, row("Other", 1, GMAIL)]).join(",") ===
      `${GMAIL},${OUTLOOK}`
  );

  /** ── IMAP plumbing, whichever provider hands it over ───────────────── */
  // Gmail leaves these behind as real labels after a mail import or an IMAP
  // client, and an Exchange mailbox synced from Gmail leaves them as
  // folders. One rule, so both providers drop them.
  check(
    "the namespace containers are plumbing",
    ["[Gmail]", "[Imap]", "[Google Mail]"].every(isImapNamespaceFolder)
  );
  check(
    "so is everything inside them, however far down",
    isImapNamespaceFolder("[Gmail]/Bin") &&
      isImapNamespaceFolder("[Gmail]/Bin/Finance")
  );
  check(
    "the rule is the name, not the punctuation — [Notion] is a label somebody made",
    !isImapNamespaceFolder("[Notion]") && !isImapNamespaceFolder("Academia")
  );
  check(
    "and not a folder that merely mentions one further down its path",
    !isImapNamespaceFolder("Academia/[Gmail]")
  );

  /** ── what a drop has to open on the way in ─────────────────────────── */

  check(
    "the folders standing over one are listed outermost first",
    folderAncestors("Clients/2026/Acme").join(" > ") === "Clients > Clients/2026",
    folderAncestors("Clients/2026/Acme").join(" > ")
  );
  check(
    "a top-level folder stands under nothing",
    folderAncestors("Archive").length === 0
  );

  check(
    "flattening walks parents before their children",
    flattenFolderTree(tree).map((n) => n.label).join(",") ===
      "62 Abingdon,Academia,AEPS blog,Figenbladet,Archive",
    flattenFolderTree(tree).map((n) => n.label).join(",")
  );
});
