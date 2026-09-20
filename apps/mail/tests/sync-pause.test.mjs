/**
 * A paused sync is explained in the reader's terms.
 *
 * The worker's reasons are written for a developer. The list sorts them into
 * a lost connection (nothing to do), a sign-in Google no longer accepts
 * (Reconnect), and anything else, and says each in plain words.
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import { syncPauseKind } from "@/lib/mail/sync-pause";

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
    syncPauseKind("token refresh failed (500): internal_failure") === "other"
  );
  check("no reason at all is other", syncPauseKind(null) === "other" && syncPauseKind("  ") === "other");

  const line = `${mailSay("syncOffline", { account: "vera@vaerksted.example" })} · ${mailSay("syncOfflineHelp")}`;
  check("the offline line names the mailbox", line.includes("vera@vaerksted.example") && !line.includes("{"), line);
  check("and does not repeat the worker's words", !/token|request|url|oauth/i.test(line), line);
  check("and says Mail tries again by itself", /tries again/i.test(line), line);
  // A reader with working internet was told to check that they were online.
  check("and does not tell the reader to check that they are online", !/check that/i.test(line), line);

  const details = mailSay("syncPausedDetails", { reason: "store: disk full" });
  check("the details line carries the reason", details.includes("store: disk full") && !details.includes("{"), details);
});
