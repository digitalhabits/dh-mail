/**
 * The app, answering itself. For screenshots.
 *
 * Every call the interface makes goes through one transport — that is the
 * whole of the seam this needs. Demo mode swaps the real one, which reaches
 * Gmail and Graph, for this, which reaches `demo/data.ts`. Not a line of the
 * interface knows the difference, so a picture taken here is a picture of
 * the app as it ships.
 *
 * Nothing signs in and nothing is stored: the mailbox is invented, and the
 * app never touches the keychain or the database in this mode. Switch it on
 * with `pnpm app:dev:demo`, or by adding `?demo=1` in the browser.
 *
 * Paths this does not know about answer `{ success: true }` with an empty
 * body. That is deliberate: the interface asks for a dozen optional things
 * (scheduled sends, chat parts, contact sources) and a screenshot needs none
 * of them, but it must not fall over for want of an answer.
 */

import {
  DEMO_ACCOUNT,
  DEMO_NAME,
  DEMO_SECOND_ACCOUNT,
  demoContacts,
  demoImage,
  demoPdf,
  demoThreadDetail,
  demoThreads,
} from "./data";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function accountRows(email: string) {
  return [
    {
      email,
      clerkUserId: "demo",
      historyId: null,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
      inMailTab: true,
    },
  ];
}

/**
 * The invented invite behind `invite.ics`.
 *
 * Thursday the 20th at 11:00 for an hour, which is the day and the hour the
 * message beside it asks for. Written out here rather than taken from a real
 * one: the mailbox in this mode is made up, and an invite carries names,
 * addresses and a meeting link.
 *
 * The date is fixed rather than worked out from today. A screenshot is worth
 * having only if it says the same thing tomorrow.
 */
function demoInviteIcs(): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Digital Habits//Demo//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:demo-studio-visit@digitalhabits.invalid",
    "DTSTAMP:20260817T090000Z",
    "DTSTART:20260820T090000Z",
    "DTEND:20260820T100000Z",
    "SUMMARY:Studio visit — Kanin Kunsthal",
    "LOCATION:Værkstedet, yard entrance",
    "DESCRIPTION:A group of six, about an hour.",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** The bytes behind an attachment: drawn or written here, never shipped. */
function attachmentBody(filename: string, mimeType: string): Response {
  if (mimeType.includes("calendar") || /\.ics$/i.test(filename)) {
    return new Response(demoInviteIcs(), {
      status: 200,
      headers: { "content-type": "text/calendar; charset=utf-8" },
    });
  }
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) {
    // A fresh buffer, because a Response wants one it owns.
    return new Response(demoPdf(filename.replace(/\.pdf$/i, "")).slice().buffer, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  }
  const seed = [...filename].reduce((n, c) => n + c.charCodeAt(0), 0);
  const png = demoImage(seed);
  if (!png) return new Response("", { status: 404 });
  return new Response(png.slice().buffer, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

/** The invented out-of-office reply. `enabled` false is the "set up" half. */
function demoAutoReply(account: string, enabled = true) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const isGmail = account === DEMO_ACCOUNT;
  return {
    account,
    provider: isGmail ? "gmail" : "outlook",
    subjectSupported: true,
    enabled,
    subject: "Away from the studio",
    bodyHtml:
      "<p>Thanks for your mail. I am away from the studio until Monday and not reading email while I am gone. I will reply when I am back.</p><p>Vera</p>",
    restrictToContacts: false,
    startTime: enabled ? start.getTime() - day : null,
    endTime: enabled ? start.getTime() + 5 * day : null,
    needsReconnect: false,
  };
}

export async function handleDemoMailApi(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(path, "http://demo.invalid");
  const q = url.searchParams;
  const threads = demoThreads();

  switch (url.pathname) {
    case "/api/mail/threads": {
      const rows = threads.map((t) => t.summary);
      const search = (q.get("q") ?? "").trim().toLowerCase();
      const found = search
        ? rows.filter((r) =>
            `${r.subject} ${r.fromName} ${r.snippet}`
              .toLowerCase()
              .includes(search)
          )
        : rows;
      return json({ success: true, threads: found, nextCursor: null });
    }

    case "/api/mail/thread": {
      const thread = demoThreadDetail(q.get("id") ?? "");
      if (!thread) return json({ error: "No such thread" });
      return json({ success: true, thread });
    }

    case "/api/mail/attachment": {
      return attachmentBody(
        q.get("filename") ?? "file",
        q.get("mimeType") ?? ""
      );
    }

    case "/api/gmail/accounts":
      return json({
        success: true,
        accounts: accountRows(DEMO_ACCOUNT),
        configError: null,
      });

    case "/api/outlook/accounts":
      return json({
        success: true,
        accounts: accountRows(DEMO_SECOND_ACCOUNT),
        configError: null,
      });

    case "/api/mail/folders":
      return json({
        success: true,
        folders: [
          /*
            The ones the provider manages, as a real mailbox reports them.
            They were left out, so the rail in this mode showed an account
            with three folders and none of the places mail actually is —
            which is not what the app looks like for anybody.

            `role` is what sorts them above the rest and draws each as
            itself; the rail puts them in its own order, so the order here
            does not matter.
          */
          { account: DEMO_ACCOUNT, name: "Inbox", count: 0, role: "inbox" },
          { account: DEMO_ACCOUNT, name: "Archive", count: 0, role: "archive" },
          { account: DEMO_ACCOUNT, name: "Drafts", count: 3, role: "drafts" },
          { account: DEMO_ACCOUNT, name: "Sent", count: 0, role: "sent" },
          { account: DEMO_ACCOUNT, name: "Junk", count: 2, role: "junk" },
          { account: DEMO_ACCOUNT, name: "Trash", count: 0, role: "trash" },
          { account: DEMO_ACCOUNT, name: "Exhibitions", count: 12 },
          { account: DEMO_ACCOUNT, name: "Suppliers", count: 5 },
          { account: DEMO_ACCOUNT, name: "Receipts", count: 31 },
        ],
      });

    case "/api/mail/contacts":
      return json({ success: true, contacts: demoContacts() });

    case "/api/mail/signature":
      return json({
        success: true,
        settings: {
          signature: `${DEMO_NAME}<br>Vinter Værksted`,
          includeByDefault: true,
        },
      });

    // The out-of-office reply, so the row under the account in Settings and
    // the dialog behind its Edit button have something to show. One account
    // is away and the other is not, which is both halves of the row. The end
    // is a few days out from today rather than a fixed date, because the row
    // only reads "Out of office" while the end is still ahead.
    case "/api/mail/autoreply": {
      const away = demoAutoReply(DEMO_ACCOUNT);
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const input = init?.body ? JSON.parse(String(init.body)) : {};
        return json({ autoReply: { ...away, ...input } });
      }
      return json({
        success: true,
        autoReplies: [away, demoAutoReply(DEMO_SECOND_ACCOUNT, false)],
      });
    }

    case "/api/mail/sender-name":
      return json({ success: true, settings: { name: DEMO_NAME } });

    // A send in demo mode goes nowhere, and says so plainly rather than
    // pretending: a screenshot of a sent message is not worth a surprise.
    case "/api/mail/send":
      return json({ error: "Demo mode — nothing is sent" });

    // The AI reply, canned. Only the internal flavor shows the button, so
    // this is for a dev run of that flavor over demo data — enough to see
    // the draft land in the box and the notes above it, with no planner.
    case "/api/mail/reply-draft":
      return json({
        ok: true,
        body: [
          "Hi Anton,",
          "",
          "thanks for the numbers — eighteen is a good problem to have.",
          "",
          "Let's take the larger room. Could you confirm it is free on the 14th, and whether it has a projector? If it does, we can leave the setup as planned. If not, I will bring [the projector we used in June].",
          "",
          "Best wishes,",
          DEMO_NAME.split(" ")[0],
        ].join("\n"),
        scenario: "ongoing",
        usedRecords: [{ source: "clients", recordId: "demo", recordName: "Asmund Presse" }],
        gaps: ["Whether the larger room has a projector, and which projector we own"],
      });

    default:
      break;
  }

  // Everything else: enough of an answer to keep the interface upright.
  const empty: Record<string, unknown> = { success: true };
  if (url.pathname.includes("contact-lists")) empty.lists = [];
  if (url.pathname.includes("contact-sources")) empty.sources = [];
  if (url.pathname.includes("autoreply")) empty.autoReplies = [];
  if (url.pathname.includes("scheduled")) empty.messages = [];
  if (url.pathname.includes("snoozed")) empty.threads = [];
  if (url.pathname.includes("chat/parts")) empty.parts = [];
  if (url.pathname.includes("drafts")) empty.drafts = [];
  void init;
  return json(empty);
}
