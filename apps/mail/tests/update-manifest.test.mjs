/**
 * latest.json, the manifest the public app's updater reads.
 *
 * The Build workflow writes it from every signed update file in the draft
 * release. A wrong entry here is a broken update for everybody on that
 * platform, and nobody sees it until they are on the old version and stay
 * there. File names are invented, in the shape the build scripts write.
 */

import manifestTool from "../scripts/write-update-manifest.cjs";
import { check, suite } from "./harness.mjs";

const { platformsFor } = manifestTool;

const BASE = "https://example.test/releases/download/v1.2.3";
const sig = (file) => `sig of ${file}\n`;
const both = (name) => [name, `${name}.sig`];

suite(async () => {
  const all = platformsFor("1.2.3", BASE, [
    ...both("Digital-Habits-Mail_1.2.3_universal.app.tar.gz"),
    ...both("Digital-Habits-Mail_1.2.3_x64-setup.exe"),
    ...both("Digital-Habits-Mail_1.2.3_arm64-setup.exe"),
    "Digital-Habits-Mail_1.2.3_universal.dmg",
  ], sig);

  check("one universal Mac file serves both chips",
    all["darwin-aarch64"]?.url === `${BASE}/Digital-Habits-Mail_1.2.3_universal.app.tar.gz` &&
      all["darwin-x86_64"]?.url === all["darwin-aarch64"]?.url, JSON.stringify(all["darwin-x86_64"]));
  check("each Windows installer serves its own architecture",
    all["windows-x86_64"]?.url.endsWith("_x64-setup.exe") &&
      all["windows-aarch64"]?.url.endsWith("_arm64-setup.exe"));
  check("the signature is the .sig's text, trimmed",
    all["windows-x86_64"]?.signature === "sig of Digital-Habits-Mail_1.2.3_x64-setup.exe.sig");
  check("the installer-specific keys are there too",
    Boolean(all["darwin-aarch64-app"] && all["windows-aarch64-nsis"]));
  check("a disk image is not an update file", !Object.values(all).some((e) => e.url.endsWith(".dmg")));

  const old = platformsFor("1.2.3", BASE, [
    ...both("Digital-Habits-Mail_1.2.2_x64-setup.exe"),
    ...both("Digital-Habits-Mail_1.2.3_universal.app.tar.gz"),
  ], sig);
  check("a file of another version is left out", !old["windows-x86_64"], JSON.stringify(old["windows-x86_64"]));

  let threw = null;
  try {
    platformsFor("1.2.3", BASE, ["Digital-Habits-Mail_1.2.3_x64-setup.exe.sig"], sig);
  } catch (err) {
    threw = err;
  }
  check("a signature with no file beside it is refused", /has no/.test(threw?.message ?? ""), threw?.message);

  const internal = platformsFor("1.2.3", BASE, [
    ...both("Digital Habits Mail (Internal)_1.2.3_universal.app.tar.gz"),
  ], sig);
  check("the internal app's update file never goes in", Object.keys(internal).length === 0);
});
