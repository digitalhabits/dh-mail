import {
  getOutlookAutoReply,
  setOutlookAutoReply,
} from "@/lib/mail/outlook-inbox";
import { check, suite } from "./harness.mjs";

let sent;

/** Answers a token, then whatever Graph is meant to have said. */
function harness(setting) {
  sent = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "oauth_token_request") {
            return { status: 200, body: { access_token: "at" } };
          }
          if (cmd === "mail_store_call" && args.op === "accounts.getToken") {
            return { refreshToken: "rt", ownerId: "local" };
          }
          return null;
        },
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("mailboxSettings")) {
      const body = init?.body ? JSON.parse(init.body) : null;
      sent.push({ method: init?.method ?? "GET", body });
      const answer = body?.automaticRepliesSetting ?? setting;
      return new Response(
        JSON.stringify({ automaticRepliesSetting: answer }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("{}", { status: 200 });
  };
}

const account = "me@outlook.com";

suite(async () => {
  // ---- Reading -------------------------------------------------------------
  harness({ status: "disabled" });
  let out = await getOutlookAutoReply(account);
  check("disabled reads as off", out.enabled === false);

  harness({ status: "alwaysEnabled", internalReplyMessage: "<p>Away</p>" });
  out = await getOutlookAutoReply(account);
  check("alwaysEnabled reads as on", out.enabled === true);
  check("with the message", out.bodyHtml === "<p>Away</p>", out.bodyHtml);
  // No schedule means no dates, not dates of zero.
  check("and no start or end", out.startTime === null && out.endTime === null);

  harness({
    status: "scheduled",
    internalReplyMessage: "<p>Back Monday</p>",
    scheduledStartDateTime: { dateTime: "2026-08-12T09:00:00.0000000", timeZone: "UTC" },
    scheduledEndDateTime: { dateTime: "2026-08-19T17:30:00.0000000", timeZone: "UTC" },
  });
  out = await getOutlookAutoReply(account);
  check(
    "a schedule comes back as epoch milliseconds",
    out.startTime === Date.parse("2026-08-12T09:00:00Z"),
    String(out.startTime)
  );
  check(
    "and Graph's zone-less time is read as UTC, not as local",
    out.endTime === Date.parse("2026-08-19T17:30:00Z"),
    String(out.endTime)
  );

  harness({ status: "alwaysEnabled", externalAudience: "contactsOnly" });
  out = await getOutlookAutoReply(account);
  check("contactsOnly is 'only my contacts'", out.restrictToContacts === true);

  harness({ status: "alwaysEnabled", externalAudience: "all" });
  out = await getOutlookAutoReply(account);
  check("all is not", (await getOutlookAutoReply(account)).restrictToContacts === false);

  // Outlook can be set to reply inside the organization only. Mail has one
  // message, so the internal one is what it shows.
  harness({
    status: "alwaysEnabled",
    internalReplyMessage: "<p>Inside</p>",
    externalReplyMessage: "<p>Outside</p>",
  });
  out = await getOutlookAutoReply(account);
  check("the internal message is the one shown", out.bodyHtml === "<p>Inside</p>");

  // ---- Writing -------------------------------------------------------------
  harness({});
  await setOutlookAutoReply({
    account,
    enabled: true,
    bodyHtml: "<p>Away</p>",
    restrictToContacts: false,
    startTime: Date.parse("2026-08-12T09:00:00Z"),
    endTime: Date.parse("2026-08-19T17:30:00Z"),
  });
  let body = sent.at(-1).body.automaticRepliesSetting;
  check("a dated out of office is scheduled", body.status === "scheduled", body.status);
  check(
    "and the times carry a zone, which Graph demands",
    body.scheduledStartDateTime.timeZone === "UTC" &&
      body.scheduledStartDateTime.dateTime === "2026-08-12T09:00:00",
    JSON.stringify(body.scheduledStartDateTime)
  );
  // One message in, two out: someone who set a different external reply in
  // Outlook must not be left with the old one still going out.
  check(
    "both messages are written, so no stale external reply survives",
    body.internalReplyMessage === "<p>Away</p>" &&
      body.externalReplyMessage === "<p>Away</p>"
  );
  check("and the audience is everyone", body.externalAudience === "all");

  harness({});
  await setOutlookAutoReply({
    account,
    enabled: true,
    bodyHtml: "x",
    restrictToContacts: true,
    startTime: null,
    endTime: null,
  });
  body = sent.at(-1).body.automaticRepliesSetting;
  check("no dates means on until turned off", body.status === "alwaysEnabled", body.status);
  check("only contacts is contactsOnly", body.externalAudience === "contactsOnly");
  check("and no schedule is sent at all", body.scheduledStartDateTime === undefined);

  // Half a range would either run forever or be refused, so it is not a range.
  harness({});
  await setOutlookAutoReply({
    account,
    enabled: true,
    bodyHtml: "x",
    restrictToContacts: false,
    startTime: Date.parse("2026-08-12T09:00:00Z"),
    endTime: null,
  });
  body = sent.at(-1).body.automaticRepliesSetting;
  check(
    "a start with no end is not a schedule",
    body.status === "alwaysEnabled" && body.scheduledStartDateTime === undefined,
    body.status
  );

  harness({});
  await setOutlookAutoReply({
    account,
    enabled: false,
    bodyHtml: "x",
    restrictToContacts: false,
    startTime: null,
    endTime: null,
  });
  check(
    "turning it off disables it",
    sent.at(-1).body.automaticRepliesSetting.status === "disabled"
  );
  check("with a PATCH, not a POST", sent.at(-1).method === "PATCH", sent.at(-1).method);
});
