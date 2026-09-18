/**
 * Run every suite in this directory.
 *
 * Each `*.test.mjs` is bundled against the real source with the same aliases
 * the app is built with — `../build-aliases.mjs`, which vite.config.ts also
 * reads — and then run as plain Node. No test framework: most suites check
 * behaviour that is about tokens, paths, and bytes, and a fake browser would
 * only get in the way. The one suite named `mounted-` renders the real page
 * against happy-dom instead, so it is bundled with React rather than around
 * it. Anything about pixels and scroll is still left to a person.
 *
 *   pnpm --dir apps/mail test          all suites
 *   pnpm --dir apps/mail test connect  one, by name
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import { esbuildAliases } from "../build-aliases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");

/**
 * Values the real build takes from `.env.local`.
 *
 * Fixed here on purpose. Reading the developer's own file would put a live
 * client secret into a temp file, and would make a suite pass or fail
 * depending on whose machine it ran on.
 */
const TEST_ENV = {
  VITE_GOOGLE_CLIENT_ID: "test-google-client",
  VITE_GOOGLE_CLIENT_SECRET: "test-google-secret",
  VITE_MICROSOFT_CLIENT_ID: "test-ms-client",
};

const only = process.argv.slice(2);
const suites = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !only.length || only.some((n) => f.startsWith(n)))
  .sort();

if (!suites.length) {
  console.error(only.length ? `No suite matches ${only.join(", ")}` : "No suites found");
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "dh-mail-tests-"));
let failed = 0;

for (const suite of suites) {
  const bundle = path.join(out, suite.replace(".mjs", ".cjs"));
  // The mounted suite renders, so React rides inside its bundle; every
  // other suite never calls it, and leaving it external keeps them lean.
  const mounted = suite.startsWith("mounted-");
  await esbuild.build({
    entryPoints: [path.join(here, suite)],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "error",
    alias: {
      ...esbuildAliases(appDir),
      // A toast is not what any of these is checking.
      sonner: path.join(here, "shims/sonner.mjs"),
      // The alias list points this at a .ts file the app compiles; Node does
      // not, and it has nothing to do either way.
      "server-only": path.join(here, "shims/server-only.cjs"),
    },
    define: {
      "import.meta.env": JSON.stringify(TEST_ENV),
      // The same flavor the app ships as. The team layer is off.
      "process.env.NEXT_PUBLIC_MAIL_PRODUCT_FLAVOR": '"public"',
      "process.env.MAIL_PRODUCT_FLAVOR": '"public"',
      // React's CJS entry branches on this at require time.
      ...(mounted ? { "process.env.NODE_ENV": '"production"' } : {}),
    },
    // pg must never enter this graph at all.
    external: mounted ? ["pg"] : ["react", "react-dom", "pg"],
    // The app builds with the automatic JSX runtime (vite); components
    // written for it carry no React import of their own.
    jsx: mounted ? "automatic" : undefined,
    // The mounted page's import graph reaches image and style assets
    // (pdf.js, editor styles). None of them matter to a smoke walk.
    loader: mounted
      ? Object.fromEntries(
          [".svg", ".css", ".png", ".gif", ".webp", ".jpg", ".woff", ".woff2", ".mp3"].map(
            (ext) => [ext, "empty"]
          )
        )
      : undefined,
  });

  console.log(`\n── ${suite.replace(".test.mjs", "")}`);
  const run = spawnSync(process.execPath, [bundle], { stdio: "inherit" });
  if (run.status !== 0) failed += 1;
}

fs.rmSync(out, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} of ${suites.length} suites failed`);
  process.exit(1);
}
console.log(`\n${suites.length} suites passed`);
