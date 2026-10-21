/**
 * Numbered upgrade steps for the keys in browser storage.
 *
 * The keys are in `storage-keys.ts`. A key name must not change without a
 * step here: the browser finds a value by its exact name, so a renamed key
 * loses the setting of each reader.
 *
 * How it works:
 * - `STORAGE_VERSION_KEY` holds the number of the last step that ran.
 * - At start-up, `runStorageUpgrades` runs each step with a higher number,
 *   lowest number first, and writes the number after each step.
 * - Each step runs one time. The version stops it from running again.
 * - If a step throws, the runner logs the error and goes on. It also
 *   writes the number of that step. A step that fails at each start
 *   would otherwise stop all the steps after it.
 * - If there is no storage (private mode, blocked site data, no window),
 *   the runner does nothing. It does not throw.
 *
 * Rules for a step:
 * - Give it the next number. Do not change or remove a step that shipped.
 * - Make it safe to run two times, and safe to stop half-way. Each window
 *   of the app runs the runner, and two windows can start at one time.
 *   So copy a value before you remove the old key.
 * - Read and write only through the `storage` argument.
 */

import { STORAGE_VERSION_KEY } from "@/lib/mail/storage-keys";

export type StorageUpgradeStep = {
  /** 1 for the first step, then 2, 3 and so on. */
  version: number;
  /** What the step does, for the log. */
  name: string;
  run: (storage: Storage) => void;
};

/**
 * The steps, in order. There are none today.
 *
 * An example step that renames a key:
 *
 *   1. In storage-keys.ts, add the new name. Keep the old name there too,
 *      as `OLD_ZOOM_KEY`, with the comment "Old: only read by an upgrade
 *      step".
 *   2. Point the module at the new name.
 *   3. Add a step here:
 *
 *      {
 *        version: 1,
 *        name: "move the pane zoom to its new key",
 *        run: (storage) => renameStorageKey(storage, OLD_ZOOM_KEY, MAIL_ZOOM_KEY),
 *      },
 *
 * `renameStorageKey` copies the old value to the new key, then removes the
 * old key.
 */
export const STORAGE_UPGRADE_STEPS: readonly StorageUpgradeStep[] = [];

/**
 * Copy the value of `from` to `to`, then remove `from`.
 *
 * If `to` already has a value, the value stays and the old key is only
 * removed. A newer value then wins over an old one.
 */
export function renameStorageKey(storage: Storage, from: string, to: string): void {
  const value = storage.getItem(from);
  if (value === null) return;
  if (storage.getItem(to) === null) storage.setItem(to, value);
  storage.removeItem(from);
}

type Log = (message: string, error?: unknown) => void;

export type StorageUpgradeOptions = {
  /** The storage to upgrade. The default is `window.localStorage`. Null means none. */
  storage?: Storage | null;
  /** The steps to run. The default is `STORAGE_UPGRADE_STEPS`. */
  steps?: readonly StorageUpgradeStep[];
  /** Where errors go. The default is `console.warn`. */
  log?: Log;
};

const warn: Log = (message, error) => {
  console.warn(`[storage-upgrade] ${message}`, error ?? "");
};

/** The local storage of the window, or null if it is not available. */
function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // The access itself throws when site data is blocked.
    return null;
  }
}

function readVersion(storage: Storage): number | null {
  try {
    const n = Number(storage.getItem(STORAGE_VERSION_KEY) ?? "0");
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return null;
  }
}

/**
 * Run each step that did not run yet. Call it one time at start-up, before
 * any module reads a setting.
 *
 * Returns the version after the run. Returns 0 when there is no storage.
 */
export function runStorageUpgrades(options: StorageUpgradeOptions = {}): number {
  const log = options.log ?? warn;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (!storage) return 0;
  let version = readVersion(storage);
  if (version === null) return 0;

  const steps = [...(options.steps ?? STORAGE_UPGRADE_STEPS)].sort((a, b) => a.version - b.version);
  for (const step of steps) {
    if (step.version <= version) continue;
    try {
      step.run(storage);
    } catch (error) {
      log(`step ${step.version} (${step.name}) failed`, error);
    }
    version = step.version;
    try {
      storage.setItem(STORAGE_VERSION_KEY, String(version));
    } catch (error) {
      // The step runs again at the next start. Steps are safe to run two times.
      log(`could not write version ${version}`, error);
    }
  }
  return version;
}
