/**
 * The access code of an Exchange (EWS) connect (section 18, item 5 of
 * docs/mail-exchange-ews.md).
 *
 * The Digital Habits server checks the code first. A refused code, too many tries, and a
 * check that cannot be made (offline, a server error) all stop the connect
 * before any mail_ews_* command: no call reaches the Exchange server. A
 * right code connects. A mailbox connected already is not checked again.
 * Invented codes and addresses only.
 *
 * Built as the internal app.
 */

import { AccessCodeError, EXCHANGE_ACCESS_URL, checkExchangeAccessCode, connectExchangeWithCode } from "@/lib/mail/exchange-access";

import { check, suite } from "./harness.mjs";

const invoked = [];
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        invoked.push(cmd);
        if (cmd === "mail_ews_connect") return { displayName: "Inbox", totalCount: 3, unreadCount: 1, childFolderCount: 0 };
        return null;
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const input = { email: "someone@mail.example.com", username: "someone", password: "not-a-real-one", url: "https://mail.example.com/EWS/Exchange.asmx" };

const asked = [];
const server = (answer) => async (url, init) => {
  asked.push({ url, body: init.body, type: init.headers["content-type"] });
  if (answer instanceof Error) throw answer;
  return new Response(null, { status: answer });
};

async function stopped(fetchImpl, code = "gamma-3") {
  try {
    await connectExchangeWithCode(input, { code, again: false, fetchImpl });
    return "connected";
  } catch (err) {
    return err instanceof AccessCodeError ? err.answer : `other: ${err.message}`;
  }
}

const ews = () => invoked.filter((c) => c.startsWith("mail_ews_"));

suite(async () => {
  check("a refused code stops the connect", (await stopped(server(403))) === "refused");
  check("too many tries stops it", (await stopped(server(429))) === "limited");
  check("a server error stops it, as not checked", (await stopped(server(500))) === "unchecked");
  check("no network stops it, as not checked", (await stopped(server(new TypeError("Failed to fetch")))) === "unchecked");
  check("an empty code asks nothing", (await stopped(server(204), "   ")) === "refused" && asked.length === 4);
  check("none of these made a mail_ews_* call", ews().length === 0, ews().join(","));

  check("the check goes to the server", asked[0]?.url === EXCHANGE_ACCESS_URL);
  check("as text, with no preflight, and the code only", asked[0]?.type === "text/plain" && asked[0]?.body === JSON.stringify({ code: "gamma-3" }));

  await connectExchangeWithCode(input, { code: " alpha-1 ", again: false, fetchImpl: server(204) });
  check("a right code connects", ews().join(",") === "mail_ews_connect", ews().join(","));
  check("the code is sent trimmed", asked.at(-1)?.body === JSON.stringify({ code: "alpha-1" }));
  check("and the code does not go to Rust", !JSON.stringify(input).includes("alpha-1"));

  const before = asked.length;
  await connectExchangeWithCode(input, { code: "", again: true, fetchImpl: server(403) });
  check("a mailbox connected already is not checked again", asked.length === before && ews().length === 2);

  check("the check answers ok on 204", (await checkExchangeAccessCode("alpha-1", server(204))) === "ok");
});
