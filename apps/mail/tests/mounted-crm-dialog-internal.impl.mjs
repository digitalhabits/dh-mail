/**
 * The walk itself — see mounted-crm-dialog-internal.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { CrmProposalHost, showCrmProposal } from "@/components/mail/CrmProposalHost";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setMailApiTransport(async () => new Response("{}", { status: 200 }));

const ORIGIN = { account: "ulla@aavang.example", threadId: "t1" };
const proposal = (id, tool, input) => ({ id, tool, input, why: "from the thread" });
const RESULT = {
  candidates: [
    { source: "organisations", recordId: "r1", recordName: "Sangkor Østerbro", via: "participant", match: "merle@sangkor.example", confidence: "high" },
  ],
  statusOptions: { organisations: ["Lead", "Talking", "Signed"] },
  dropped: [],
  courses: [{ key: "spring-2026", title: "Spring singing course", current: { food: "Sandwiches" } }],
  meetingTarget: { accountEmail: "ulla@aavang.example", calendarName: "Choir", location: null, timeZone: "Europe/Copenhagen" },
  proposals: [
    proposal("p1", "log_interaction", { source: "organisations", recordId: "r1", summary: "Talked about the spring concert", date: "2026-08-20" }),
    proposal("p2", "set_next_step", { source: "organisations", recordId: "r1", nextStep: "Send the programme by Friday" }),
    proposal("p3", "add_contact", { source: "organisations", recordId: "r1", name: "Tea Aavang", email: "tea@aavang.example", title: "Treasurer" }),
    proposal("p4", "create_record", { source: "organisations", name: "Byens Bibliotek", fields: { City: "Aarhus" }, note: "Lends the hall", nextStep: "Ask about dates" }),
    proposal("p5", "update_record", { source: "organisations", recordId: "r1", name: "Sangkor Østerbro", fields: { Phone: "+45 1234 5678" } }),
    proposal("p6", "create_task", { text: "Book the small hall" }),
    proposal("p8", "update_course", { key: "spring-2026", food: "Soup and bread at noon" }),
    proposal("p7", "create_meeting", { title: "Choir planning", start: "2026-09-01T17:00:00.000Z", durationMinutes: 45, attendeeEmails: ["merle@sangkor.example"], location: "The small hall" }),
  ],
};

const text = () => document.body.textContent || "";
const values = () => [...document.querySelectorAll("input, textarea")].map((el) => el.value);

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(React.createElement(CrmProposalHost, { onCrmChanged: () => {}, onArchive: () => {} }));
    await sleep(50);
    showCrmProposal(ORIGIN, RESULT);
    await sleep(400);
    const all = `${text()} ${values().join(" | ")}`;
    const expect = [
      ["a note to file", "Talked about the spring concert"],
      ["a next step", "Send the programme by Friday"],
      ["a contact to add", "Tea Aavang"],
      ["a record to make", "Byens Bibliotek"],
      ["its field", "Aarhus"],
      ["a field to change", "+45 1234 5678"],
      ["a task", "Book the small hall"],
      ["a meeting", "Choir planning"],
      ["the meeting's time zone", "Europe/Copenhagen"],
      ["a course change", "Soup and bread at noon"],
      ["what the course says now", "Sandwiches"],
    ];
    const missing = expect.filter(([, v]) => !all.includes(v));
    assert.equal(missing.length, 0, `each card shows its values; missing: ${missing.map(([w, v]) => `${w} (${v})`).join(", ")}\n${all.slice(0, 1500)}`);
    pass("each kind of proposal is drawn as its card, with the values it carries");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the CRM dialog walk failed:", err);
    process.exit(1);
  }
}

void main();
