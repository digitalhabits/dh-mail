/**
 * An invite whose text the local copy kept draws at once.
 *
 * The card fetched the invite file from the server every time a message
 * was first shown, and showed an empty bar for a few seconds while it did
 * (2026-10-19). The copy now keeps a small invite's text with the body;
 * the card draws from that and fetches nothing. Renders the real card.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { setMailApiTransport } = await import("@/lib/mail/api");
  const { MessageCalendarInvite } = await import("@/components/mail/CalendarInviteCard");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "SUMMARY:Planning chat",
    "DTSTART:20261023T120000Z",
    "DTEND:20261023T123000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const asked = [];
  setMailApiTransport(async (path) => {
    asked.push(path);
    return new Response(path.includes("/api/mail/attachment") ? ics : "{}", { status: 200 });
  });

  async function draw(attachment) {
    asked.length = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      React.createElement(MessageCalendarInvite, {
        account: "me@mail.example",
        messageId: "m1",
        attachments: [attachment],
      })
    );
    await sleep(60);
    const text = host.textContent ?? "";
    root.unmount();
    host.remove();
    return text;
  }

  const base = { attachmentId: "imap:2", filename: "invite.ics", mimeType: "text/calendar", size: 200 };
  const kept = await draw({ ...base, text: ics });
  check("with the kept text, the invite is drawn", kept.includes("Planning chat"), kept.slice(0, 120));
  check("and the file is not fetched", !asked.some((p) => p.includes("/api/mail/attachment")), JSON.stringify(asked));

  const fetched = await draw(base);
  check("without it, the file is fetched as before", asked.some((p) => p.includes("/api/mail/attachment")), JSON.stringify(asked));
  check("and the invite is drawn from that", fetched.includes("Planning chat"), fetched.slice(0, 120));
});
