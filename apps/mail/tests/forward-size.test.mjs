/**
 * The forward-size warning names the sender's provider and its limit
 * (17.1 of docs/mail-exchange-ews.md). It used to pick Outlook or Gmail
 * from "can send later", which is false for Exchange.
 */

import { forwardSizeWarning } from "@/lib/mail/forward-size";

import { check, suite } from "./harness.mjs";

const MB = 1024 * 1024;

suite(async () => {
  check("Gmail: 17 MB of files fit", forwardSizeWarning("gmail", 17 * MB) === null);
  check("Gmail: 19 MB speaks up, and names Gmail", forwardSizeWarning("gmail", 19 * MB)?.includes("Gmail takes about 25 MB"));
  check("Outlook: 15 MB speaks up, and names Outlook", forwardSizeWarning("outlook", 15 * MB)?.includes("Outlook takes about 20 MB"));
  check("Outlook: 14 MB fits", forwardSizeWarning("outlook", 14 * MB) === null);
  check("Exchange: 12 MB fits", forwardSizeWarning("exchange", 12 * MB) === null);
  const ex = forwardSizeWarning("exchange", 14 * MB) ?? "";
  check("Exchange: 14 MB speaks up, and names Exchange, not Gmail or Outlook", ex.includes("Exchange") && !ex.includes("Gmail") && !ex.includes("Outlook"), ex);
  check("with the size of the files", ex.startsWith("The files together are about 14 MB."));
});
