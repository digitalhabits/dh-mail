import path from "node:path";

/**
 * The `@/*` aliases for the standalone build, in order.
 *
 * Matching is by prefix and the first hit wins, so the specific entries come
 * before the general ones.
 *
 * **Both the build and the tests read this list.** They have to: a test that
 * resolves a module differently from the build is checking a program that does
 * not ship. That is not hypothetical here — the typecheck and the bundler
 * disagreed about these very modules until August 2026, and the typecheck was
 * the one reading files nobody ran.
 *
 * The list mirrors the tsconfig path fallback, with the seams pointed at local
 * files. A missing entry shows up as a build failure naming the module, which
 * is the signal you want.
 *
 * `overrides` come first, so they win. A build that points a seam at a module
 * of its own passes it here. This app passes none.
 *
 * @param {string} appDir
 * @param {{ overrides?: { find: string; replacement: string }[] }} [options]
 */
export function mailAliases(appDir, { overrides = [] } = {}) {
  const root = path.resolve(appDir, "../..");
  const mailPkg = path.resolve(root, "products/mail/packages/mail");
  const shared = path.resolve(root, "packages/shared");
  const seams = path.resolve(appDir, "src/seams");

  return [
    ...overrides,
    // The guard for Next's server/client split has nothing to guard here.
    { find: "server-only", replacement: path.resolve(seams, "server-only.ts") },
    // Nor is there a framework to load components with.
    { find: "next/dynamic", replacement: path.resolve(seams, "next-dynamic.tsx") },
    // The team's records, which this app does not have: every answer is
    // "none", and People come from the reader's address books.
    { find: "@/lib/mail/team-records", replacement: path.resolve(seams, "no-team-records.ts") },
    // Parts that a build can add to the interface, and to the app around
    // it. This app adds none: each stand-in draws nothing and does nothing.
    { find: "@/components/mail/team-layer", replacement: path.resolve(seams, "no-team-layer.tsx") },
    { find: "@/team-shell", replacement: path.resolve(seams, "no-team-shell.ts") },
    { find: "@/lib/mail/i18n-team", replacement: path.resolve(seams, "no-i18n-team.ts") },

    // Seams: what this product does differently from a server host.
    { find: "@/lib/mail-router", replacement: path.resolve(seams, "mail-router.ts") },
    { find: "@/lib/page-snapshot-cache", replacement: path.resolve(seams, "page-snapshot-cache.ts") },
    // Keeps Postgres out of the graph entirely.
    { find: "@/lib/mail/store/types", replacement: path.resolve(mailPkg, "lib/mail/store/types.ts") },
    { find: "@/lib/mail/store/tauri", replacement: path.resolve(mailPkg, "lib/mail/store/tauri/index.ts") },
    { find: "@/lib/mail/store", replacement: path.resolve(seams, "store.ts") },
    // Attachments are read through the transport and shown as blob URLs; a
    // raw <img src="/api/..."> has nothing to answer it here.
    { find: "@/lib/mail/attachment-source", replacement: path.resolve(seams, "attachment-source.ts") },
    // Text out of a PDF, with pdf.js in the webview.
    { find: "@/lib/mail/attachment-text", replacement: path.resolve(seams, "attachment-text.ts") },
    // Remote images go to the shell's own scheme, not to a proxy route.
    { find: "@/lib/mail/image-proxy", replacement: path.resolve(seams, "image-proxy.ts") },

    // Token refresh uses this app's own public client, not a server's.
    { find: "@/lib/gmail/oauth", replacement: path.resolve(seams, "gmail-oauth.ts") },
    { find: "@/lib/outlook/oauth", replacement: path.resolve(seams, "outlook-oauth.ts") },
    // Signing in runs here, with PKCE, instead of on an OAuth route.
    { find: "@/lib/mail/connect-mailbox", replacement: path.resolve(seams, "connect-mailbox.ts") },

    // The desktop bridge is real here.
    { find: "@/lib/native-shell", replacement: path.resolve(appDir, "lib/native-shell.ts") },

    // The mail package owns these.
    { find: "@/components/mail", replacement: path.resolve(mailPkg, "components/mail") },
    { find: "@/mail.css", replacement: path.resolve(mailPkg, "mail.css") },
    { find: "@/styles", replacement: path.resolve(appDir, "styles") },
    { find: "@/lib/mail", replacement: path.resolve(mailPkg, "lib/mail") },
    { find: "@/lib/gmail", replacement: path.resolve(mailPkg, "lib/gmail") },
    { find: "@/lib/outlook", replacement: path.resolve(mailPkg, "lib/outlook") },
    { find: "@/lib/google", replacement: path.resolve(mailPkg, "lib/google") },

    // Everything else comes from the shared package.
    { find: "@/components", replacement: path.resolve(shared, "components") },
    { find: "@/lib", replacement: path.resolve(shared, "lib") },
    { find: "@", replacement: mailPkg },
  ];
}

/**
 * The same list as esbuild wants it: exact names mapped to files.
 *
 * esbuild matches an alias exactly, or as a path prefix followed by a slash,
 * which is what the bundler above does too. Insertion order is kept, so the
 * specific entries still come first. A name that comes twice keeps its first
 * file, as it does in the list above: an override wins.
 */
export function esbuildAliases(appDir, options) {
  const out = {};
  for (const { find, replacement } of mailAliases(appDir, options)) {
    if (!(find in out)) out[find] = replacement;
  }
  return out;
}
