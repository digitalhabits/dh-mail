import { mailSay } from "@/lib/mail/i18n-strings";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // The count is written by the caller, so the sentence reads for one file
  // and for several without two strings to keep in step.
  const one = mailSay("outlookFilesInDownloads", { count: "1 file" });
  const many = mailSay("outlookFilesInDownloads", { count: "3 files" });
  check("one file reads as one", one.includes("1 file") && !one.includes("{count}"), one);
  check("three read as three", many.includes("3 files"), many);
  check("it says where they went", /downloads/i.test(one), one);

  const lost = mailSay("outlookFilesLeftBehind", { count: "2 files" });
  check("and says so when they could not go", lost.includes("2 files") && !lost.includes("{count}"), lost);
  check("without claiming they are anywhere", !/downloads/i.test(lost), lost);
});
