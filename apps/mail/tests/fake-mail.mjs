/**
 * A Gmail mailbox and an Outlook mailbox, faked at the edge of the process.
 *
 * Two fakes, for the two things the mail core reaches out to:
 *
 * - `fakeMailStore` answers `mail_store_call` the way Rust would, from a few
 *   in-memory rows. It also answers the Outlook token exchange.
 * - `fakeMailProviders` answers `fetch` for the Gmail and Graph URLs the core
 *   really builds, from invented threads, and records every request with its
 *   method and body so a suite can read what would have left the machine.
 *
 * The suites that share these check one inbox, one thread, one send. Each
 * reads the same mailboxes, so a row that lists one way and opens another
 * shows up as a disagreement between two suites.
 *
 * Every address, name and sentence here is invented. See AGENTS.md.
 */

import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";

export const GMAIL = "me@gmail.com";
export const OUTLOOK = "me@outlook.com";
export const OWNER = "local";
export const ALMA = { name: "Alma Aagaard", email: "alma@example.org" };

/** What is stored as the signature for both mailboxes. */
export const SIGNATURE = "Sigrid Sten\n[Værksted](https://vaerksted.example)";

/**
 * Install a store holding both mailboxes, Alma in the Google address book,
 * and the signature. Answers the record of every call made.
 */
export function fakeMailStore({ snoozes = [], settings = {} } = {}) {
  const calls = [];
  invalidateConnectedMailAccountsCache();
  const stored = {
    mail_list_row_shape: "3",
    [`mail_signature:${GMAIL}`]: JSON.stringify({ signature: SIGNATURE }),
    [`mail_signature:${OUTLOOK}`]: JSON.stringify({ signature: SIGNATURE }),
    ...settings,
  };
  const row = (email) => ({
    email, ownerId: OWNER, historyId: null, lastSyncedAt: null,
    lastSyncError: null, inMailTab: true,
  });
  globalThis.window = {
    __TAURI__: { core: { invoke: async (cmd, args) => {
      if (cmd === "oauth_token_request") {
        return { status: 200, body: { access_token: "ms-at" } };
      }
      if (cmd !== "mail_store_call") return null;
      calls.push({ op: args.op, args: args.args });
      switch (args.op) {
        case "settings.get":
          return stored[args.args.key] ?? null;
        case "settings.set":
          stored[args.args.key] = args.args.value;
          return null;
        case "accounts.listForOwner":
          return args.args.provider === "gmail" ? [row(GMAIL)] : [row(OUTLOOK)];
        case "accounts.exists":
          return (args.args.provider === "gmail" && args.args.email === GMAIL) ||
            (args.args.provider === "outlook" && args.args.email === OUTLOOK);
        case "accounts.getToken":
          return { refreshToken: "rt", ownerId: OWNER };
        case "contactSources.listVisible":
          return [{ source: "google", account: GMAIL, ...ALMA, lastEmailedAt: null }];
        case "snoozes.listActive":
          return snoozes;
        case "chats.findBindings":
        case "listSync.load":
          return {};
        default:
          return null;
      }
    } } },
  };
  return { calls, stored };
}

// ---- Builders ---------------------------------------------------------------

const b64url = (text) => Buffer.from(text, "utf8").toString("base64url");

/**
 * One Gmail message. `headers` is the RFC 822 header map; `text` becomes a
 * text/plain part, and `html` a text/html part beside it.
 */
export function gmailMessage(id, threadId, headers, extra = {}) {
  const parts = [];
  if (extra.text != null) {
    parts.push({ mimeType: "text/plain", body: { data: b64url(extra.text) } });
  }
  if (extra.html != null) {
    parts.push({ mimeType: "text/html", body: { data: b64url(extra.html) } });
  }
  return {
    id,
    threadId,
    labelIds: ["INBOX", ...(extra.unread ? ["UNREAD"] : [])],
    snippet: extra.snippet ?? "",
    internalDate: String(Date.parse(headers.Date)),
    historyId: "100",
    payload: {
      mimeType: parts.length > 1 ? "multipart/alternative" : "text/plain",
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      ...(parts.length ? { parts } : null),
    },
  };
}

/** One Graph message, with an HTML body when `html` is given. */
export function graphMessage(id, conversationId, fields) {
  return {
    id,
    conversationId,
    subject: fields.subject,
    bodyPreview: fields.preview ?? "",
    ...(fields.html != null
      ? { body: { contentType: "HTML", content: fields.html } }
      : null),
    from: { emailAddress: { name: fields.fromName ?? "", address: fields.from } },
    toRecipients: fields.to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: [],
    receivedDateTime: fields.at,
    sentDateTime: fields.at,
    isRead: fields.read ?? true,
    isDraft: false,
    hasAttachments: false,
    internetMessageId: fields.rfcId,
  };
}

// ---- The mailboxes ------------------------------------------------------------

/** What the Gmail mailbox holds, by thread id. Newest message last. */
export const GMAIL_THREADS = {
  // From a contact, unread.
  g1: [
    gmailMessage("g1m1", "g1", {
      From: "Alma Aagaard <alma@example.org>", To: GMAIL,
      Subject: "Two bits of good news", Date: "Mon, 17 Aug 2026 09:00:00 +0000",
      "Message-ID": "<g1m1@example.org>",
    }, { unread: true, text: "Both grants came through." }),
  ],
  // From a stranger, and a copy of it also reached the Outlook mailbox.
  g2: [
    gmailMessage("g2m1", "g2", {
      From: "news@example.net", To: `${GMAIL}, ${OUTLOOK}`,
      Subject: "Catalogue week", Date: "Sun, 16 Aug 2026 12:00:00 +0000",
      "Message-ID": "<shared-1@example.net>",
    }, { text: "Boxes of catalogues." }),
  ],
  // A question from the contact, and our reply to it, newest last. The
  // reply answers an older message, so the list offers it for adoption.
  g3: [
    gmailMessage("g3m1", "g3", {
      From: "Alma Aagaard <alma@example.org>", To: GMAIL,
      Subject: "Thursday?", Date: "Fri, 14 Aug 2026 08:00:00 +0000",
      "Message-ID": "<g3m1@example.org>",
    }, { text: "Does Thursday work?", html: "<p>Does <b>Thursday</b> work?</p>" }),
    gmailMessage("g3m2", "g3", {
      From: GMAIL, To: "Alma Aagaard <alma@example.org>",
      Subject: "Re: Thursday?", Date: "Fri, 14 Aug 2026 09:00:00 +0000",
      "Message-ID": "<g3m2@gmail.com>", "In-Reply-To": "<g3m1@example.org>",
      References: "<g3m1@example.org>",
    }, { text: "Thursday is fine." }),
  ],
};

/** What the Outlook mailbox holds. Conversation o1 has two messages. */
export const GRAPH_MESSAGES = [
  graphMessage("o1m1", "o1", {
    subject: "Slides for the workshop", from: ALMA.email, fromName: ALMA.name,
    to: [OUTLOOK], at: "2026-08-15T10:00:00Z", rfcId: "<o1m1@example.org>",
    html: "<p>Slides attached tomorrow.</p>",
  }),
  graphMessage("o1m2", "o1", {
    subject: "Re: Slides for the workshop", from: ALMA.email, fromName: ALMA.name,
    to: [OUTLOOK], at: "2026-08-15T11:00:00Z", rfcId: "<o1m2@example.org>",
    html: "<p>Make that <i>Friday</i>.</p>", read: false,
  }),
  // The Outlook copy of g2, unread here.
  graphMessage("o2m1", "o2", {
    subject: "Catalogue week", from: "news@example.net", to: [GMAIL, OUTLOOK],
    at: "2026-08-16T12:00:00Z", rfcId: "<shared-1@example.net>", read: false,
    html: "<p>Boxes of catalogues.</p>",
  }),
];

/** Newest first, the order Graph answers a conversation query in. */
const conversation = (id) =>
  GRAPH_MESSAGES.filter((m) => m.conversationId === id)
    .sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime));

// ---- The providers --------------------------------------------------------------

/**
 * Install a `fetch` that answers Google and Microsoft. Answers the record of
 * every request: `{ url, method, body }`, with `body` parsed when it was JSON.
 */
export function fakeMailProviders() {
  const requests = [];
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    });
  globalThis.fetch = async (url, init) => {
    url = String(url);
    const method = init?.method ?? "GET";
    let body = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* a form, or empty */ }
    }
    requests.push({ url, method, body });

    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "g-at" });

    if (url.includes("gmail.googleapis.com")) {
      if (url.includes("/settings/sendAs")) {
        return json({ sendAs: [
          { sendAsEmail: GMAIL, displayName: "Sigrid Sten", isPrimary: true },
        ] });
      }
      if (url.endsWith("/messages/send")) {
        return json({ id: "sent-1", threadId: body?.threadId ?? "new-thread" });
      }
      const m = url.match(/users\/me\/(threads|messages)(?:\/([^/?]+))?(\/modify)?/);
      if (!m) return json({ error: `unexpected Gmail path ${url}` }, 404);
      const [, kind, id, modify] = m;
      if (modify) return json({});
      if (kind === "threads" && !id) {
        return json({
          threads: Object.entries(GMAIL_THREADS).map(([tid, ms]) => ({
            id: tid, snippet: ms.at(-1).snippet, historyId: "100",
          })),
        });
      }
      if (kind === "messages" && !id) {
        // A search: the messages whose subject or first words hold every
        // word asked for. Gmail's OR-widened form is read as its words.
        const words = (new URL(url).searchParams.get("q") ?? "")
          .toLowerCase().split(/\s+/).filter((w) => w && w !== "or");
        const hit = (x) => {
          const subject = x.payload.headers.find((h) => h.name === "Subject")?.value ?? "";
          const text = `${subject} ${x.snippet}`.toLowerCase();
          return words.length > 0 && words.some((w) => text.includes(w));
        };
        return json({
          messages: Object.entries(GMAIL_THREADS).flatMap(([tid, ms]) =>
            ms.filter(hit).map((x) => ({ id: x.id, threadId: tid }))),
        });
      }
      if (kind === "threads") {
        const messages = GMAIL_THREADS[id];
        return messages
          ? json({ id, messages })
          : json({ error: "no such thread" }, 404);
      }
      const message = Object.values(GMAIL_THREADS).flat().find((x) => x.id === id);
      return message ? json(message) : json({ error: "no such message" }, 404);
    }

    if (url.includes("graph.microsoft.com")) {
      const plain = decodeURIComponent(url.replace(/\+/g, " "));
      if (url.includes("/me/mailFolders/inbox/messages")) {
        return json({ value: GRAPH_MESSAGES });
      }
      if (url.endsWith("/createReply")) return json({ id: "reply-draft-1" });
      if (url.endsWith("/send") || url.endsWith("/sendMail")) {
        return new Response(null, { status: 202 });
      }
      if (method === "PATCH") return json({});
      if (/isDraft eq true/.test(plain)) return json({ value: [] });
      const search = plain.match(/\$search="([^"]*)"/);
      if (search) {
        const words = search[1].toLowerCase().split(/\s+/).filter(Boolean);
        return json({ value: GRAPH_MESSAGES.filter((x) =>
          words.some((w) => `${x.subject} ${x.bodyPreview}`.toLowerCase().includes(w))) });
      }
      const conv = plain.match(/conversationId eq '([^']+)'/);
      if (conv) return json({ value: conversation(conv[1]) });
      const one = url.match(/\/me\/messages\/([^/?]+)/);
      if (one) {
        const message = GRAPH_MESSAGES.find((x) => x.id === one[1]);
        return message ? json(message) : json({ error: "no such message" }, 404);
      }
      return json({ value: [] });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { requests };
}

/** The RFC 822 text of a Gmail send, from the request that carried it. */
export function rawOfGmailSend(request) {
  return Buffer.from(request.body.raw, "base64url").toString("utf8");
}
