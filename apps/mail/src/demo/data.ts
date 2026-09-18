/**
 * A mailbox that does not exist, for screenshots.
 *
 * Every person, address, company and word here is invented. Nothing is
 * copied from a real mailbox, and nothing may be: these pictures are meant
 * to be published, and the same rule the test fixtures live under applies
 * with more force to something that ends up on a website.
 *
 * Two things make that more than an intention:
 *
 * - **Every address is on the `.example` top-level domain**, which RFC 2606
 *   reserves and nobody can register. No address here can reach or belong to
 *   a real person, ever.
 * - **Every name alliterates**, and most of them are Danish for something
 *   silly: Egon Egern is a squirrel, Jens Jordbær a strawberry, Gustav
 *   Gulerod a carrot, and the arts centre is called the Rabbit. A name that
 *   merely sounds plausible always belongs to somebody somewhere; a cast
 *   running down the alphabet in matching initials belongs to nobody, and
 *   reads in a published picture as the joke it is.
 *
 * A suite holds both of these — see tests/demo-mode.
 *
 * The dates are relative to whenever the app is started, so a screenshot
 * taken next month still says "10:12" and "Yesterday" rather than a date
 * from the day this file was written.
 */

import type {
  MailAttachment,
  MailMessage,
  MailThreadDetail,
  MailThreadSummary,
} from "@/lib/mail/types";

/** The mailbox the demo is signed in as. */
export const DEMO_ACCOUNT = "vera.vinter@vaerksted.example";
export const DEMO_SECOND_ACCOUNT = "vera.vinter@mail.example";
export const DEMO_NAME = "Vera Vinter";

/** The mailboxes the demo shows as connected. */
export const DEMO_MAILBOXES = [
  { email: DEMO_ACCOUNT, provider: "gmail" as const },
  { email: DEMO_SECOND_ACCOUNT, provider: "outlook" as const },
];

/** Minutes ago, as an ISO string. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const HOUR = 60;
const DAY = 24 * HOUR;

type Person = {
  name: string;
  email: string;
  /** What they sign off with, under their sign-off line. */
  sig?: string[];
  /** Sent from a phone, so the mail says so and the lines are short. */
  phone?: boolean;
};

/** What somebody is called in a greeting: the first word of their name. */
function firstName(p: Person): string {
  return p.name.split(" ")[0];
}

const P = {
  benny: {
    name: "Benny Björg",
    email: "benny.bjorg@papir.example",
    sig: ["Benny Björg", "Papir & Pap A/S", "Tlf. 00 00 00 00"],
  },
  caroline: {
    name: "Caroline Citron",
    email: "caroline.citron@kunst.example",
    sig: ["Caroline Citron", "Kurator"],
  },
  egon: {
    name: "Egon Egern",
    email: "egon.egern@egetrae.example",
    sig: ["Egon Egern", "Egetræ Rammeværksted", "Værkstedsvej 0, 0000 Byen"],
  },
  dorte: {
    name: "Dorte Dennis",
    email: "dorte.dennis@design.example",
    sig: ["Dorte Dennis", "Skribent og redaktør"],
  },
  anton: {
    name: "Anton Asmund",
    email: "anton.asmund@presse.example",
    sig: ["Anton Asmund", "Asmund Presse"],
  },
  ingrid: {
    name: "Ingrid Isbjørn",
    email: "ingrid.isbjorn@institut.example",
    sig: [
      "Dr Ingrid Isbjørn",
      "Institut for Isbjørneforskning",
      "Postboks 0, 0000 Byen",
    ],
  },
  kanin: { name: "Kanin Kunsthal", email: "booking@kanin.example" },
  balance: { name: "Balance Bogføring", email: "bogholder@balance.example" },
  frida: {
    name: "Frida Fisker",
    email: "frida.fisker@tekst.example",
    sig: ["Frida Fisker", "Tekst & Tolk", "Oversættelse DA/EN"],
  },
  jens: {
    name: "Jens Jordbær",
    email: "jens.jordbaer@fragt.example",
    sig: ["Jens Jordbær", "Fragt & Færge", "Tlf. 00 00 00 00"],
  },
  gustav: {
    name: "Gustav Gulerod",
    email: "gustav.gulerod@galleri.example",
    sig: ["Gustav Gulerod", "Galleri Gulerod"],
  },
  fond: { name: "Fond for Fjer", email: "fond@fjer.example" },
  papir: { name: "Papir & Pap", email: "nyt@papir.example" },
} satisfies Record<string, Person>;

const ME: Person = { name: DEMO_NAME, email: DEMO_ACCOUNT };

/** A picture, drawn rather than shipped: no file, no licence, no bytes. */
export function demoImage(
  seed: number,
  width = 900,
  height = 600
): Uint8Array | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const hue = (seed * 47) % 360;
  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${hue} 45% 78%)`);
  sky.addColorStop(1, `hsl(${(hue + 40) % 360} 35% 45%)`);
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);
  // A horizon and a few hills: enough to read as a photograph at tile size.
  g.fillStyle = `hsl(${(hue + 200) % 360} 25% 30%)`;
  g.beginPath();
  g.moveTo(0, height * 0.72);
  for (let x = 0; x <= width; x += width / 6) {
    g.lineTo(x, height * (0.6 + 0.12 * Math.sin((x + seed * 90) / 180)));
  }
  g.lineTo(width, height);
  g.lineTo(0, height);
  g.closePath();
  g.fill();
  const url = canvas.toDataURL("image/png");
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** A one-page PDF, written out by hand so no file has to ship with it. */
export function demoPdf(title: string): Uint8Array {
  const text = title.replace(/[()\\]/g, "");
  const page = `BT /F1 22 Tf 60 700 Td (${text}) Tj ET
BT /F1 12 Tf 60 660 Td (Vinter Værksted - draft for review) Tj ET
BT /F1 12 Tf 60 640 Td (This document is part of a demonstration.) Tj ET`;
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${page.length}>>stream
${page}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return new TextEncoder().encode(body);
}

const file = (
  id: string,
  filename: string,
  mimeType: string,
  size: number
): MailAttachment => ({ attachmentId: id, filename, mimeType, size });

type DemoThread = {
  summary: MailThreadSummary;
  messages: MailMessage[];
};

function message(input: {
  id: string;
  from: Person;
  to: Person[];
  cc?: Person[];
  at: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}): MailMessage {
  return {
    id: input.id,
    fromName: input.from.name,
    fromEmail: input.from.email,
    toEmails: input.to.map((p) => p.email),
    ccEmails: (input.cc ?? []).map((p) => p.email),
    sentAt: input.at,
    bodyText: input.text,
    ...(input.html ? { bodyHtml: input.html } : null),
    ...(input.attachments ? { attachments: input.attachments } : null),
    own: input.from.email === ME.email,
    rfcMessageId: `<${input.id}@vaerksted.example>`,
  };
}

function summary(input: {
  threadId: string;
  subject: string;
  from: Person;
  snippet: string;
  at: string;
  unread?: boolean;
  messageCount: number;
  others: Person[];
  hasAttachments?: boolean;
  hasCalendarInvite?: boolean;
  calendarInviteWhen?: string;
  account?: string;
  /** "In Contacts" for people the studio knows; "Other" for the rest. */
  tab?: "people" | "other";
}): MailThreadSummary {
  return {
    account: input.account ?? DEMO_ACCOUNT,
    threadId: input.threadId,
    subject: input.subject,
    fromName: input.from.name,
    fromEmail: input.from.email,
    snippet: input.snippet,
    lastAt: input.at,
    unread: input.unread ?? false,
    messageCount: input.messageCount,
    tab: input.tab ?? "people",
    externalParticipants: input.others.map((p) => ({
      name: p.name,
      email: p.email,
    })),
    ...(input.hasAttachments ? { hasAttachments: true } : null),
    ...(input.hasCalendarInvite
      ? {
          hasCalendarInvite: true,
          calendarInviteWhen: input.calendarInviteWhen,
        }
      : null),
  };
}

/**
 * A mail as people who are not using this app write one.
 *
 * A greeting, a paragraph or two, a sign-off, a signature block — and, on a
 * reply, the mail it answers quoted underneath in the form every client
 * writes: "On <date>, <name> <address> wrote:" and then the old text behind
 * angle brackets.
 *
 * That tail is not decoration. The reader collapses it behind the "…" in the
 * bubble, which is one of the things worth showing a picture of, and a demo
 * of chat-style one-liners shows none of it. Most mail arriving here was
 * written in Gmail, Outlook or Apple Mail, and looks it.
 */
function letter(input: {
  from: Person;
  to: Person;
  paragraphs: string[];
  /** "Best wishes" unless something else fits. */
  signOff?: string;
  /** The mail being answered, quoted underneath. */
  quoting?: { from: Person; at: string; text: string };
  /** No greeting or signature: a line dashed off from a phone. */
  fromPhone?: boolean;
}): string {
  const lines: string[] = [];
  if (!input.fromPhone) lines.push(`Hi ${firstName(input.to)},`, "");
  lines.push(input.paragraphs.join("\n\n"));
  if (input.fromPhone) {
    lines.push("", "Sent from my phone");
  } else {
    lines.push("", `${input.signOff ?? "Best wishes"},`, firstName(input.from));
    if (input.from.sig?.length) lines.push("", ...input.from.sig);
  }
  if (input.quoting) {
    const when = new Date(input.quoting.at).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(
      "",
      `On ${when}, ${input.quoting.from.name} <${input.quoting.from.email}> wrote:`,
      ...input.quoting.text.split("\n").map((l) => `> ${l}`)
    );
  }
  return lines.join("\n");
}

/**
 * A back-and-forth, written as a script.
 *
 * `lines` is who said what, oldest first, and each reply quotes the one
 * before it the way a mail client would. The times are spread evenly from
 * `startedMinutesAgo` to `endedMinutesAgo`, so a thread that ran over three
 * weeks reads like one.
 */
function conversation(input: {
  id: string;
  lines: [Person, string | string[]][];
  startedMinutesAgo: number;
  endedMinutesAgo: number;
  attachmentsOnLast?: MailAttachment[];
  /** These indices were dashed off from a phone. */
  fromPhone?: number[];
}): MailMessage[] {
  const { lines, startedMinutesAgo: from, endedMinutesAgo: to } = input;
  const step = lines.length > 1 ? (from - to) / (lines.length - 1) : 0;
  const out: MailMessage[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const [who, said] = lines[i];
    const paragraphs = Array.isArray(said) ? said : [said];
    const at = ago(Math.round(from - step * i));
    const previous = out[out.length - 1];
    const previousWho = i > 0 ? lines[i - 1][0] : null;
    const text = letter({
      from: who,
      // Mail arriving here is addressed to the mailbox it arrives in; mail we
      // send is addressed to whoever we are answering.
      to:
        who.email === ME.email
          ? previousWho && previousWho.email !== ME.email
            ? previousWho
            : lines[0][0]
          : ME,
      paragraphs,
      fromPhone: input.fromPhone?.includes(i),
      ...(previous && previousWho
        ? {
            quoting: {
              from: previousWho,
              at: previous.sentAt ?? at,
              // Quote what they wrote, not the tail they were carrying.
              text: (previous.bodyText ?? "").split("\nOn ")[0].trim(),
            },
          }
        : null),
    });
    out.push(
      message({
        id: `${input.id}-${i + 1}`,
        from: who,
        to: [who.email === ME.email ? lines[0][0] : ME],
        at,
        text,
        ...(i === lines.length - 1 && input.attachmentsOnLast
          ? { attachments: input.attachmentsOnLast }
          : null),
      })
    );
  }
  return out;
}

/**
 * The inbox, newest first.
 *
 * Chosen to show the app rather than to fill it: one thread with files, one
 * long enough to have a beginning worth reaching, one invitation, one
 * receipt, and a couple of short ones so the list has ordinary rows in it.
 */
export function demoThreads(): DemoThread[] {
  return [
    {
      summary: summary({
        threadId: "t-harbour",
        subject: "Harbour exhibition — the last three rooms",
        from: P.caroline,
        snippet:
          "I have put the floor plan and the two photographs in here. Room three is the one I am unsure about…",
        at: ago(18),
        unread: true,
        messageCount: 4,
        others: [P.caroline, P.dorte],
        hasAttachments: true,
      }),
      messages: conversation({
        id: "m-harbour",
        startedMinutesAgo: 3 * DAY,
        endedMinutesAgo: 18,
        attachmentsOnLast: [
          file("a-plan", "Stueplan — havnesalen.pdf", "application/pdf", 486_000),
          file("a-room2", "Sal to, formiddag.png", "image/png", 244_000),
          file("a-room3", "Sal tre, vestlys.png", "image/png", 268_000),
        ],
        fromPhone: [1],
        lines: [
          [
            P.dorte,
            [
              "Are we still hanging the north wall first? I would rather start there while the light is good, and it would let the joiner get the side rooms done on the Tuesday.",
              "If that works I will tell him today.",
            ],
          ],
          [ME, "Yes — north wall first, then the two side rooms. I will bring the smaller frames on Tuesday."],
          [
            P.caroline,
            [
              "One more thing before Friday: the label text needs cutting by about a third. It reads as a catalogue entry at the moment rather than something you would stand and read.",
              "I have marked the three that are worst.",
            ],
          ],
          [
            P.caroline,
            [
              "I have put the floor plan and the two photographs in here.",
              "Room three is the one I am unsure about — see the second picture. The west light is lovely at four o'clock and gone by five, which may be an argument for hanging the smaller works there.",
            ],
          ],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-invite",
        subject: "Studio visit — Thursday 11:00",
        from: P.kanin,
        snippet:
          "The arts centre would like to bring six people round. Thursday at eleven suits us if it suits you.",
        at: ago(2 * HOUR + 40),
        unread: true,
        messageCount: 1,
        others: [P.kanin],
        hasCalendarInvite: true,
        calendarInviteWhen: "Thu, 11:00",
      }),
      messages: [
        message({
          id: "m-invite-1",
          from: P.kanin,
          to: [ME],
          at: ago(2 * HOUR + 40),
          text: [
            "Dear Vera Vinter,",
            "",
            "Following our conversation last month, we would like to bring a group of six to see the studio. Thursday the 20th at 11:00 would suit us, and we expect to stay about an hour.",
            "",
            "Please let us know if that works. We will come by the yard entrance as you suggested.",
            "",
            "Kind regards,",
            "Kanin Kunsthal",
            "Booking og formidling",
            "Tlf. 00 00 00 00",
          ].join("\n"),
          attachments: [
            file("a-invite", "invite.ics", "text/calendar", 620),
          ],
        }),
      ],
    },
    {
      // A short note with a pile of files under it: the files sit two or
      // three abreast, and the bubble grows to hold them.
      summary: summary({
        threadId: "t-grant-files",
        subject: "Application and supporting documents",
        from: P.kanin,
        snippet: "Hello, here is our application for support, with the other documents. Thank you in advance.",
        at: ago(3 * HOUR + 10),
        messageCount: 1,
        others: [P.kanin],
        hasAttachments: true,
      }),
      messages: [
        message({
          id: "m-grant-files-1",
          from: P.kanin,
          to: [ME],
          at: ago(3 * HOUR + 10),
          text: ["Hello,", "here is our application for support, with the other documents.", "", "Thank you in advance."].join("\n"),
          attachments: [
            file("a-grant-1", "Application.pdf", "application/pdf", 1_880_000),
            file("a-grant-2", "Recommendation Midtvask.pdf", "application/pdf", 250_000),
            file("a-grant-3", "Recommendation Embassy.pdf", "application/pdf", 734_000),
            file("a-grant-4", "Statutes.pdf", "application/pdf", 3_000_000),
            file("a-grant-5", "Memorandum.pdf", "application/pdf", 4_600_000),
          ],
        }),
      ],
    },
    {
      summary: summary({
        threadId: "t-print",
        subject: "Paper stock for the catalogue",
        from: P.benny,
        snippet:
          "The 150gsm is back in stock. It takes the deep blues much better than the sample you saw.",
        at: ago(5 * HOUR),
        messageCount: 2,
        others: [P.benny],
      }),
      messages: conversation({
        id: "m-print",
        startedMinutesAgo: 1 * DAY + 2 * HOUR,
        endedMinutesAgo: 5 * HOUR,
        lines: [
          [
            ME,
            [
              "Did the heavier stock ever come back in? The sample we saw in June went flat in the darker plates, and the catalogue is mostly dark.",
              "We would need about forty sheets.",
            ],
          ],
          [
            P.benny,
            [
              "Good news — the 150gsm is back in stock. It takes the deep blues much better than the sample you saw, which was an older run.",
              "I can hold forty sheets until Friday. After that I cannot promise, as the printer down the road takes most of what we get.",
            ],
          ],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-residency",
        subject: "Re: Residency — dates and the studio question",
        from: P.ingrid,
        snippet:
          "September works at our end. The studio is yours from the 3rd, and the workshop room on the two Fridays.",
        at: ago(1 * DAY + 6 * HOUR),
        messageCount: 9,
        others: [P.ingrid, P.anton],
      }),
      messages: conversation({
        id: "m-res",
        startedMinutesAgo: 21 * DAY,
        endedMinutesAgo: 1 * DAY + 6 * HOUR,
        lines: [
          [
            P.ingrid,
            [
              "We would very much like to have you here in the autumn. Two slots are open: three weeks in September, or a fortnight in November.",
              "The September one comes with the studio on the ground floor, which I think would suit the larger pieces better.",
            ],
          ],
          [ME, "September, if the studio is free — November collides with the harbour show, which opens on the 3rd."],
          [P.anton, "I can bring the press over for the second week if that helps. It travels badly but it does travel."],
          [
            P.ingrid,
            [
              "September works at our end. The studio is yours from the 3rd, and the workshop room on the two Fridays.",
              "I will send the practical details — keys, the code for the yard gate, and who to ask about materials — nearer the time.",
            ],
          ],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-receipt",
        subject: "Your receipt from Ledger",
        from: P.balance,
        snippet: "Thanks for your payment. This month: 24.00 EUR.",
        at: ago(2 * DAY + 3 * HOUR),
        messageCount: 1,
        others: [P.balance],
        tab: "other",
      }),
      messages: [
        message({
          id: "m-receipt-1",
          from: P.balance,
          to: [ME],
          at: ago(2 * DAY + 3 * HOUR),
          text: "Thanks for your payment. This month: 24.00 EUR.",
          html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#1c1917">
            <h2 style="font-weight:600">Receipt</h2>
            <p>Thanks for your payment.</p>
            <table style="border-collapse:collapse">
              <tr><td style="padding:4px 24px 4px 0;color:#78716c">Plan</td><td>Studio</td></tr>
              <tr><td style="padding:4px 24px 4px 0;color:#78716c">This month</td><td>24.00 EUR</td></tr>
            </table>
          </div>`,
        }),
      ],
    },
    {
      summary: summary({
        threadId: "t-catalogue",
        subject: "Catalogue text — round three",
        from: P.frida,
        snippet:
          "Final pass attached. I have left the two captions you flagged in Danish, with a note each.",
        at: ago(3 * HOUR + 20),
        unread: true,
        messageCount: 22,
        others: [P.frida, P.dorte, P.caroline],
        hasAttachments: true,
      }),
      messages: conversation({
        id: "m-cat",
        startedMinutesAgo: 26 * DAY,
        endedMinutesAgo: 3 * HOUR + 20,
        attachmentsOnLast: [
          file("a-cat", "Catalogue — round three.pdf", "application/pdf", 1_240_000),
        ],
        lines: [
          [P.dorte, "Sending the first draft of the catalogue text. It is long — I would rather cut than pad."],
          [ME, "Thank you. I will read it tonight and mark the parts that repeat the wall labels."],
          [ME, "Read. Sections two and four say the same thing twice, and the opening is three paragraphs of throat-clearing."],
          [P.dorte, "Agreed on the opening. I will start at what is now the third paragraph."],
          [P.frida, "I can start translating once the English is settled. Roughly how many words are we at?"],
          [P.dorte, "About 4,200. It should come down to 3,000."],
          [ME, "Second draft looks much better. The piece on the north wall still needs a date."],
          [P.dorte, "1974, though the frame is later. I will say so."],
          [P.caroline, "One thought: the room order in the text is not the order people will walk it."],
          [ME, "Good catch. Walk order: north, then the two side rooms, then three."],
          [P.dorte, "Reordered. That also fixes the awkward jump on page four."],
          [P.frida, "Starting the Danish now. I will flag anything that will not carry across."],
          [P.frida, "Two captions do not carry: the pun in room two, and the phrase about the tide."],
          [ME, "Leave both in English then, with a short note. Better than a translation that limps."],
          [P.dorte, "Third draft attached in the next message — 2,940 words."],
          [P.caroline, "Reads well. I would still lose the last sentence of the introduction."],
          [ME, "Lost."],
          [P.frida, "Danish is done bar the two captions we left. Sending for your read."],
          [P.dorte, "One typo: 'harbor' on page six, everything else is British spelling."],
          [ME, "Fixed. Frida, are you happy for this to go to the printer on Friday?"],
          [P.frida, "Yes, with the note on the two captions."],
          [P.frida, "Final pass attached. I have left the two captions you flagged in Danish, with a note each."],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-workshop",
        subject: "Workshop on the 14th — numbers and the room",
        from: P.anton,
        snippet: "Eighteen signed up, which is four more than the room seats.",
        at: ago(11 * HOUR),
        messageCount: 14,
        others: [P.anton, P.ingrid],
      }),
      messages: conversation({
        id: "m-ws",
        startedMinutesAgo: 12 * DAY,
        endedMinutesAgo: 11 * HOUR,
        lines: [
          [P.anton, "Shall we open the workshop to the public this time, or keep it to the residency?"],
          [ME, "Open it. Half the interest last time came from people who just wandered in."],
          [P.ingrid, "I can put it on our list if you send me two lines and a picture."],
          [ME, "Sending both tomorrow."],
          [ME, "Two lines and a picture, as promised."],
          [P.ingrid, "On the list. It went out this morning."],
          [P.anton, "Six sign-ups in the first hour."],
          [ME, "That is more than the whole of last time."],
          [P.anton, "Eleven now."],
          [P.ingrid, "Do you want me to close it at fourteen?"],
          [ME, "Let it run to sixteen. Some always drop out."],
          [P.anton, "Sixteen, and there are four on a waiting list."],
          [ME, "Then we should move rooms rather than turn people away."],
          [P.anton, "Eighteen signed up, which is four more than the room seats."],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-shipping",
        subject: "Shipping the crates to Leipzig",
        from: P.jens,
        snippet:
          "Two crates, door to door, and the insurance is on the value you gave me. Quote below.",
        at: ago(7 * HOUR),
        messageCount: 5,
        others: [P.jens],
      }),
      messages: conversation({
        id: "m-ship",
        startedMinutesAgo: 5 * DAY,
        endedMinutesAgo: 7 * HOUR,
        lines: [
          [ME, "What would it cost to move two crates to Leipzig in the first week of September?"],
          [P.jens, "Depends on the size. Rough dimensions and weight and I can price it today."],
          [ME, "120 x 90 x 30 each, about 40 kg with the frames in."],
          [P.jens, "That is a small van rather than a pallet, which is cheaper."],
          [P.jens, "Two crates, door to door, and the insurance is on the value you gave me. Quote below."],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-westquay",
        subject: "West Quay — would you show in the spring?",
        from: P.gustav,
        snippet:
          "We have a room free from March. It is small but the light is very good in the afternoon.",
        at: ago(9 * HOUR),
        unread: true,
        messageCount: 2,
        others: [P.gustav],
      }),
      messages: conversation({
        id: "m-wq",
        startedMinutesAgo: 2 * DAY,
        endedMinutesAgo: 9 * HOUR,
        lines: [
          [P.gustav, "We saw the harbour pieces last year and have been meaning to write ever since."],
          [P.gustav, "We have a room free from March. It is small but the light is very good in the afternoon."],
        ],
      }),
    },
    {
      summary: summary({
        threadId: "t-grant",
        subject: "Application received",
        from: P.fond,
        snippet:
          "We have your application. A decision is expected within eight weeks.",
        at: ago(1 * DAY + 2 * HOUR),
        messageCount: 1,
        others: [P.fond],
        tab: "other",
      }),
      messages: [
        message({
          id: "m-grant-1",
          from: P.fond,
          to: [ME],
          at: ago(1 * DAY + 2 * HOUR),
          text: [
            "Dear applicant,",
            "",
            "We confirm that your application has been received. A reference number is not required for correspondence; please quote the project title instead.",
            "",
            "Applications are assessed in the order they arrive. A decision is expected within eight weeks. Please do not reply to this message — the mailbox is not monitored.",
            "",
            "Fond for Fjer",
          ].join("\n"),
        }),
      ],
    },
    {
      summary: summary({
        threadId: "t-newsletter",
        subject: "New in stock: cotton rag, three weights",
        from: P.papir,
        snippet: "Our first cotton rag since the spring, in three weights.",
        at: ago(2 * DAY + 20 * HOUR),
        messageCount: 1,
        others: [P.papir],
        tab: "other",
      }),
      messages: [
        message({
          id: "m-news-1",
          from: P.papir,
          to: [ME],
          at: ago(2 * DAY + 20 * HOUR),
          text: "Our first cotton rag since the spring, in three weights.",
          // Built the way a newsletter tool builds one: a fixed-width table
          // that a media query lets go fluid on a narrow screen, a hidden
          // preheader, and a few cells told not to wrap. Invented; the
          // shape is what matters, since the reader has to fit it.
          html: `<style>
            @media (max-width: 700px) { .responsive { width: 100% !important; } }
            .lnk { color: #b45309 !important; text-decoration: underline !important; }
          </style>
          <div style="display:none !important;visibility:hidden;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Cotton rag is back — three weights, samples free to studios.</div>
          <div style="padding: 0 10px;">
            <table class="responsive" style="margin: 0 auto; width: 100%; max-width: 680px;" align="center" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="padding: 24px 0 8px; text-align: center; font-family: Georgia, serif; font-size: 28px; letter-spacing: 4px; color: #1c1917;">PAPIR &amp; PAP</td></tr>
            </table>
            <table class="responsive" style="background-color: #efefef; margin: 0 auto; width: 680px;" align="center" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="padding: 32px 40px 16px; font-family: Georgia, serif; font-size: 17px; line-height: 1.6; color: #1c1917;">
                Welcome to the first paper letter of the season, a roundup of the sheets we think are worth your time. <em>(Thank you to the mill at Silkeborg for pressing the samples in time for this letter.)</em>
              </td></tr>
              <tr><td style="padding: 0 24px 24px;">
                <table style="width: 100%; background: #ffffff; border-radius: 12px;" border="0" cellpadding="0" cellspacing="0" role="presentation">
                  <tr><td style="padding: 24px 32px 8px;">
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td valign="middle" style="padding-right: 8px; white-space: nowrap;"><span style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#d6d3d1;"></span></td>
                        <td valign="middle" style="padding-left: 10px; padding-right: 5px; white-space: nowrap;"><strong style="font-family: Helvetica, Arial, sans-serif; font-size: 15px;">Papir &amp; Pap</strong></td>
                        <td valign="middle" style="padding-left: 2px; white-space: nowrap;"><span style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: #78716c;">in Cotton rag · Sep 5</span></td>
                      </tr>
                    </table>
                  </td></tr>
                  <tr><td style="padding: 8px 32px 0; font-family: Helvetica, Arial, sans-serif; font-size: 24px; font-weight: 700; color: #1c1917;">Cotton rag, three weights</td></tr>
                  <tr><td style="padding: 12px 32px 20px; font-family: Helvetica, Arial, sans-serif; font-size: 17px; line-height: 1.5; color: #44403c;">“Our first cotton rag since the spring, in three weights: 120, 150 and 300gsm. Mill-cut, deckled on two edges, and the 300 takes wash without cockling if you stretch it first.”</td></tr>
                  <tr><td style="padding: 0 32px 28px;">
                    <table style="width: 100%;" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr>
                      <td valign="middle" style="font-family: Helvetica, Arial, sans-serif; font-size: 15px; color: #78716c; white-space: nowrap;">♡ 86 &nbsp;&nbsp; ✎ 67</td>
                      <td valign="middle" align="right"><a class="lnk" href="https://papir.example/cotton-rag" style="display: inline-block; padding: 14px 28px; border: 2px solid #b45309; border-radius: 10px; font-family: Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-decoration: none; white-space: nowrap;">READ THE SAMPLES</a></td>
                    </tr></table>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="padding: 0 40px 32px; font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #a8a29e;">You are receiving this because you have a studio account.</td></tr>
            </table>
          </div>`,
        }),
      ],
    },
    {
      summary: summary({
        threadId: "t-erik",
        subject: "Frames — the oak ones",
        from: P.egon,
        snippet: "Twelve in oak, and I can have them ready a week on Monday.",
        at: ago(4 * DAY),
        messageCount: 3,
        others: [P.egon],
        account: DEMO_SECOND_ACCOUNT,
      }),
      messages: conversation({
        id: "m-egon",
        startedMinutesAgo: 6 * DAY,
        endedMinutesAgo: 4 * DAY,
        lines: [
          [ME, "Could you quote me for twelve frames, oak, to fit the sizes I sent over last week?"],
          [
            P.egon,
            [
              "Twelve in oak, and I can have them ready a week on Monday. Ash would be a fortnight, as I have none seasoned.",
              "The price is the same either way. Say the word and I will start.",
            ],
          ],
          [ME, "Oak please, and Monday is fine."],
        ],
      }),
    },
  ];
}

/** A thread as the reader opens it. */
export function demoThreadDetail(threadId: string): MailThreadDetail | null {
  const found = demoThreads().find((t) => t.summary.threadId === threadId);
  if (!found) return null;
  const messages = found.messages;
  const last = messages[messages.length - 1];
  const others = messages
    .filter((m) => !m.own)
    .map((m) => m.fromEmail)
    .filter((e, i, all) => all.indexOf(e) === i);
  return {
    account: found.summary.account,
    threadId,
    subject: found.summary.subject,
    participants: [
      ...messages
        .filter((m) => !m.own)
        .map((m) => m.fromName)
        .filter((n, i, all) => all.indexOf(n) === i),
      "You",
    ],
    messages,
    hasOlder: false,
    hasNewer: false,
    totalMessageCount: messages.length,
    reply: {
      inReplyTo: last?.rfcMessageId ?? "",
      references: last?.rfcMessageId ?? "",
      to: last?.own ? last.toEmails : [last?.fromEmail ?? ""],
      cc: [],
      allTo: others,
      allCc: [],
    },
  } as MailThreadDetail;
}

/**
 * Everyone the demo knows, for the typeahead and the People view.
 *
 * Shaped like a real suggestion, `recordName` and `source` included: the
 * list editor's typeahead lower-cases the record name of every contact it
 * scores, and a row without one took the whole window down on the first
 * keystroke.
 */
export function demoContacts(): {
  name: string;
  email: string;
  recordName: string;
  source: "history";
}[] {
  return Object.values(P).map((p) => ({
    name: p.name,
    email: p.email,
    recordName: "",
    source: "history",
  }));
}
