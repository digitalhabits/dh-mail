/**
 * Where Download puts a file, as the reader chose it.
 *
 * Every attachment went to Downloads, and a reader who files posters in a
 * project folder moved each one by hand (Ulrik, 2026-10-20). Now Download
 * saves to the folder that is ticked in its menu; the menu lists Downloads,
 * the Desktop and the last few folders a file was saved to, and picking
 * one saves there and makes it the folder from then on. "Always ask" shows
 * the Mac's Save dialog each time; so does Save as…, or Download with ⌥.
 *
 * Kept on this computer: a folder is a place on this disk.
 */

const FOLDER_KEY = "mail-download-folder";
const RECENT_KEY = "mail-download-recent";
const ASK_KEY = "mail-download-always-ask";
/** How many folders the menu remembers beyond Downloads and the Desktop. */
const RECENT_MAX = 3;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* kept for this window only */
  }
}

/** The folder Download saves to; null for Downloads. */
export function downloadFolder(): string | null {
  return read(FOLDER_KEY) || null;
}

/** True when Download shows the Save dialog every time. */
export function alwaysAskWhereToSave(): boolean {
  return read(ASK_KEY) === "1";
}

export function setAlwaysAskWhereToSave(on: boolean): void {
  write(ASK_KEY, on ? "1" : null);
}

/** The last folders saved to, newest first. */
export function recentDownloadFolders(): string[] {
  try {
    const list = JSON.parse(read(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === "string" && f.length > 0) : [];
  } catch {
    return [];
  }
}

/** A folder a file was just saved to: first among the recent ones. */
export function rememberDownloadFolder(folder: string): void {
  const recent = [folder, ...recentDownloadFolders().filter((f) => f !== folder)].slice(0, RECENT_MAX);
  write(RECENT_KEY, JSON.stringify(recent));
}

/** Picked in the menu: the folder from now on, and remembered. Null is Downloads. */
export function chooseDownloadFolder(folder: string | null): void {
  write(FOLDER_KEY, folder);
  if (folder) rememberDownloadFolder(folder);
}

/** The folder a saved file is in. */
export function folderOfPath(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}

/** The folder's own name, for the menu: "Garden Photos". */
export function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

/** The folder written short from home: "~/Projects/Garden". */
export function folderShort(folder: string, home: string | null): string {
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}
