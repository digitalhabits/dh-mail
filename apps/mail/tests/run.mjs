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
 *
 * The suites in `internal/` check the internal flavor's own parts. They are
 * bundled with that flavor's aliases (`src/internal/build-flavor.mjs`). A
 * copy of this app without that directory runs the others.
 *
 * Every suite is bundled first, and then the suites run side by side, one
 * per core less one (TEST_JOBS sets another number; TEST_JOBS=1 runs them
 * one at a time). They can: each
 * runs in its own process with its own fakes, and none opens a port or
 * writes a shared file. Each suite's output is printed whole, in name
 * order, so a run reads the same however the work was shared out.
 */

import { spawn } from "node:child_process";
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
const internalDir = path.join(here, "internal");
const listSuites = (dir, prefix) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => prefix + f)
    : [];
const suites = [...listSuites(here, ""), ...listSuites(internalDir, "internal/")]
  .filter((f) => !only.length || only.some((n) => f.startsWith(n) || f.startsWith(`internal/${n}`)))
  .sort();

if (!suites.length) {
  console.error(only.length ? `No suite matches ${only.join(", ")}` : "No suites found");
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "dh-mail-tests-"));
fs.mkdirSync(path.join(out, "internal"));

/**
 * The aliases the suites in `internal/` are bundled with: that flavor's own
 * seams first, and then the app's. Its build file says which. A copy of
 * this app without that directory has no such suites.
 */
const internalOverrides = suites.some((s) => s.startsWith("internal/"))
  ? (await import(path.join(appDir, "src/internal/build-flavor.mjs"))).flavorTestAliases(appDir)
  : [];
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || os.availableParallelism() - 1);

/** Bundle one suite. Answers the bundle's path. */
async function buildSuite(suite) {
  const bundle = path.join(out, suite.replace(".mjs", ".cjs"));
  // The mounted suite renders, so React rides inside its bundle; every
  // other suite never calls it, and leaving it external keeps them lean.
  const name = path.basename(suite);
  const mounted = name.startsWith("mounted-");
  const flavor = suite.includes("-internal") ? "internal" : "public";
  const overrides = suite.startsWith("internal/") ? internalOverrides : [];
  await esbuild.build({
    entryPoints: [path.join(here, suite)],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "error",
    alias: {
      ...esbuildAliases(appDir, { overrides }),
      // A toast is not what any of these is checking.
      sonner: path.join(here, "shims/sonner.mjs"),
      // The alias list points this at a .ts file the app compiles; Node does
      // not, and it has nothing to do either way.
      "server-only": path.join(here, "shims/server-only.cjs"),
    },
    define: {
      "import.meta.env": JSON.stringify(TEST_ENV),
      // The same flavor the app ships as: the team layer is off. A
      // suite with "-internal" in its name is built as the team's app, so
      // what only the team build draws can be walked too.
      "process.env.NEXT_PUBLIC_MAIL_PRODUCT_FLAVOR": JSON.stringify(flavor),
      "process.env.MAIL_PRODUCT_FLAVOR": JSON.stringify(flavor),
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

  return bundle;
}

/** Run one bundle, and hand back what it printed and whether it passed. */
function runBundle(bundle) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bundle], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) => resolve({ ok: code === 0, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

/** Run `work` on each item, `jobs` at a time. */
async function inPool(items, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i], i);
      }
    })
  );
}

/*
  Every suite is bundled first, and only then does any suite run.

  The mounted suites walk the real page with fixed waits between steps (900
  ms for the first draw, 300 ms after a click). A mounted bundle is some
  130,000 lines, and esbuild uses every core to make one. When bundles were
  made while other suites ran, a walk could be starved past its waits, and
  a suite such as mounted-composer-send or mounted-two-mailboxes failed in
  a full run and passed alone. With the bundles made first, the runs share
  the machine only with each other.

  Then a few workers take the next suite from the list until it is empty.
  The results are printed in name order as soon as every suite before them
  has finished, so the output does not interleave.
*/
const results = new Array(suites.length);
const bundles = new Array(suites.length);
let printed = 0;
let failed = 0;
const printReady = () => {
  while (printed < suites.length && results[printed]) {
    const { ok, output } = results[printed];
    console.log(`\n── ${suites[printed].replace(".test.mjs", "")}`);
    if (output) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    if (!ok) failed += 1;
    printed += 1;
  }
};
await inPool(suites, async (suite, i) => {
  try {
    bundles[i] = await buildSuite(suite);
  } catch (err) {
    results[i] = { ok: false, output: `the suite could not be built: ${err?.stack || err}` };
  }
});
await inPool(suites, async (_suite, i) => {
  if (!results[i]) {
    try {
      results[i] = await runBundle(bundles[i]);
    } catch (err) {
      results[i] = { ok: false, output: `the suite could not be run: ${err?.stack || err}` };
    }
  }
  printReady();
});

fs.rmSync(out, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} of ${suites.length} suites failed`);
  process.exit(1);
}
console.log(`\n${suites.length} suites passed`);
