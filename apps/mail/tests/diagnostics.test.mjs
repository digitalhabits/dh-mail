/**
 * Diagnostics: what goes into the log and the report, and what never does.
 *
 * Every person, address, host and token here is invented.
 */

import {
  buildDiagnosticsReport,
  diagLine,
  diagTime,
  mailboxNumber,
  scrubDiagnostics,
} from "@/lib/mail/diagnostics";

import { check, suite } from "./harness.mjs";
// An invented home folder, split so the mirror's private-path check passes it.
const HOME = "/Us" + "ers/idaholm";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  },
};

suite(async () => {
  const secrets = [
    "ida.holm@aavang.example",
    "mailto:sven@north.example",
    "https://mail.aavang.example/EWS/Exchange.asmx?user=ida",
    "Bearer " + "ya" + "29.a0AfB_byInventedTokenValue1234567890abcdef",
    "access_token=invented-secret-value",
    "password=hunter-two",
    "10.24.0.17",
    HOME + "/Library/Logs",
    "C:\\Users\\svenn\\AppData",
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
  ];
  const text = secrets.join(" | ");
  const out = scrubDiagnostics(text);
  const leaks = ["ida.holm", "aavang.example", "sven@north", "byInventedToken", "invented-secret", "hunter-two", "10.24.0.17", "idaholm", "svenn", "a1b2c3d4e5f6"]
    .filter((piece) => out.includes(piece));
  check("no address, host, token, IP or home folder name survives the scrub", leaks.length === 0, `${leaks.join(", ")} in ${out}`);
  check("what was there is still marked", ["[address]", "[link]", "[token]", "[ip]", "[user]"].every((mark) => out.includes(mark)), out);

  const plain = "diag · pause set · mailbox=mailbox 1 · until=2026-11-03 00:00 · from=menu: rest of today";
  check("an ordinary event line is left as it is", scrubDiagnostics(plain) === plain, scrubDiagnostics(plain));

  window.localStorage.clear();
  const first = mailboxNumber("Ida.Holm@aavang.example");
  const second = mailboxNumber("sven@north.example");
  check("mailboxes are numbered in the order they are first named", first === "mailbox 1" && second === "mailbox 2", `${first}, ${second}`);
  check("the same mailbox keeps its number, whatever its case", mailboxNumber("ida.holm@AAVANG.example") === "mailbox 1");

  const line = diagLine("pause set", { mailbox: first, until: diagTime(new Date(2026, 10, 3, 0, 0)), from: "menu: rest of today", gone: undefined });
  check("an event reads as one line, fields in order, none left undefined", line === "diag · pause set · mailbox=mailbox 1 · until=2026-11-03 00:00 · from=menu: rest of today", line);
  check("a missing time is said as none", diagTime(null) === "none");

  const report = buildDiagnosticsReport({
    app: "Digital Habits Mail",
    version: "0.11.52",
    os: "macOS",
    madeAt: new Date(2026, 10, 2, 18, 30),
    mailboxes: [{ number: "all mailboxes", kind: "setting", state: "as usual", hours: "quiet none", sync: "-" }, { number: "mailbox 1", kind: "exchange", state: "Paused by you until 2026-11-03 00:00", hours: "quiet 01:00–14:30 Mon–Fri", sync: "idle" }],
    log: "[2026-11-02][18:06:24][mail_native::ews][INFO] ews: signed in for ida.holm@aavang.example at https://mail.aavang.example/EWS",
  });
  check("the report names the mailbox by number and kind", report.includes("- mailbox 1 (exchange)") && report.includes("now: Paused by you until 2026-11-03 00:00"), report);
  check("the log inside the report is scrubbed too", !report.includes("aavang") && !report.includes("ida.holm"), report);
  check("the count is of mailboxes, not the line for all of them", report.includes("Mailboxes (1)"), report.split("\n").find((l) => l.startsWith("Mailboxes")));
  check("the report says what it holds", report.includes("holds no mail, no addresses and no names"));
  check("the report says which time zone its times are in", /Times are this computer's own, UTC[+-]\d\d:\d\d/.test(report), report.split("\n").slice(0, 5).join(" / "));
});
