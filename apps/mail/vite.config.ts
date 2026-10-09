import fs from "node:fs";
import { createRequire } from "node:module";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import { mailAliases } from "./build-aliases.mjs";

const require = createRequire(import.meta.url);
/**
 * One version, from package.json.
 *
 * The settings panel shows it, so a bug report can say which build it came
 * from. Read from the file the release is cut from rather than written out
 * again here, which is how the two come to disagree.
 */
const { version } = require("./package.json") as { version: string };

/**
 * What a flavor other than the public one adds to the build: aliases that
 * win over the public stand-ins, `define` entries, and its own dev port.
 * Read from `src/<flavor>/build-flavor.mjs`, a file that only that flavor's
 * source has. The path is made at run time, so that the typecheck does not
 * go looking for a file the public source does not have.
 */
type FlavorBuild = {
  flavorAliases: (appDir: string) => { find: string; replacement: string }[];
  flavorDefine: (env: Record<string, string>) => Record<string, string>;
  devPort: number;
};
const flavorBuildFile = (name: string) => `./src/${name}/build-flavor.mjs`;

export default defineConfig(async ({ mode }) => {
  const nodeEnv = mode === "development" ? "development" : "production";
  const devHost = process.env.TAURI_DEV_HOST;

  /**
   * The same interface can also ship inside another app's window, as a
   * pane. That build lands in the other app's frontend directory and is
   * served from `/mail/` there, so the two paths are settable. Nothing else
   * about the build changes; the pane is the standalone interface.
   */
  const outDir = process.env.MAIL_UI_OUT_DIR || "dist";
  const base = process.env.MAIL_UI_BASE || "/";
  /**
   * The flavor. "public" is this app. MAIL_FLAVOR=<name> builds another
   * flavor from the same interface, when the source has that flavor's
   * build file; without it, the build is the public app. Nothing about who
   * the reader is belongs here; see the note on `define` below.
   */
  const asked = process.env.MAIL_FLAVOR ?? "";
  const flavor =
    /^[a-z]+$/.test(asked) &&
    asked !== "public" &&
    fs.existsSync(new URL(flavorBuildFile(asked), import.meta.url))
      ? asked
      : "public";
  const flavorBuild =
    flavor !== "public"
      ? ((await import(/* @vite-ignore */ flavorBuildFile(flavor))) as FlavorBuild)
      : null;
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const flavorDefine = flavorBuild?.flavorDefine(env) ?? {};

  return {
    plugins: [react()],
    /**
     * `process` does not exist in a webview, and the mail core reads a few
     * settings from it. Replacing the whole object means an unlisted name reads
     * as undefined, which every caller already handles, instead of throwing at
     * import time and leaving a blank window.
     *
     * The flavor is public. People are filed from the address book.
     *
     * Nothing about who the reader is belongs here. A value defined at build
     * time is the *builder's*, compiled into every copy of the app: give the
     * app to someone else and it would treat your addresses as theirs. The
     * reader's own addresses are stored and read when the app starts — see
     * `src/own-identity.ts`.
     */
    define: {
      "process.env": JSON.stringify({
        NODE_ENV: nodeEnv,
        NEXT_PUBLIC_MAIL_PRODUCT_FLAVOR: flavor,
        MAIL_PRODUCT_FLAVOR: flavor,
        NEXT_PUBLIC_MAIL_APP_VERSION: version,
      }),
      ...flavorDefine,
    },
    clearScreen: false,
    // The app's dev server is :3473. Another flavor names its own port, so
    // the two can run at once and neither shows the other's flavor. A dev
    // build that must use a given port names it in MAIL_DEV_PORT.
    server: {
      port: Number(process.env.MAIL_DEV_PORT) || (flavorBuild?.devPort ?? 3473),
      strictPort: true,
      // A phone on the same network. `tauri ios dev --host` and
      // `tauri android dev --host` set this to the Mac's address, and the
      // page in the phone's webview reaches the dev server at it; the
      // hot-reload socket has to name the same address, since the default
      // is the page's own host, which on a phone is the phone.
      host: devHost || false,
      hmr: devHost ? { protocol: "ws", host: devHost, port: 3475 } : undefined,
      // Cargo's output is not the page. On Windows a watch on a DLL that
      // cargo holds open fails with EBUSY and stops the dev server.
      watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_"],
    base,
    build: { target: "esnext", outDir, emptyOutDir: true },
    // The list lives in build-aliases.mjs, because the tests read it too. A test
    // that resolves a module differently from the build checks a program that
    // does not ship.
    resolve: {
      alias: mailAliases(__dirname, {
        overrides: flavorBuild?.flavorAliases(__dirname) ?? [],
      }),
    },
  };
});
