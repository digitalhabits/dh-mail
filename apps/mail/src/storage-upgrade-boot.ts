/**
 * Runs the storage upgrade steps when this module loads.
 *
 * main.tsx imports this module first. Imports run in order, so the steps
 * run before any other module of the app loads and reads a setting.
 */

import { runStorageUpgrades } from "@/lib/mail/storage-upgrade";

runStorageUpgrades();
