import { connectMailbox } from "../src/connect-mailbox";
import { connectConfigError } from "../src/oauth-config";
import { check, suite } from "./harness.mjs";

const idToken = (claims) =>
  "h." + btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_") + ".s";

function harness({ tokenReply, opened = true } = {}) {
  const seen = { authUrl: null, exchange: null, saved: null, savedProvider: null, invokes: [] };
  const status = tokenReply.error ? 400 : 200;
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      seen.invokes.push(cmd);
      if (cmd === "oauth_bind") return 45678;
      if (cmd === "oauth_await_redirect") { seen.expectedState = args.expectedState; return { code: "the-code" }; }
      if (cmd === "mail_store_call" && args.op === "accounts.save") {
        seen.saved = args.args; seen.savedProvider = args.args?.provider; return null;
      }
      if (cmd === "open_external_url") { seen.authUrl = args.url; return opened; }
      // Microsoft's exchange runs here, not through fetch: Entra refuses a
      // token request that carries an Origin header.
      if (cmd === "oauth_token_request") {
        seen.exchange = { url: args.endpoint, body: new URLSearchParams(args.form) };
        seen.exchangeViaShell = true;
        return { status, body: tokenReply };
      }
      return null;
    } } },
  };
  globalThis.fetch = async (url, init) => {
    seen.exchange = { url, body: new URLSearchParams(init.body) };
    seen.exchangeViaShell = false;
    return new Response(JSON.stringify(tokenReply), {
      status: tokenReply.error ? 400 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  return seen;
}

suite(async () => {
  // ---- Gmail, unchanged behaviour after the refactor -----------------------
  let seen = harness({ tokenReply: { refresh_token: "rt-1", id_token: idToken({ email: "Me@Example.ORG" }) } });
  let result = await connectMailbox("gmail");
  check("gmail: reports the mailbox that connected", result.email === "me@example.org", result.email);

  let auth = new URL(seen.authUrl);
  check("gmail: opens at Google with a challenge, never the verifier",
    auth.origin === "https://accounts.google.com" &&
      auth.searchParams.get("code_challenge_method") === "S256" &&
      !auth.searchParams.has("code_verifier"),
    seen.authUrl?.slice(0, 60));
  check("gmail: asks for offline access, or no refresh token comes back",
    auth.searchParams.get("access_type") === "offline" &&
      auth.searchParams.get("prompt") === "consent");
  check("gmail: redirects to the loopback port Rust bound",
    auth.searchParams.get("redirect_uri") === "http://127.0.0.1:45678",
    auth.searchParams.get("redirect_uri"));
  check("gmail: the exchange carries the verifier and the secret Google demands",
    seen.exchange.body.get("code_verifier")?.length >= 43 &&
      seen.exchange.body.get("client_secret") === "test-google-secret");
  check("gmail: the token is filed under gmail",
    seen.savedProvider === "gmail" && seen.saved?.input?.refreshToken === "rt-1",
    JSON.stringify(seen.saved?.input));

  // ---- Gmail, a grant with the full-mail box unticked ---------------------
  seen = harness({ tokenReply: {
    refresh_token: "rt-short",
    id_token: idToken({ email: "short@example.org" }),
    scope: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send openid email",
  } });
  let refused = null;
  try { await connectMailbox("gmail"); } catch (e) { refused = e; }
  check("gmail: a grant without the full-mail scope is refused, with the remedy",
    refused instanceof Error && /tick every permission/.test(refused.message),
    refused?.message);
  check("gmail: and nothing is stored for it",
    seen.saved === null, JSON.stringify(seen.saved));
  seen = harness({ tokenReply: {
    refresh_token: "rt-full",
    id_token: idToken({ email: "full@example.org" }),
    scope: "https://mail.google.com/ https://www.googleapis.com/auth/gmail.modify openid email",
  } });
  result = await connectMailbox("gmail");
  check("gmail: a grant with the full-mail scope connects",
    result.email === "full@example.org" && seen.saved?.input?.refreshToken === "rt-full");

  // ---- Outlook -------------------------------------------------------------
  seen = harness({ tokenReply: { refresh_token: "rt-2", id_token: idToken({ preferred_username: "Parent@Outlook.COM" }) } });
  result = await connectMailbox("outlook");
  check("outlook: falls back to preferred_username, which is where a personal account puts it",
    result.email === "parent@outlook.com", result.email);

  auth = new URL(seen.authUrl);
  check("outlook: opens at Microsoft with a challenge, never the verifier",
    auth.origin === "https://login.microsoftonline.com" &&
      auth.searchParams.get("code_challenge_method") === "S256" &&
      !auth.searchParams.has("code_verifier"),
    seen.authUrl?.slice(0, 60));
  check("outlook: redirects to localhost, the only loopback Entra wildcards",
    auth.searchParams.get("redirect_uri") === "http://localhost:45678",
    auth.searchParams.get("redirect_uri"));
  check("outlook: asks for offline_access, or no refresh token comes back",
    (auth.searchParams.get("scope") ?? "").includes("offline_access"));
  check("outlook: asks for Contacts.Read, or the address book stays empty",
    (auth.searchParams.get("scope") ?? "").includes("Contacts.Read"));
  check("outlook: sends one prompt value — 'select_account consent' is AADSTS90023",
    auth.searchParams.get("prompt") === "consent");
  check("outlook: sends NO client secret; Entra refuses one from a public client",
    !seen.exchange.body.has("client_secret") &&
      !JSON.stringify(seen.exchange.body.get("scope")).includes("secret"),
    seen.exchange.body.get("client_secret") ?? "absent");
  check("outlook: the exchange names the scopes, or the grant narrows",
    (seen.exchange.body.get("scope") ?? "").includes("Mail.Send"));
  // The whole reason the exchange is not a fetch. AADSTS90023 otherwise.
  check("outlook: the exchange runs outside the page, where there is no Origin",
    seen.exchangeViaShell === true);
  check("gmail: the exchange stays a fetch, which Google allows",
    (await (async () => {
      const g = harness({ tokenReply: { refresh_token: "r", id_token: idToken({ email: "a@b.com" }) } });
      await connectMailbox("gmail");
      return g.exchangeViaShell;
    })()) === false);

  seen = harness({ tokenReply: { refresh_token: "rt-2", id_token: idToken({ preferred_username: "Parent@Outlook.COM" }) } });
  await connectMailbox("outlook");
  check("outlook: the token is filed under outlook, not gmail",
    seen.savedProvider === "outlook" && seen.saved?.input?.refreshToken === "rt-2",
    seen.savedProvider);

  // The email claim wins when both are present.
  seen = harness({ tokenReply: { refresh_token: "r", id_token: idToken({ email: "work@corp.example", preferred_username: "work-upn" }) } });
  result = await connectMailbox("outlook");
  check("outlook: prefers the email claim over the sign-in name",
    result.email === "work@corp.example", result.email);

  // A work account's preferred_username is a UPN, which is not always an
  // address. Anything without an @ is not a mailbox.
  seen = harness({ tokenReply: { refresh_token: "r", id_token: idToken({ preferred_username: "not-an-address" }) } });
  let err = await connectMailbox("outlook").then(() => null, (e) => e.message);
  check("outlook: refuses a sign-in name that is not an address", /which mailbox/.test(err ?? ""), err);

  // ---- Reconnect -----------------------------------------------------------
  seen = harness({ tokenReply: { refresh_token: "r", id_token: idToken({ email: "a@b.com" }) } });
  await connectMailbox("gmail", "a@b.com");
  check("reconnect passes a login hint, so the provider offers the right account",
    new URL(seen.authUrl).searchParams.get("login_hint") === "a@b.com");

  // ---- Failures say what to do --------------------------------------------
  seen = harness({ tokenReply: { access_token: "at", id_token: idToken({ email: "a@b.com" }) } });
  err = await connectMailbox("outlook").then(() => null, (e) => e.message);
  check("outlook: no refresh token names Microsoft's consent page, not Google's",
    /account\.live\.com/.test(err ?? ""), err);

  seen = harness({ tokenReply: { access_token: "at", id_token: idToken({ email: "a@b.com" }) } });
  err = await connectMailbox("gmail").then(() => null, (e) => e.message);
  check("gmail: no refresh token names Google's permissions page",
    /myaccount\.google\.com/.test(err ?? ""), err);

  seen = harness({ tokenReply: { error: "invalid_grant", error_description: "bad code" } });
  err = await connectMailbox("outlook").then(() => null, (e) => e.message);
  check("a refused exchange reports what the provider said", err === "bad code", err);

  // ---- Config gate ---------------------------------------------------------
  check("both providers are configured in this build",
    connectConfigError("gmail") === null && connectConfigError("outlook") === null,
    `${connectConfigError("gmail")} / ${connectConfigError("outlook")}`);

  // Nothing may reach the browser before the config is known good: a user who
  // approved scopes and then hit a missing-client error would have to redo it.
  seen = harness({ tokenReply: { refresh_token: "r", id_token: idToken({ email: "a@b.com" }) } });
  await connectMailbox("gmail");
  check("the port is bound before the browser opens, so the URL can name it",
    seen.invokes.indexOf("oauth_bind") < seen.invokes.indexOf("open_external_url"),
    seen.invokes.join(","));
});
