/**
 * The Outlook worker against a scripted Graph.
 *
 * What it must do without anybody watching: walk the inbox before the
 * rest, keep a delta link per folder, ask only the inbox on an inbox
 * pass, start a folder over when Graph has forgotten its delta, and stop
 * only when the pass under way has ended.
 */

import { firstReadLines } from "@/lib/mail/first-read";
import { noteOutlookMove } from "@/lib/mail/outlook-moves";
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
/** Each removal with the folder it was reported for. */
const removals = [];
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
      // The row is replaced, not merged: the real store writes every column
      // of the state it is given, and a field left out is a field emptied.
      // This fake merged once, and so passed a worker whose "paused" state
      // wiped the first read's count in the real app.
      if (i >= 0) states[i] = next;
      else states.push(next);
    },
  },
  messages: {
    upsertMany: async (account, rows) => upserts.push(...rows.map((r) => ({ ...r, account }))),
    putBody: async (account, id, body) => bodies.push({ account, id, body }),
    removeMessages: async (account, ids, options) => {
      removed.push(...ids);
      removals.push({ ids: [...ids], leftFolder: options?.leftFolder ?? null });
    },
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
/** A folder of two pages, whose second page fails once: a read cut short mid-folder. */
let failSecondPageOnce = false;
let expireInboxOnce = false;
/** Graph reports the inbox's message gone once: deleted, or moved away. */
let removeInboxOnce = false;
/** The archive's message arrives in the inbox under a new id, as a move makes it. */
let arriveMovedOnce = false;
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
    const skip = url.match(/skiptoken=([^&]+)/)?.[1] ?? null;
    deltaCalls.push({ folder, token, skip, auth: init?.headers?.Authorization ?? null });
    if (folder === "big") {
      if (token) return json({ value: [], "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/big/messages/delta?$deltatoken=big-t${deltaCalls.length}` });
      if (!skip) {
        return json({
          value: [message("big-1", "big")],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/big/messages/delta?$skiptoken=big-p2",
        });
      }
      if (failSecondPageOnce) {
        failSecondPageOnce = false;
        return json({ error: { code: "InternalServerError", message: "broke" } }, 500);
      }
      return json({
        value: [message("big-2", "big")],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/big/messages/delta?$deltatoken=big-done",
      });
    }
    if (folder === "arch" && failArchiveOnce) {
      failArchiveOnce = false;
      // A 500, which the Graph client does not retry, so the pass fails at once.
      return json({ error: { code: "InternalServerError", message: "broke" } }, 500);
    }
    if (folder === "inbox" && token && expireInboxOnce) {
      expireInboxOnce = false;
      return json({ error: { code: "SyncStateNotFound", message: "gone" } }, 410);
    }
    if (folder === "inbox" && token && arriveMovedOnce) {
      arriveMovedOnce = false;
      return json({
        value: [message("arch-1-moved", "inbox")],
        "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=inbox-t${deltaCalls.length}`,
      });
    }
    if (folder === "inbox" && token && removeInboxOnce) {
      removeInboxOnce = false;
      return json({
        value: [{ id: "inbox-1", "@removed": { reason: "deleted" } }],
        "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=inbox-t${deltaCalls.length}`,
      });
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
    if (Date.now() > deadline) throw new Error(`waited in vain for ${what}\nstates: ${JSON.stringify(states.map((s) => [s.folder, s.phase, s.fullSyncDone, s.lastError?.slice(0, 80)]))}\ncalls: ${JSON.stringify(deltaCalls.slice(-8))}`);
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

  // Graph says a message has left the inbox: its row leaves the copy, for
  // the inbox only, since the folder it went to may already hold it.
  removeInboxOnce = true;
  const removalsBefore = removals.length;
  wakeOutlookSync(me, "inbox");
  await until(() => removals.length > removalsBefore, "the removal");
  const gone = removals[removals.length - 1];
  check("a message Graph reports gone leaves the copy", gone.ids.join(",") === "inbox-1", JSON.stringify(gone));
  check("and is taken out of the inbox only", gone.leftFolder === "INBOX", JSON.stringify(gone));

  // A message this app moved arrives under its new id: the row it had
  // before the move goes in the same step (see outlook-moves.ts).
  noteOutlookMove("arch-1", "arch-1-moved");
  arriveMovedOnce = true;
  const movesBefore = removals.length;
  wakeOutlookSync(me, "inbox");
  await until(() => removals.length > movesBefore, "the moved row's removal");
  check("a moved message's old row goes when it arrives under its new id", removals[removals.length - 1].ids.join(",") === "arch-1", JSON.stringify(removals[removals.length - 1]));
  check("and the new row is in the copy", upserts.some((r) => r.messageId === "arch-1-moved"));

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
  check("and the stop keeps the count, though the store replaces the row", overall().fullSyncTotal === 3 && overall().fullSyncDone === 3, overall());
  check("a complete read that is stopped has no first-read line", firstReadLines(states).length === 0, firstReadLines(states));

  // A new sitting on a mailbox that was read to the end: no first read, no bar.
  const fullsBeforeRestart = fullAnnouncements;
  const callsBeforeRestart = deltaCalls.length;
  check("a stopped worker can start again", startOutlookSync(me) === true);
  await until(() => overall()?.phase === "live" && deltaCalls.length >= callsBeforeRestart + 2, "the first pass of the new sitting");
  check("a start on a complete mailbox does not announce a first read", fullAnnouncements === fullsBeforeRestart, fullAnnouncements);
  check("and asks each folder from where it left off", deltaCalls.slice(callsBeforeRestart).every((c) => c.token != null), deltaCalls.slice(callsBeforeRestart));
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
  check("a complete read has a count equal to its total", overall().fullSyncDone === overall().fullSyncTotal, overall());
  await stopOutlookSync(me);

  /*
    A big folder, cut short in the middle. What a computer did with a
    mailbox of fifty thousand messages: the read ran until something ended it, and
    the next one began the same folder again from its first message, with
    the bar back at nought. A folder that takes longer than the app stays
    open was never finished.
  */
  {
  states.length = 0;
  lastOverallPhase = null;
  deltaCalls.length = 0;
  upserts.length = 0;
  // A second mailbox: the folder list of the first is kept for half a
  // minute, and would not show a folder added now.
  const big = "big@outlook.example";
  rememberOutlookAccessToken(big, "tok");
  const overall = () => states.find((s) => s.account === big && s.folder === "");
  FOLDERS.push({ id: "big", displayName: "Big", wellKnownName: undefined, count: 2 });
  failSecondPageOnce = true;
  check("a worker starts on the mailbox with the big folder", startOutlookSync(big) === true);
  await until(() => overall()?.phase === "paused", "the pause in the middle of the big folder");
  const kept = states.find((s) => s.folder === "big");
  check(
    "the place in the folder is kept when the read is cut short",
    kept?.phase === "reading" && /skiptoken=big-p2/.test(kept?.deltaLink ?? ""),
    kept
  );
  check(
    "and the pause keeps the count of what was read, though the store replaces the row",
    overall().phase === "paused" && (overall().fullSyncDone ?? 0) >= 1 && (overall().fullSyncTotal ?? 0) >= 1,
    overall()
  );
  const doneAtPause = overall().fullSyncDone;
  const atPause = firstReadLines(states);
  check(
    "the list has a line for the paused read, with the count and the state",
    atPause.length === 1 && atPause[0].state === "waiting" && atPause[0].done === doneAtPause && atPause[0].total >= atPause[0].done,
    atPause
  );
  // The app is closed in the middle of the read, and opened again.
  await stopOutlookSync(big);
  const atStop = firstReadLines(states);
  check(
    "a stop in the middle of the read keeps the line, and says stopped",
    atStop.length === 1 && atStop[0].state === "stopped" && atStop[0].done === doneAtPause,
    { atStop, overall: overall() }
  );
  check("a worker starts again on the mailbox", startOutlookSync(big) === true);
  // A new sign-in token arrives while the read is paused, as it does every
  // hour of a read that takes several.
  rememberOutlookAccessToken(big, "tok-2");
  const callsAtPause = deltaCalls.length;
  wakeOutlookSync(big);
  await until(() => overall()?.phase === "live", "the read taken up again");
  const bigAfter = deltaCalls.slice(callsAtPause).filter((c) => c.folder === "big");
  check(
    "the read is taken up at the kept place, and the folder's first page is not asked for again",
    bigAfter.length >= 1 && bigAfter[0].skip === "big-p2" && !bigAfter.some((c) => !c.skip && !c.token),
    bigAfter
  );
  check(
    "each page is asked for with the token of that moment, not the one the pass began with",
    bigAfter.every((c) => c.auth === "Bearer tok-2"),
    bigAfter.map((c) => c.auth)
  );
  check(
    "both messages of the folder are in the copy, each read once",
    upserts.filter((r) => r.messageId === "big-1").length === 1 && upserts.filter((r) => r.messageId === "big-2").length === 1,
    upserts.map((r) => r.messageId)
  );
  check(
    "the count goes on from where it was, and does not start again",
    (overall().fullSyncDone ?? 0) > doneAtPause,
    { atPause: doneAtPause, atEnd: overall().fullSyncDone }
  );
  check(
    "the line goes away only when the read is complete",
    firstReadLines(states).length === 0 && overall().fullSyncDone === overall().fullSyncTotal,
    { lines: firstReadLines(states), overall: overall() }
  );
  check(
    "the finished folder holds its delta link, and is no longer marked as being read",
    states.find((s) => s.folder === "big")?.phase === "live" && /deltatoken=big-done/.test(states.find((s) => s.folder === "big")?.deltaLink ?? "")
  );
  FOLDERS.pop();
  await stopOutlookSync(big);
  }
});
