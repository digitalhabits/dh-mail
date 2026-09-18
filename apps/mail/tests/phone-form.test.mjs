/**
 * When the interface is on a phone, and what the search chips there mean.
 *
 * The user agent the phone builds set, the attribute the shell writes from
 * it, and the query a scope chip spells — all pure, all without a renderer.
 */

import { check, suite } from "./harness.mjs";
import {
  hostOsFromUserAgent,
  phoneSearchQuery,
  readPhoneLayout,
} from "@/lib/mail/host-form";

suite(async () => {
  const ios =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 dh-mail-native/0.1 dh-mail-mobile/ios";
  const android =
    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 dh-mail-native/0.1 dh-mail-mobile/android";
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15 dh-mail-native/0.1";

  check("the iOS build announces itself in the user agent", hostOsFromUserAgent(ios) === "ios");
  check("and so does the Android build", hostOsFromUserAgent(android) === "android");
  check(
    "the Mac app is not a phone, marker or no marker",
    hostOsFromUserAgent(mac) === null && hostOsFromUserAgent("") === null
  );
  check(
    "a marker somebody spells in capitals still counts",
    hostOsFromUserAgent("x DH-Mail-Mobile/IOS y") === "ios"
  );

  check(
    "without a document there is no phone layout — the planner renders on a server",
    readPhoneLayout() === false
  );

  check("Everywhere is the words as typed", phoneSearchQuery("everywhere", "  paris ") === "paris");
  check("From spells the from: prefix the box already takes", phoneSearchQuery("from", "pardis") === "from:pardis");
  check("Subject the same", phoneSearchQuery("subject", "workshop") === "subject:workshop");
  check(
    "Has file is the has:attachment token, with or without words",
    phoneSearchQuery("file", "") === "has:attachment" &&
      phoneSearchQuery("file", "draft") === "has:attachment draft"
  );
  check(
    "a scope with nothing typed is no search at all",
    phoneSearchQuery("from", "  ") === "" && phoneSearchQuery("subject", "") === ""
  );
});
