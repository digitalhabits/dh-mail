/**
 * One request to Microsoft Graph (lib/outlook/graph.ts).
 *
 * Graph throttles per mailbox: it allows four requests at once, and says
 * "not now" (429, 503, 504) with a time to wait. graphFetch keeps three in
 * the air per mailbox, waits and asks again when told to, and gives up
 * after three tries with words a reader can act on. fetch is replaced
 * here; nothing leaves the machine.
 */

import { graphFetch } from "@/lib/outlook/graph";
import { mailSay } from "@/lib/mail/i18n-strings";

import { check, suite } from "./harness.mjs";

const TOKEN = "token-for-ulla-aavang-example-0123456789abcdef";
const calls = [];
let answer = () => new Response("{}", { status: 200 });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return answer(calls.length, url, init);
};
// A wait Graph asks for, short enough for a test: Retry-After is in seconds.
const busy = (status) =>
  new Response('{"error":{"code":"ApplicationThrottled"}}', {
    status,
    headers: { "Retry-After": "0.01" },
  });

async function caught(p) {
  try {
    await p;
    return null;
  } catch (err) {
    return err;
  }
}

suite(async () => {
  calls.length = 0;
  answer = (n) => (n === 1 ? busy(429) : new Response('{"id":"m1"}', { status: 200 }));
  const got = await graphFetch(TOKEN, "/me/messages/m1");
  check("told to wait once, it asks again and gets the answer", got?.id === "m1" && calls.length === 2, calls.length);
  check("the request goes to Graph's address", calls[0].url === "https://graph.microsoft.com/v1.0/me/messages/m1", calls[0].url);
  check("with the mailbox's token", calls[0].init.headers.Authorization === `Bearer ${TOKEN}`);

  calls.length = 0;
  answer = () => busy(503);
  const tired = await caught(graphFetch(TOKEN, "/me/sendMail", { method: "POST", body: "{}" }));
  check("told to wait every time, it stops after three tries", calls.length === 3, calls.length);
  check("and says the mailbox is busy, in the reader's words", tired?.message === mailSay("mailboxBusy"), tired?.message);
  check("keeping Graph's status for the code that retries later", tired?.status === 503, tired?.status);

  calls.length = 0;
  answer = () => new Response('{"error":{"code":"ErrorInvalidRecipients"}}', { status: 400 });
  const refused = await caught(graphFetch(TOKEN, "/me/sendMail", { method: "POST", body: "{}" }));
  check("a refusal is not asked again", calls.length === 1, calls.length);
  check("and names the request and the status", /Graph POST \/me\/sendMail failed \(400\)/.test(refused?.message || ""), refused?.message);

  calls.length = 0;
  answer = () => new Response(null, { status: 204 });
  check("an empty answer (204) is nothing, not an error", (await graphFetch(TOKEN, "/me/messages/m1", { method: "PATCH", body: "{}" })) === undefined);

  // Five at once for one mailbox: three in the air, two waiting.
  calls.length = 0;
  let inFlight = 0;
  let most = 0;
  answer = async () => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight -= 1;
    return new Response("{}", { status: 200 });
  };
  await Promise.all([1, 2, 3, 4, 5].map((i) => graphFetch(TOKEN, `/me/messages/m${i}`)));
  check("one mailbox has at most three requests in the air", most === 3, most);
  check("and every request is answered in the end", calls.length === 5, calls.length);
});
