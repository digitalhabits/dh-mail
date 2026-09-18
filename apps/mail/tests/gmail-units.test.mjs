/**
 * Every Gmail call is charged against a minute's allowance before it is
 * sent, so what each call is taken to cost has to match Google's table.
 */

import { estimateGmailUnits } from "@/lib/gmail/api";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const cases = [
    ["GET", "/threads/abc?format=metadata", 10],
    ["GET", "/threads?q=in%3Ainbox&maxResults=100", 10],
    ["POST", "/threads/abc/modify", 10],
    ["DELETE", "/threads/abc", 20],
    ["GET", "/messages/abc?format=raw", 5],
    ["GET", "/messages?q=in%3Asent", 5],
    ["POST", "/messages/send", 100],
    ["POST", "/messages/abc/modify", 5],
    ["POST", "/messages/batchModify", 50],
    ["GET", "/messages/abc/attachments/xyz", 5],
    ["GET", "/history?startHistoryId=1", 2],
    ["GET", "/labels", 1],
    ["POST", "/labels", 5],
    ["GET", "/profile", 1],
    ["GET", "/settings/vacation", 1],
    ["PUT", "/settings/vacation", 50],
    ["POST", "/drafts", 10],
    ["PUT", "/drafts/abc", 15],
    ["POST", "/drafts/send", 100],
  ];
  for (const [method, path, units] of cases) {
    const got = estimateGmailUnits(method, path);
    check(`${method} ${path.split("?")[0]} costs ${units}`, got === units, got);
  }
  check(
    "a refresh of a hundred threads is a thousand units, a sixth of the minute",
    100 * estimateGmailUnits("GET", "/threads/x?format=metadata") === 1000,
    100 * estimateGmailUnits("GET", "/threads/x?format=metadata")
  );
});
