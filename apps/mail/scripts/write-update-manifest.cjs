#!/usr/bin/env node
/**
 * Print latest.json, the manifest the public app's updater reads
 * (team_update.rs in mail-native, `start_public`), for the signed update
 * files in a directory.
 *
 *   node apps/mail/scripts/write-update-manifest.cjs 0.11.6 \
 *     https://github.com/digitalhabits/dh-mail/releases/download/v0.11.6 files > files/latest.json
 *
 * The Build workflow runs it in the release job, over every .sig the draft
 * release holds, so a run for one platform does not drop the other's.
 *
 *   Digital-Habits-Mail_<version>_universal.app.tar.gz(.sig)
 *       macOS, both chips: one universal app.
 *   Digital-Habits-Mail_<version>_<x64|arm64>-setup.exe(.sig)
 *       Windows, one installer per architecture.
 *
 * A file of another version is not taken: its address would name a file
 * this release does not have.
 */

const fs = require("node:fs");
const path = require("node:path");

/** The update files a release holds, and the platform keys each serves. */
function platformsFor(version, baseUrl, files, readSig) {
  const v = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const MAC = new RegExp(`^Digital-Habits-Mail_${v}_(universal|aarch64|x86_64)\\.app\\.tar\\.gz\\.sig$`);
  const WIN = new RegExp(`^Digital-Habits-Mail_${v}_(x64|arm64)-setup\\.exe\\.sig$`);
  const base = baseUrl.replace(/\/$/, "");
  const platforms = {};
  for (const file of [...files].sort()) {
    const target = file.slice(0, -".sig".length);
    const mac = MAC.exec(file);
    const win = WIN.exec(file);
    if (!mac && !win) continue;
    if (!files.includes(target)) {
      throw new Error(`${file} has no ${target} beside it`);
    }
    const entry = { signature: readSig(file).trim(), url: `${base}/${target}` };
    if (mac) {
      const arches = mac[1] === "universal" ? ["aarch64", "x86_64"] : [mac[1]];
      for (const arch of arches) {
        // A single-chip file wins over the universal one for its chip.
        if (mac[1] === "universal" && platforms[`darwin-${arch}`]) continue;
        platforms[`darwin-${arch}`] = entry;
        platforms[`darwin-${arch}-app`] = entry;
      }
    } else {
      const arch = win[1] === "x64" ? "x86_64" : "aarch64";
      platforms[`windows-${arch}`] = entry;
      platforms[`windows-${arch}-nsis`] = entry;
    }
  }
  return platforms;
}

function manifest(version, baseUrl, dir, now = new Date(), notes = "") {
  const files = fs.readdirSync(dir);
  const platforms = platformsFor(version, baseUrl, files, (f) =>
    fs.readFileSync(path.join(dir, f), "utf8")
  );
  if (!Object.keys(platforms).length) {
    throw new Error(`no signed update file for ${version} in ${dir}`);
  }
  return {
    version,
    // The release's own notes (RELEASE_NOTES.md), or the name alone.
    notes: notes.trim() || `Digital Habits: Mail ${version}`,
    pub_date: now.toISOString(),
    platforms,
  };
}

module.exports = { platformsFor, manifest };

if (require.main === module) {
  const [version, baseUrl, dir, notesFile] = process.argv.slice(2);
  if (!version || !baseUrl || !dir) {
    console.error("usage: write-update-manifest.cjs <version> <download-base-url> <directory>");
    process.exit(1);
  }
  try {
    const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : "";
    process.stdout.write(`${JSON.stringify(manifest(version, baseUrl, dir, new Date(), notes), null, 2)}\n`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
