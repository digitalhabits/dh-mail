/**
 * Every browser-storage key is defined in one file: lib/mail/storage-keys.ts.
 *
 * The browser finds a stored value by its exact name. A key that is defined
 * in a second place can get a second spelling, and a renamed key loses the
 * setting of each reader. So this suite reads the source and fails when a
 * key is defined outside the registry. It also checks the upgrade runner in
 * lib/mail/storage-upgrade.ts.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import * as registry from "@/lib/mail/storage-keys";
import { STORAGE_VERSION_KEY } from "@/lib/mail/storage-keys";
import { renameStorageKey, runStorageUpgrades, STORAGE_UPGRADE_STEPS } from "@/lib/mail/storage-upgrade";

import { check, suite } from "./harness.mjs";

const ROOT = join(process.cwd(), "../..");
const REGISTRY = "products/mail/packages/mail/lib/mail/storage-keys.ts";
const SOURCE_DIRS = ["products/mail/packages/mail", "apps/mail/src", "packages/shared/lib"];

/**
 * Constants with a *_KEY or *_PREFIX name that are NOT browser storage.
 * Each one is matched by name and value. Add one only with its reason.
 */
const NOT_BROWSER_STORAGE = [
  // The start of a Gmail label name on the team mailbox (internal/team-mailbox.ts).
  { name: "ASSIGNED_PREFIX", value: "Assigned/", why: "a Gmail label name, not a storage key" },
  // Keys in the native settings store (mailStore().settings, SQLite).
  { name: "KEY", value: "mail_own_identity", why: "native settings store" },
  { name: "DONE_KEY", value: "planner_state_imported_at", why: "native settings store" },
  { name: "KEY", value: "mail_assist_off", why: "native settings store, per account" },
  { name: "LISTS_KEY", value: "mail_contact_lists", why: "native settings store" },
  { name: "SETTINGS_KEY", value: "mail_contact_sources", why: "native settings store" },
  { name: "COPIES_KEY", value: "dh-mail-exchange-draft-copies", why: "native settings store" },
  { name: "KEY_PREFIX", value: "dh-mail-exchange-folders:", why: "native settings store, per account" },
  { name: "KEY", value: "mail_exchange_own_addresses", why: "native settings store" },
  { name: "MAIN_KEY", value: "mail_exchange_main_addresses", why: "native settings store" },
  { name: "KEY_PREFIX", value: "dh-mail-exchange-snooze:", why: "native settings store, per account" },
  { name: "LIST_ROW_SHAPE_KEY", value: "mail_list_row_shape", why: "native settings store" },
  { name: "SENDER_NAME_KEY", value: "mail_sender_name", why: "native settings store, per account" },
  { name: "SIGNATURE_KEY", value: "mail_signature", why: "native settings store, per account" },
  { name: "KEY", value: "mail_text_style", why: "native settings store, per account" },
  { name: "RECENT_KEY", value: "mail_recent_fonts", why: "native settings store" },
  // Id prefixes and record keys. They name things, not stored values.
  { name: "COMPOSE_DRAFT_KEY", value: "compose", why: "draft record key in IndexedDB" },
  { name: "IMAP_ATTACHMENT_PREFIX", value: "imap:", why: "attachment id prefix" },
  { name: "ID_PREFIX", value: "draft:", why: "scheduled draft id prefix" },
  { name: "PENDING_PREFIX", value: "pending:", why: "id of a send that is not saved yet" },
  { name: "STATE_PREFIX", value: "ext.", why: "OAuth state prefix, server only" },
];

function listSourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules") walk(full);
      } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) {
        files.push(full);
      }
    }
  };
  for (const dir of SOURCE_DIRS) {
    const full = join(ROOT, dir);
    if (existsSync(full)) walk(full);
  }
  return files;
}

/** Each `const NAME = "text"` in a file, also when the text is on the next line. */
function stringConstants(text) {
  const found = [];
  const re = /^(?:export )?const ([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`$\n]*)\2;/gm;
  for (const m of text.matchAll(re)) found.push({ name: m[1], value: m[3], index: m.index });
  return found;
}

/** The text of the first argument of each getItem / setItem / removeItem call. */
function storageCallArgs(text) {
  const args = [];
  const re = /\.(?:getItem|setItem|removeItem)\(\s*/g;
  for (const m of text.matchAll(re)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let arg = "";
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
      arg += c;
    }
    args.push({ arg: arg.trim(), line: text.slice(0, m.index).split("\n").length });
  }
  return args;
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

suite(async () => {
  // ---- (b) The registry ---------------------------------------------------

  const entries = Object.entries(registry);
  check(
    "every export of the registry is a string, so each one is a key name",
    entries.length > 0 && entries.every(([, v]) => typeof v === "string"),
    `${entries.length} keys`
  );
  const byValue = new Map();
  for (const [name, value] of entries) {
    byValue.set(value, [...(byValue.get(value) ?? []), name]);
  }
  const twice = [...byValue].filter(([, names]) => names.length > 1);
  check(
    "no two registry names hold the same key, or two settings share one value",
    twice.length === 0,
    twice.map(([v, names]) => `${v}: ${names.join(", ")}`).join("; ")
  );
  check(
    "no registry key is empty",
    entries.every(([, v]) => v.length > 0)
  );

  // ---- (a) No key is defined outside the registry ------------------------

  const files = listSourceFiles();
  check("the scan finds the source", files.length > 100, `${files.length} files`);

  const values = new Set(entries.map(([, v]) => v));
  // A short value such as ":centred" is a suffix. Its text is too common to scan for.
  const scanned = [...values].filter((v) => v.length >= 8);
  const prefixes = scanned.filter((v) => v.endsWith(":"));
  const allowed = (name, value) => NOT_BROWSER_STORAGE.some((a) => a.name === name && a.value === value);

  const copies = [];
  const literalCalls = [];
  const localKeys = [];
  const namedKeys = [];
  const allowedButStored = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === REGISTRY) continue;
    const text = readFileSync(file, "utf8");

    // A registry string, written out again.
    for (const m of text.matchAll(/(["'`])([^"'`\n]*?)\1/g)) {
      const s = m[2];
      if (values.has(s) && scanned.includes(s)) copies.push(`${rel}: "${s}"`);
      else if (prefixes.some((p) => s.startsWith(p) && !s.startsWith("${"))) copies.push(`${rel}: "${s}"`);
    }

    const consts = stringConstants(text);
    const constNames = new Set(consts.map((c) => c.name));
    const calls = storageCallArgs(text);

    for (const { arg, line } of calls) {
      // A key written in the call: "name", 'name', or `name…` with text before any ${.
      if (/^["']/.test(arg) || /^`[^$]/.test(arg)) literalCalls.push(`${rel}:${line}: ${arg}`);
      // A key from a string constant of this file.
      for (const id of arg.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (constNames.has(id)) localKeys.push(`${rel}:${line}: ${id}`);
      }
    }

    for (const c of consts) {
      if (!/(KEY|KEYS|PREFIX)/.test(c.name) || !/^[A-Z_$][A-Z0-9_$]*$/.test(c.name)) continue;
      if (!allowed(c.name, c.value)) {
        namedKeys.push(`${rel}: ${c.name} = "${c.value}"`);
      } else if (calls.some(({ arg }) => new RegExp(`\\b${c.name}\\b`).test(arg))) {
        allowedButStored.push(`${rel}: ${c.name}`);
      }
    }
  }

  check(
    "no file writes out a registry key again: it imports the name instead",
    copies.length === 0,
    copies.join("; ")
  );
  check(
    "no storage call takes a key written in the call",
    literalCalls.length === 0,
    literalCalls.join("; ")
  );
  check(
    "no storage call takes a key from a string constant of its own file",
    localKeys.length === 0,
    localKeys.join("; ")
  );
  check(
    "each *_KEY or *_PREFIX constant outside the registry is on the commented list of non-storage names",
    namedKeys.length === 0,
    namedKeys.join("; ")
  );
  check(
    "no name on that list reaches localStorage or sessionStorage",
    allowedButStored.length === 0,
    allowedButStored.join("; ")
  );
  check(
    "the list holds no registry key",
    NOT_BROWSER_STORAGE.every((a) => !values.has(a.value)),
    NOT_BROWSER_STORAGE.filter((a) => values.has(a.value)).map((a) => a.value).join(", ")
  );

  // ---- (c) The upgrade runner --------------------------------------------

  check("the shipped list of steps is empty today", STORAGE_UPGRADE_STEPS.length === 0);
  check(
    "the version key is in the registry",
    values.has(STORAGE_VERSION_KEY),
    STORAGE_VERSION_KEY
  );

  {
    const ran = [];
    const steps = [
      { version: 3, name: "third", run: () => ran.push(3) },
      { version: 1, name: "first", run: () => ran.push(1) },
      { version: 2, name: "second", run: () => ran.push(2) },
    ];
    const storage = makeStorage();
    const log = [];
    const after = runStorageUpgrades({ storage, steps, log: (m) => log.push(m) });
    check("the steps run in the order of their numbers", ran.join(",") === "1,2,3", ran.join(","));
    check(
      "the version is the number of the last step",
      after === 3 && storage.getItem(STORAGE_VERSION_KEY) === "3",
      storage.getItem(STORAGE_VERSION_KEY)
    );
    runStorageUpgrades({ storage, steps, log: (m) => log.push(m) });
    check("a second start runs no step again", ran.join(",") === "1,2,3", ran.join(","));
    check("a clean run logs nothing", log.length === 0, log.join("; "));
  }

  {
    const ran = [];
    const storage = makeStorage({ [STORAGE_VERSION_KEY]: "1" });
    runStorageUpgrades({
      storage,
      steps: [
        { version: 1, name: "old", run: () => ran.push(1) },
        { version: 2, name: "new", run: () => ran.push(2) },
      ],
      log: () => {},
    });
    check("a start after version 1 runs only the steps after it", ran.join(",") === "2", ran.join(","));
  }

  {
    const ran = [];
    const log = [];
    const storage = makeStorage();
    let threw = false;
    try {
      runStorageUpgrades({
        storage,
        steps: [
          { version: 1, name: "breaks", run: () => { throw new Error("boom"); } },
          { version: 2, name: "after", run: () => ran.push(2) },
        ],
        log: (m) => log.push(m),
      });
    } catch {
      threw = true;
    }
    check("a step that throws does not stop the app", !threw);
    check("the failure is logged with the number of the step", log.some((m) => m.includes("step 1")), log.join("; "));
    check("the steps after a failed step still run", ran.join(",") === "2", ran.join(","));
    check(
      "a failed step is not run again at each start",
      storage.getItem(STORAGE_VERSION_KEY) === "2",
      storage.getItem(STORAGE_VERSION_KEY)
    );
  }

  {
    let ran = 0;
    const steps = [{ version: 1, name: "one", run: () => ran++ }];
    let threw = false;
    let result = -1;
    try {
      result = runStorageUpgrades({ storage: null, steps });
    } catch {
      threw = true;
    }
    check("no storage: the runner does nothing and does not throw", !threw && ran === 0 && result === 0);

    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    };
    threw = false;
    try {
      result = runStorageUpgrades({ storage: broken, steps, log: () => {} });
    } catch {
      threw = true;
    }
    check("storage that throws on read: the runner stops and does not throw", !threw && ran === 0 && result === 0);

    // A window whose localStorage getter throws, as with blocked site data.
    const hadWindow = "window" in globalThis;
    const oldWindow = globalThis.window;
    globalThis.window = {};
    Object.defineProperty(globalThis.window, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
    threw = false;
    try {
      result = runStorageUpgrades({ steps });
    } catch {
      threw = true;
    }
    if (hadWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
    check("blocked site data: the runner does nothing and does not throw", !threw && ran === 0 && result === 0);

    threw = false;
    try {
      result = runStorageUpgrades({ steps });
    } catch {
      threw = true;
    }
    check("no window at all: the runner does nothing and does not throw", !threw && ran === 0 && result === 0);
  }

  {
    const storage = makeStorage({ "old-key": "a" });
    renameStorageKey(storage, "old-key", "new-key");
    check(
      "a rename copies the value to the new key, then removes the old key",
      storage.getItem("new-key") === "a" && storage.getItem("old-key") === null
    );
    const both = makeStorage({ "old-key": "a", "new-key": "b" });
    renameStorageKey(both, "old-key", "new-key");
    check(
      "a rename keeps a value that the new key already has",
      both.getItem("new-key") === "b" && both.getItem("old-key") === null
    );
    const none = makeStorage();
    renameStorageKey(none, "old-key", "new-key");
    check("a rename of a key that is not there writes nothing", none.map.size === 0);
  }
});
