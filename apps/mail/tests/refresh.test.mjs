import { outlookAccessTokenFor, clearOutlookAccessToken } from "@/lib/mail/outlook-inbox";
import { check, suite } from "./harness.mjs";
let calls, requests;


function harness(reply, status = 200) {
  calls = [];
  requests = [];
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      if (cmd === "oauth_token_request") {
        requests.push({ url: args.endpoint, body: new URLSearchParams(args.form) });
        return { status, body: reply };
      }
      if (cmd !== "mail_store_call") return null;
      calls.push({ op: args.op, args: args.args });
      if (args.op === "accounts.getToken") {
        return { refreshToken: "old-rt", ownerId: "local" };
      }
      return null;
    } } },
  };
  // The refresh runs through the shell for the same reason the exchange does:
  // Entra refuses a token request that carries an Origin header.
  globalThis.fetch = async () => {
    throw new Error("a refresh must not go through fetch");
  };
}

suite(async () => {
  // ---- Rotation ------------------------------------------------------------
  // Microsoft hands back a new refresh token on most refreshes and retires the
  // old one soon after. Dropping it makes the mailbox fail days later, with
  // nothing in the app to connect the failure to.
  harness({ access_token: "at-1", refresh_token: "new-rt" });
  let token = await outlookAccessTokenFor("me@outlook.com");
  check("it answers the access token", token === "at-1", token);

  const written = calls.find((c) => c.op === "accounts.replaceToken");
  check("the rotated refresh token is written back, or the mailbox dies later",
    written?.args.refreshToken === "new-rt" && written?.args.provider === "outlook",
    JSON.stringify(written?.args));
  check("it is written to the owner row the old token came from",
    written?.args.ownerId === "local", written?.args.ownerId);

  check("the refresh sends no client secret, which Entra refuses from a public client",
    !requests[0].body.has("client_secret"));
  check("the refresh names the scopes, or Entra narrows the grant",
    (requests[0].body.get("scope") ?? "").includes("Contacts.Read"),
    requests[0].body.get("scope"));
  check("it refreshes with the stored token", requests[0].body.get("refresh_token") === "old-rt");

  // ---- No rotation ---------------------------------------------------------
  clearOutlookAccessToken("me@outlook.com");
  harness({ access_token: "at-2" });
  await outlookAccessTokenFor("me@outlook.com");
  check("a reply with no new refresh token writes nothing, and keeps the old one",
    !calls.some((c) => c.op === "accounts.replaceToken"),
    calls.map((c) => c.op).join(","));

  // ---- The cache -----------------------------------------------------------
  harness({ access_token: "never-asked-for" });
  const cached = await outlookAccessTokenFor("me@outlook.com");
  check("a second call inside the hour reuses the token instead of refreshing",
    cached === "at-2" && requests.length === 0, `${cached}, ${requests.length} requests`);

  clearOutlookAccessToken("me@outlook.com");
  harness({ access_token: "at-3" });
  check("clearing the cache makes the next call refresh, so a reconnect takes effect",
    (await outlookAccessTokenFor("me@outlook.com")) === "at-3");

  // ---- A refused grant -----------------------------------------------------
  clearOutlookAccessToken("me@outlook.com");
  harness({ error: "invalid_grant", error_description: "AADSTS700082: token expired" }, 400);
  const err = await outlookAccessTokenFor("me@outlook.com").then(() => null, (e) => e.message);
  // The banner matches on this word. Any other wording reads as a network
  // fault, and the app would tell nobody to sign in again.
  check("a refused grant says invalid_grant, which is what marks a reconnect",
    /invalid_grant/.test(err ?? ""), err);
  check("nothing is cached from a failed refresh",
    !calls.some((c) => c.op === "accounts.replaceToken"));
});
