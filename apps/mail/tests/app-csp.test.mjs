/**
 * The policy on the app's own page.
 *
 * The page that holds the Tauri bridge had none, so anything that reached
 * the document could call the bridge. It has one now, and this suite reads
 * it. What is checked is not the words of the policy but the things the app
 * has to be able to do under it: a wrong policy here does not crash, it
 * takes one feature away quietly.
 *
 * The reading frame is the case to watch. A `srcdoc` frame inherits the
 * policy of the page that made it, and a resource must pass both. Measured
 * in WebKit on 2026-09-20: under `script-src 'self'` alone the frame's own
 * hash-pinned bridge is refused, and every link in every message stops
 * working, with nothing on screen to say why. So the app policy must name
 * that hash as well.
 *
 * The policy is applied by Tauri to the HTML it serves from `frontendDist`
 * (`get_asset` in the tauri crate). A dev build loads `devUrl` from Vite,
 * which Tauri does not serve, so `pnpm app:dev` is not under it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MAIL_LINK_BRIDGE_CSP_HASH } from "@/lib/mail/link-bridge";
import { MAIL_IMAGE_CSP_SOURCE } from "@/lib/mail/image-proxy";
import { GOOGLE_TOKEN_ENDPOINT } from "../src/oauth-config";

import { check, suite } from "./harness.mjs";

// From the working directory: each suite is compiled into a temp directory,
// so this file's own path leads nowhere.
const config = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")
);

const policy = config.app?.security?.csp ?? "";

/** The sources named under one directive. */
function sources(name) {
  const part = policy
    .split(";")
    .map((s) => s.trim())
    .find((s) => s === name || s.startsWith(`${name} `));
  return part ? part.slice(name.length).trim().split(/\s+/).filter(Boolean) : null;
}

const has = (name, source) => Boolean(sources(name)?.includes(source));

suite(async () => {
  check("the app page has a policy at all", policy.length > 0, policy.slice(0, 40));

  check(
    "a directive is named once, so no later copy quietly replaces an earlier",
    (() => {
      const names = policy
        .split(";")
        .map((s) => s.trim().split(/\s+/)[0])
        .filter(Boolean);
      return new Set(names).size === names.length;
    })(),
    policy
  );

  // --- What must still work -----------------------------------------------

  check(
    "the reading frame's own script is named, or links in mail go dead",
    has("script-src", `'${MAIL_LINK_BRIDGE_CSP_HASH}'`),
    sources("script-src")?.join(" ")
  );

  check(
    "the Tauri bridge can be called",
    has("connect-src", "ipc:") && has("connect-src", "http://ipc.localhost"),
    sources("connect-src")?.join(" ")
  );

  check(
    "a remote image can reach the shell's own scheme, on both systems",
    has("img-src", MAIL_IMAGE_CSP_SOURCE) &&
      has("img-src", "http://dhmail.localhost"),
    sources("img-src")?.join(" ")
  );

  check(
    "an attachment shows from its blob URL, as a picture and as a page",
    has("img-src", "blob:") && has("frame-src", "blob:"),
    `${sources("img-src")?.join(" ")} | ${sources("frame-src")?.join(" ")}`
  );

  check(
    "the PDF reader can start its worker",
    has("worker-src", "'self'"),
    sources("worker-src")?.join(" ")
  );

  check(
    "a token can be refreshed at the endpoint the app signs in with",
    has("connect-src", new URL(GOOGLE_TOKEN_ENDPOINT).origin),
    GOOGLE_TOKEN_ENDPOINT
  );

  for (const host of [
    "https://gmail.googleapis.com",
    "https://people.googleapis.com",
    "https://graph.microsoft.com",
    "https://login.microsoftonline.com",
  ]) {
    check(`the app can still reach ${host}`, has("connect-src", host));
  }

  // --- What must not ------------------------------------------------------

  for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'"]) {
    check(
      `no script may run from ${unsafe}`,
      !has("script-src", unsafe),
      sources("script-src")?.join(" ")
    );
  }

  check("no plugin may load", has("object-src", "'none'"), sources("object-src")?.join(" "));

  check(
    "a form in a message has nowhere to post to",
    has("form-action", "'none'"),
    sources("form-action")?.join(" ")
  );

  /*
    And one thing the policy does not do, said here so that nobody reads
    more into it than it gives. The app's own page needs `unsafe-inline`
    for style, because every component writes inline styles. So a sender's
    stylesheet in this document would still apply, and the guard against
    that one is the frame — see `composer-preview`.
  */
  check(
    "style is still inline, which is why a quote is shown in a frame",
    has("style-src", "'unsafe-inline'"),
    sources("style-src")?.join(" ")
  );
});
