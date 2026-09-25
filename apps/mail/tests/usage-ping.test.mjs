/**
 * The anonymous daily usage count (lib/mail/usage-ping.ts).
 *
 * What it sends, and when: once per UTC day, three fields and no more; the
 * same random key through a month and a new one the next; nothing when the
 * reader turned it off, or on a system /api/ping does not take; and after
 * a failed send, another try. fetch and localStorage are fakes here.
 */

import {
  maybeSendUsagePing,
  resetUsagePingForTests,
  USAGE_PING_ENABLED_KEY,
  USAGE_PING_URL,
  usagePingPlatform,
  writeUsagePingEnabled,
} from "@/lib/mail/usage-ping";

import { check, suite } from "./harness.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const sent = [];
let answer = 204;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), init, body: JSON.parse(init.body) });
  if (answer === "offline") throw new TypeError("Load failed");
  return new Response(null, { status: answer });
};
const day = (iso) => ({ now: new Date(`${iso}T12:00:00Z`), platform: "mac" });

suite(async () => {
  await maybeSendUsagePing(day("2026-10-01"));
  check("the first day sends one ping", sent.length === 1, sent.length);
  check("to the planner's ping", sent[0].url === USAGE_PING_URL, sent[0].url);
  const body = sent[0].body;
  check(
    "with three things and nothing more: the product, the system, a random key",
    Object.keys(body).sort().join() === "key,platform,product" &&
      body.product === "mail" && body.platform === "mac" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.key),
    JSON.stringify(body)
  );
  check("and no cookies", sent[0].init.credentials === "omit");

  await maybeSendUsagePing(day("2026-10-01"));
  resetUsagePingForTests();
  await maybeSendUsagePing(day("2026-10-01"));
  check("a second try the same day sends nothing, even from a new page", sent.length === 1, sent.length);

  await maybeSendUsagePing(day("2026-10-02"));
  check("the next day sends again, with the same key", sent.length === 2 && sent[1].body.key === body.key);

  await maybeSendUsagePing(day("2026-11-01"));
  check("a new month has a new key", sent.length === 3 && sent[2].body.key !== body.key);

  answer = "offline";
  await maybeSendUsagePing(day("2026-11-02"));
  answer = 204;
  await maybeSendUsagePing(day("2026-11-02"));
  check("a send that failed is tried again", sent.length === 5 && sent[4].body.key === sent[2].body.key, sent.length);

  answer = 500;
  await maybeSendUsagePing(day("2026-11-03"));
  answer = 204;
  await maybeSendUsagePing(day("2026-11-03"));
  check("and one the planner refused", sent.length === 7, sent.length);

  writeUsagePingEnabled(false);
  check("turned off, the setting says so", store.get(USAGE_PING_ENABLED_KEY) === "0");
  await maybeSendUsagePing(day("2026-11-04"));
  check("turned off, nothing is sent", sent.length === 7, sent.length);
  writeUsagePingEnabled(true);

  await maybeSendUsagePing({ now: new Date("2026-11-05T12:00:00Z"), platform: null });
  check("on a system the ping does not take, nothing is sent", sent.length === 7, sent.length);

  // The desktop window gives a Safari user agent everywhere; the system
  // comes from userAgentData, and the Mac's web view has none.
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
  check("no userAgentData is a Mac", usagePingPlatform({ userAgent: SAFARI }) === "mac");
  check("userAgentData Windows is Windows, whatever the user agent says", usagePingPlatform({ userAgent: SAFARI, userAgentData: { platform: "Windows" } }) === "windows");
  check("the iPhone build is iOS", usagePingPlatform({ userAgent: `${SAFARI} dh-mail-mobile/ios` }) === "ios");
  check("the Android build sends none", usagePingPlatform({ userAgent: `${SAFARI} dh-mail-mobile/android` }) === null);
  check("Linux sends none", usagePingPlatform({ userAgent: SAFARI, userAgentData: { platform: "Linux" } }) === null);
});
