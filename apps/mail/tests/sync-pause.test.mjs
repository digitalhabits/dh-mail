/**
 * A paused sync is explained in the reader's terms.
 *
 * The worker's reasons are written for a developer. The list sorts them into
 * a lost connection (nothing to do), a sign-in Google no longer accepts
 * (Reconnect), and anything else, and says each in plain words.
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import { longFaultSince, SERVER_FAULT_LONG_MS, syncPauseKind } from "@/lib/mail/sync-pause";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const neverReachedGoogle =
    "the token request failed: error sending request for url (https://oauth2.googleapis.com/token)";
  check(
    "a token request that never reached Google is a lost connection",
    syncPauseKind(neverReachedGoogle) === "offline",
    syncPauseKind(neverReachedGoogle)
  );

  const drops = "connection reset by peer — reconnecting";
  check(
    "drops that keep happening are a lost connection, not a sign-in",
    syncPauseKind(drops) === "offline",
    syncPauseKind(drops)
  );
  check("a timed-out read is a lost connection", syncPauseKind("read timed out") === "offline");
  // The Outlook worker runs in the web view, which has its own words for it.
  for (const reason of ["Failed to fetch", "TypeError: Load failed", "NetworkError when attempting to fetch resource."]) {
    check(`a web view's "${reason}" is a lost connection`, syncPauseKind(reason) === "offline", syncPauseKind(reason));
  }
  for (const reason of [
    "connection: could not reach imap.gmail.com:993 (Operation timed out) — reconnecting",
    "the server did not answer in time — reconnecting",
  ]) {
    check(`"${reason.slice(0, 40)}…" is a lost connection`, syncPauseKind(reason) === "offline", syncPauseKind(reason));
  }

  for (const reason of [
    "needs reconnect: the grant was revoked or expired",
    "needs reconnect: no refresh token stored",
    "needs reconnect: the grant does not allow full access to the mailbox — connect again and tick every permission",
    "token refresh failed (400): invalid_grant",
  ]) {
    check(`"${reason.slice(0, 40)}…" asks for Reconnect`, syncPauseKind(reason) === "signIn", syncPauseKind(reason));
  }

  check(
    "a refusal that is neither is other",
    syncPauseKind("token refresh failed (403): access_denied") === "other"
  );
  // A 500 was "other" here until 2026-11-13: it is the provider's own fault.
  check(
    "a 500 from the sign-in service is the server's fault",
    syncPauseKind("token refresh failed (500): internal_failure") === "server"
  );
  check("no reason at all is other", syncPauseKind(null) === "other" && syncPauseKind("  ") === "other");

  // The provider is the mailbox's own — see sync-notice-provider.
  const line = `${mailSay("syncOffline", { provider: "Gmail", account: "vera@vaerksted.example" })} · ${mailSay("syncOfflineHelp")}`;
  check("the offline line names the mailbox", line.includes("vera@vaerksted.example") && !line.includes("{"), line);
  check("and does not repeat the worker's words", !/token|request|url|oauth/i.test(line), line);
  check("and says Mail tries again by itself", /tries again/i.test(line), line);
  // A reader with working internet was told to check that they were online.
  check("and does not tell the reader to check that they are online", !/check that/i.test(line), line);

  const details = mailSay("syncPausedDetails", { reason: "store: disk full" });
  check("the details line carries the reason", details.includes("store: disk full") && !details.includes("{"), details);

  // The provider's own fault: nothing for the reader to mend, and no Reconnect.
  const graph502 =
    'Graph GET /me/mailFolders?$top=100 failed (502): {"error":{"code":"UnknownError","message":""}}';
  check("a 502 from the provider is the server's fault", syncPauseKind(graph502) === "server", syncPauseKind(graph502));
  check("so are a 500, a 503 and a 504", ["500", "503", "504"].every((code) => syncPauseKind(`Gmail GET /labels failed (${code}): busy`) === "server"));
  check("a 400 or a 404 is not", syncPauseKind("Graph GET /me failed (404): gone") === "other" && syncPauseKind("Graph POST /x failed (400): bad") === "other");
  check("a refused sign-in with a 5xx in its words is still a sign-in", syncPauseKind("token refresh failed (502): invalid_grant") === "signIn");

  // A fault at the mail server that lasts: the notice says since when.
  const NOW = Date.UTC(2026, 10, 13, 8, 0);
  check("a fault of a few minutes says no time", longFaultSince(NOW - 5 * 60_000, NOW) === null);
  check("a fault of half an hour or more says when the mailbox last synced", longFaultSince(NOW - SERVER_FAULT_LONG_MS, NOW) === NOW - SERVER_FAULT_LONG_MS && longFaultSince(NOW - 14 * 3_600_000, NOW) === NOW - 14 * 3_600_000);
  check("a mailbox with no known last sync says no time", longFaultSince(null, NOW) === null && longFaultSince(undefined, NOW) === null && longFaultSince(0, NOW) === null);
  const since = mailSay("syncServerFaultSince", { time: "Thu 18:29" });
  check("the line names the time", since.includes("Thu 18:29") && !since.includes("{"), since);
  check("the help no longer says there is nothing to do", !mailSay("syncServerFaultHelp").includes("anything"));
});
