/**
 * The Outlook worker against a scripted Graph.
 *
 * What it must do without anybody watching: walk the inbox before the
 * rest, keep a delta link per folder, ask only the inbox on an inbox
 * pass, start a folder over when Graph has forgotten its delta, and stop
 * only when the pass under way has ended.
 */

import { startOutlookSync, stopOutlookSync, wakeOutlookSync } from "@/lib/mail/outlook-sync";
import { rememberOutlookAccessToken } from "@/lib/mail/outlook-token";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const me = "vera@outlook.example";
// A token in hand: buying one is the desktop shell's job, not this test's.
rememberOutlookAccessToken(me, "tok");

// The worker times itself with the window's clock and says what changed
// on the window; in a test the global is both.
globalThis.window = globalThis;
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const states = [];
let fullAnnouncements = 0;
let lastOverallPhase = null;
const upserts = [];
const bodies = [];
const removed = [];
setMailStore({
  settings: { get: async () => null, set: async () => {} },
  accounts: {
    getToken: async () => ({ refreshToken: "r", ownerId: "local" }),
    updateToken: async () => {},
  },
  sync: {
    list: async () => states.map((s) => ({ ...s })),
    set: async (state) => {
      // A walk is announced once, when the phase turns full; the progress
      // it publishes after each folder is not a new announcement.
      if (state.folder === "") {
        if (state.phase === "full" && lastOverallPhase !== "full") fullAnnouncements += 1;
        lastOverallPhase = state.phase;
      }
      const i = states.findIndex((s) => s.account === state.account && s.folder === (state.folder ?? ""));
      const next = { ...state, folder: state.folder ?? "" };
      if (i >= 0) states[i] = { ...states[i], ...next };
      else states.push(next);
    },
  },
  messages: {
    upsertMany: async (account, rows) => upserts.push(...rows.map((r) => ({ ...r, account }))),
    putBody: async (account, id, body) => bodies.push({ account, id, body }),
    removeMessages: async (account, ids) => removed.push(...ids),
  },
});

const FOLDERS = [
  { id: "arch", displayName: "Archive", wellKnownName: "archive", count: 2 },
  { id: "inbox", displayName: "Inbox", wellKnownName: "inbox", count: 1 },
];
const shape = (f) => ({
  id: f.id,
  displayName: f.displayName,
  parentFolderId: "root",
  childFolderCount: 0,
  totalItemCount: f.count,
  wellKnownName: f.wellKnownName,
});
const message = (id, folder) => ({
  id,
  conversationId: `c-${id}`,
  internetMessageId: `<${id}@x.test>`,
  subject: `Mail ${id} in ${folder}`,
  bodyPreview: "words",
  body: { contentType: "html", content: `<p>${id}</p>` },
  from: { emailAddress: { name: "Ann", address: "ann@sender.test" } },
  toRecipients: [{ emailAddress: { name: "Vera", address: me } }],
  receivedDateTime: "2026-09-01T10:00:00Z",
  isRead: false,
  hasAttachments: false,
  isDraft: false,
});

/** Graph as the worker sees it: the delta calls, in order, and their answers. */
const deltaCalls = [];
let expireInboxOnce = false;
/** Graph fails the archive's delta once: a first read cut short partway. */
let failArchiveOnce = false;
globalThis.fetch = async (url, init) => {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com")) return json({ access_token: "tok", expires_in: 3600 });
  const delta = url.match(/\/mailFolders\/([^/]+)\/messages\/delta/);
  if (delta) {
    const folder = decodeURIComponent(delta[1]);
    const token = url.match(/deltatoken=([^&]+)/)?.[1] ?? null;
    deltaCalls.push({ folder, token });
    if (folder === "arch" && failArchiveOnce) {
      failArchiveOnce = false;
      // A 500, which the Graph client does not retry, so the pass fails at once.
      return json({ error: { code: "InternalServerError", message: "broke" } }, 500);
    }
    if (folder === "inbox" && token && expireInboxOnce) {
      expireInboxOnce = false;
      return json({ error: { code: "SyncStateNotFound", message: "gone" } }, 410);
    }
    const value = token ? [] : [message(`${folder}-1`, folder)];
    return json({
      value,
      "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=${folder}-t${deltaCalls.length}`,
    });
  }
  if (url.includes("/childFolders")) return json({ value: [] });
  const one = url.match(/\/mailFolders\/([^/?]+)(\?|$)/);
  if (one) {
    const key = decodeURIComponent(one[1]);
    const hit = FOLDERS.find((f) => f.wellKnownName === key || f.id === key);
    return hit ? json(shape(hit)) : json({ error: { message: "not found" } }, 404);
  }
  if (url.includes("/me/mailFolders")) return json({ value: FOLDERS.map(shape) });
  return json({ error: { message: `unexpected ${url} ${init?.method ?? "GET"}` } }, 500);
};

const until = async (ok, what) => {
  const deadline = Date.now() + 5_000;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`waited in vain for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const overall = () => states.find((s) => s.account === me && s.folder === "");

suite(async () => {
  check("a worker starts once", startOutlookSync(me) === true && startOutlookSync(me) === false);
  await until(() => overall()?.phase === "live", "the first walk");
  const firstWalk = deltaCalls.map((c) => c.folder);
  check("the inbox is walked before the archive, whatever order Graph lists them in", firstWalk.join(",") === "inbox,arch", firstWalk);
  check("every folder's rows are in the copy", upserts.map((r) => r.messageId).sort().join(",") === "arch-1,inbox-1", upserts.map((r) => r.messageId));
  check("the inbox row carries the INBOX label", upserts.find((r) => r.messageId === "inbox-1")?.labels.includes("INBOX") === true);
  check("bodies come with the delta", bodies.length === 2, bodies.length);
  check("each folder keeps its delta link", states.filter((s) => s.folder && s.folder !== "" && s.deltaLink).length === 2, states);
  check("the first walk announced itself as full and ended live", overall().phase === "live" && overall().fullSyncTotal === 3, overall());

  // An inbox-only wake asks Graph about the inbox and nothing else.
  const before = deltaCalls.length;
  wakeOutlookSync(me, "inbox");
  await until(() => deltaCalls.length > before, "the inbox pass");
  await new Promise((r) => setTimeout(r, 100));
  const inboxPass = deltaCalls.slice(before);
  check("an inbox wake asks only the inbox", inboxPass.every((c) => c.folder === "inbox") && inboxPass.length === 1, inboxPass);
  check("and asks from where it left off", inboxPass[0].token != null, inboxPass[0]);

  // Graph has forgotten the inbox's delta: the folder is read again from the start.
  expireInboxOnce = true;
  const before410 = deltaCalls.length;
  wakeOutlookSync(me, "inbox");
  await until(() => deltaCalls.length >= before410 + 2, "the re-walk after 410");
  const afterGone = deltaCalls.slice(before410);
  check("a 410 is followed by a walk from the start", afterGone[0].token != null && afterGone[1].token == null && afterGone[1].folder === "inbox", afterGone);
  await until(() => overall()?.phase === "live", "live again");
  check("the worker is not paused by the expired delta", overall().phase === "live", overall());

  // A pause does not announce a full walk again.
  const inboxState = states.find((s) => s.folder === "inbox");
  overall().phase = "paused";
  lastOverallPhase = "paused";
  const fullsBefore = fullAnnouncements;
  wakeOutlookSync(me, "all");
  await until(() => overall()?.phase === "live", "the pass after a pause");
  check("a pass after a pause does not announce a full walk again", fullAnnouncements === fullsBefore && fullsBefore === 1, fullAnnouncements);
  check("the inbox kept its delta link across it", states.find((s) => s.folder === "inbox")?.deltaLink != null && inboxState != null);

  // Stop waits for the pass under way.
  wakeOutlookSync(me, "all");
  await new Promise((r) => setTimeout(r, 10));
  const setsBefore = states.length;
  await stopOutlookSync(me);
  const phaseAfterStop = overall().phase;
  await new Promise((r) => setTimeout(r, 200));
  check("stop leaves the mailbox in phase none", phaseAfterStop === "none", phaseAfterStop);
  check("and nothing writes after it", overall().phase === "none" && states.length === setsBefore, overall());
  check("a stopped worker can start again", startOutlookSync(me) === true);
  await stopOutlookSync(me);

  // A first read cut short by an error is announced again when it resumes,
  // and an inbox pass in the middle of it does not end it.
  states.length = 0;
  lastOverallPhase = null;
  failArchiveOnce = true;
  const fullsAtStart = fullAnnouncements;
  check("a fresh worker starts", startOutlookSync(me) === true);
  await until(() => overall()?.phase === "paused", "the pause partway through the first read");
  check("the read cut short is paused, with its count kept", overall().phase === "paused" && fullAnnouncements === fullsAtStart + 1, overall());
  // Any wake after that resumes the whole read: nothing has been walked
  // to the end yet, so there is no inbox-only pass to make.
  wakeOutlookSync(me, "inbox");
  await until(() => overall()?.phase === "live", "the resumed first read");
  check("the resumed read announced itself again and ended live", fullAnnouncements === fullsAtStart + 2 && overall().fullSyncTotal === 3, { fullAnnouncements, overall: overall() });
  await stopOutlookSync(me);
});
