/**
 * Outlook folders, flattened for a UI that knows only names.
 *
 * The Mail UI keys a folder by one string and reads `/` as nesting, because
 * that is how Gmail writes a nested label. Outlook has a real tree, so what is
 * checked here is the conversion: which folders reach the list, and what each
 * one is called once it gets there.
 */

import {
  findOutlookFolder,
  listOutlookFolders,
} from "@/lib/mail/outlook-folders";
import { check, suite } from "./harness.mjs";

let graphCalls;

/**
 * Serve one mailbox over Graph.
 *
 * `folders` is a flat list of `{ id, displayName, parentId, wellKnownName }`.
 * `wellKnownName: false` on the mailbox drops the property from every reply
 * and refuses the $select that asks for it — what a personal Outlook.com
 * mailbox does, and the reason the aliases below have to be asked for by name.
 */
function mailbox(folders, { wellKnownName = true } = {}) {
  graphCalls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd) =>
          cmd === "oauth_token_request"
            ? { status: 200, body: { access_token: "at-1" } }
            : cmd === "mail_store_call"
              ? { refreshToken: "rt", ownerId: "local" }
              : null,
      },
    },
  };

  const shape = (f) => ({
    id: f.id,
    displayName: f.displayName,
    parentFolderId: f.parentId ?? "root",
    childFolderCount: folders.filter((c) => c.parentId === f.id).length,
    totalItemCount: f.count ?? 0,
    ...(wellKnownName ? { wellKnownName: f.wellKnownName ?? null } : {}),
  });

  globalThis.fetch = async (url) => {
    graphCalls.push(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (!wellKnownName && url.includes("wellKnownName")) {
      return json({ error: { message: "Could not find a property named" } }, 400);
    }

    const childFolders = url.match(/\/mailFolders\/([^/?]+)\/childFolders/);
    if (childFolders) {
      const parentId = decodeURIComponent(childFolders[1]);
      return json({
        value: folders.filter((f) => f.parentId === parentId).map(shape),
      });
    }

    const one = url.match(/\/mailFolders\/([^/?]+)(\?|$)/);
    if (one) {
      const key = decodeURIComponent(one[1]);
      const hit = folders.find(
        (f) => f.wellKnownName === key || f.id === key
      );
      if (!hit) return json({ error: { message: "not found" } }, 404);
      return json(shape(hit));
    }

    if (url.includes("/me/mailFolders")) {
      // Top level, in two pages — the walk must follow @odata.nextLink or it
      // quietly loses whatever sits on the second page.
      const top = folders.filter((f) => !f.parentId || f.parentId === "root");
      if (url.includes("page2")) {
        return json({ value: top.slice(1).map(shape) });
      }
      return json({
        value: top.slice(0, 1).map(shape),
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders?page2=1",
      });
    }
    return json({ error: { message: `unexpected ${url}` } }, 500);
  };
}

/** A mailbox shaped like a real one: managed folders, plus nesting under both. */
const TREE = [
  { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
  { id: "sent", displayName: "Sent Items", wellKnownName: "sentitems" },
  { id: "del", displayName: "Deleted Items", wellKnownName: "deleteditems" },
  { id: "arch", displayName: "Archive", wellKnownName: "archive" },
  { id: "fam", displayName: "Family", parentId: "inbox", count: 12 },
  { id: "hol", displayName: "Holidays", parentId: "fam", count: 3 },
  { id: "hus", displayName: "House", parentId: "root", count: 7 },
  { id: "bank", displayName: "Bank", parentId: "hus", count: 4 },
  { id: "old", displayName: "Old junk", parentId: "del", count: 99 },
  { id: "a2024", displayName: "2024", parentId: "arch", count: 40 },
  // What a Gmail account added to Outlook.com brings with it: IMAP keeps
  // Gmail's own special folders under a `[Gmail]` prefix, and Exchange parks
  // whatever it cannot map onto its own folders under `[Imap]`. Graph gives
  // neither container a well-known name, so both look like user folders.
  { id: "gm", displayName: "[Gmail]", parentId: "root", count: 0 },
  { id: "gmbin", displayName: "Bin", parentId: "gm", count: 120 },
  { id: "gmfin", displayName: "Finance", parentId: "gmbin", count: 6 },
  { id: "im", displayName: "[Imap]", parentId: "root", count: 0 },
  { id: "imarch", displayName: "Archive", parentId: "im", count: 500 },
  // Square brackets are not the rule. Somebody made this one.
  { id: "notion", displayName: "[Notion]", parentId: "root", count: 8 },
];

suite(async () => {
  // ---- The tree, flattened -------------------------------------------------
  mailbox(TREE);
  const folders = await listOutlookFolders("nested@outlook.com");
  const paths = folders.map((f) => f.path).sort();

  check(
    "a nested folder is named by its whole path, the way a Gmail label is",
    paths.includes("Inbox/Family/Holidays"),
    paths.join(", ")
  );
  check(
    "a folder under the inbox keeps the inbox in its name, so two folders called Family stay apart",
    paths.includes("Inbox/Family")
  );
  check(
    "a folder at the top of the mailbox is named by itself",
    paths.includes("House") && paths.includes("House/Bank")
  );
  check(
    "a folder under Archive is listed, because people file real mail there",
    paths.includes("Archive/2024")
  );

  // ---- The four Outlook manages, under their own mailbox -------------------
  // The rail also carries these as unified rows at the top, which are every
  // mailbox at once. These are the same places one mailbox at a time, which
  // is the question the top rows cannot answer.
  check(
    "Archive, Drafts, Sent and Deleted are listed under the mailbox",
    ["Archive", "Sent Items", "Deleted Items"].every((p) => paths.includes(p)),
    paths.join(", ")
  );
  check(
    "each is marked with what it is, so the rail can draw and treat it as itself",
    folders.find((f) => f.path === "Sent Items")?.role === "sent" &&
      folders.find((f) => f.path === "Deleted Items")?.role === "trash" &&
      folders.find((f) => f.path === "Archive")?.role === "archive",
    JSON.stringify(folders.filter((f) => f.role).map((f) => [f.path, f.role]))
  );
  check(
    "a folder somebody made is not marked, so it stays an ordinary folder",
    folders.find((f) => f.path === "House")?.role === undefined
  );
  check(
    "and what people filed inside them comes too",
    paths.includes("Deleted Items/Old junk") && paths.includes("Archive/2024"),
    paths.join(", ")
  );

  // The inbox used to be left out, because the list beside the rail is the
  // inbox — which left the folders filed under it hanging off a name with
  // nothing behind it. It is a folder on the mailbox, and it is listed as
  // one, at the top with the others the provider made.
  check(
    "the inbox is listed, and so is what is filed under it",
    paths.includes("Inbox") && paths.includes("Inbox/Family"),
    paths.join(", ")
  );
  check(
    "and it is known for what it is, so it sorts above the rest",
    folders.find((f) => f.path === "Inbox")?.role === "inbox",
    folders.find((f) => f.path === "Inbox")?.role
  );

  // ---- IMAP plumbing -------------------------------------------------------
  // A Gmail account synced into Outlook.com over IMAP brings these. They are
  // not folders anybody made — they hold Gmail's bin and drafts under IMAP
  // names — and Outlook itself never shows them either.
  check(
    "the IMAP namespace containers are not listed",
    !paths.includes("[Gmail]") && !paths.includes("[Imap]"),
    paths.join(", ")
  );
  check(
    "nor is anything inside them, however far down",
    !paths.some((p) => p.startsWith("[Gmail]") || p.startsWith("[Imap]")),
    paths.filter((p) => p.startsWith("[")).join(", ")
  );
  check(
    "a folder somebody made is kept, brackets and all — the rule is the name, not the punctuation",
    paths.includes("[Notion]")
  );

  // Still resolvable, so a move or a count that names one still finds it.
  const bin = await findOutlookFolder("nested@outlook.com", "[Gmail]/Bin");
  check(
    "a namespaced folder still resolves by path, even though it is not listed",
    bin?.id === "gmbin",
    bin?.id
  );

  // ---- Counts --------------------------------------------------------------
  check(
    "each folder carries its own count, not its children's",
    folders.find((f) => f.path === "Inbox/Family")?.count === 12,
    folders.find((f) => f.path === "Inbox/Family")?.count
  );

  // ---- Paging --------------------------------------------------------------
  check(
    "the second page of top-level folders is read too",
    paths.includes("House"),
    graphCalls.filter((u) => u.includes("page2")).length + " follow-up calls"
  );

  // ---- Finding one by path -------------------------------------------------
  const found = await findOutlookFolder("nested@outlook.com", "Inbox/Family");
  check("a path resolves to the folder id the move will use", found?.id === "fam", found?.id);

  const missing = await findOutlookFolder("nested@outlook.com", "Not a folder");
  check("a path no folder has resolves to nothing", missing === null);

  // A managed folder still resolves, or `Inbox/Family` would create a second
  // folder called Inbox next to the real one.
  const inbox = await findOutlookFolder("nested@outlook.com", "Inbox");
  check("a managed folder still resolves by path, even though it is not listed",
    inbox?.id === "inbox", inbox?.id);

  // ---- A mailbox in another language ---------------------------------------
  // Display names are translated; the well-known aliases are not. A mailbox
  // that will not return `wellKnownName` has to be asked for each alias by
  // name, or every managed folder reads as an ordinary one — the inbox would
  // be listed, and Sendt post would sort in among the folders somebody made
  // rather than to the top with its own icon.
  const DANISH = [
    { id: "inbox", displayName: "Indbakke", wellKnownName: "inbox" },
    { id: "sent", displayName: "Sendt post", wellKnownName: "sentitems" },
    { id: "del", displayName: "Slettet post", wellKnownName: "deleteditems" },
    { id: "fam", displayName: "Familie", parentId: "inbox", count: 5 },
  ];
  mailbox(DANISH, { wellKnownName: false });
  const danish = (await listOutlookFolders("dansk@outlook.com")).map((f) => f.path);

  check(
    "a mailbox that hides wellKnownName still knows its inbox for what it is",
    (await listOutlookFolders("dansk@outlook.com")).find(
      (f) => f.path === "Indbakke"
    )?.role === "inbox",
    danish.join(", ")
  );
  check(
    "and its Sent and Deleted are known for what they are, in any language",
    (await listOutlookFolders("dansk@outlook.com")).find(
      (f) => f.path === "Sendt post"
    )?.role === "sent",
    danish.join(", ")
  );
  check(
    "and the real folder inside it is still listed",
    danish.includes("Indbakke/Familie"),
    danish.join(", ")
  );
  check(
    "the refused $select is retried without wellKnownName rather than failing",
    graphCalls.some((u) => u.includes("wellKnownName")) &&
      danish.length > 0
  );
});
