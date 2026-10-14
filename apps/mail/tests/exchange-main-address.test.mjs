/**
 * From shows the address an Exchange mailbox sends as.
 *
 * A university can give a mailbox a new main address after it was
 * connected: `abc123@dept.uni.example` becomes `kim.example@dept.uni.example`.
 * The server sends with the new one, so From must show it too. The
 * connected address stays the key in the store.
 *
 * Every address here is invented.
 */

import {
  refreshExchangeOwnAddresses,
  sendAsLabel,
  storedExchangeOwnAddresses,
} from "@/lib/mail/exchange-own-addresses";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const ACCOUNT = "Abc123@dept.uni.example";
const MAIN = "kim.example@dept.uni.example";

const settings = new Map();
setMailStore({
  settings: {
    get: async (key) => settings.get(key) ?? null,
    set: async (key, value) => {
      settings.set(key, value);
    },
  },
});

/** The directory's answer, or a throw for an offline server. */
function directory(answer) {
  const w = {
    __TAURI__: {
      core: {
        invoke: async (cmd) => {
          if (cmd !== "mail_ews_own_addresses") return null;
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    },
  };
  w.top = w;
  globalThis.window = w;
}

suite(async () => {
  check("before any answer, From shows the connected address", sendAsLabel(ACCOUNT) === ACCOUNT);

  directory({ main: MAIN, addresses: [MAIN, "abc123@dept.uni.example"] });
  const found = await refreshExchangeOwnAddresses([ACCOUNT]);
  check("the addresses are still the reader's own", found.includes(MAIN), found);
  check("From shows the main address", sendAsLabel(ACCOUNT) === MAIN, sendAsLabel(ACCOUNT));
  check("in any case", sendAsLabel(ACCOUNT.toUpperCase()) === MAIN);
  check("another mailbox shows its own address", sendAsLabel("dana@example.org") === "dana@example.org");
  check(
    "the address list keeps the form an older copy reads",
    Array.isArray(JSON.parse(settings.get("mail_exchange_own_addresses"))["abc123@dept.uni.example"])
  );

  // The next launch, with the server out of reach: the kept answer stands.
  directory(new Error("ews:network: no route"));
  await storedExchangeOwnAddresses([ACCOUNT]);
  check("the kept main address shows at once", sendAsLabel(ACCOUNT) === MAIN);
  await refreshExchangeOwnAddresses([ACCOUNT]);
  check("a failed ask keeps it", sendAsLabel(ACCOUNT) === MAIN);

  // The main address is the connected one: the address shows as it was typed.
  directory({ main: "abc123@dept.uni.example", addresses: ["abc123@dept.uni.example"] });
  await refreshExchangeOwnAddresses([ACCOUNT]);
  check("no change shows the connected address", sendAsLabel(ACCOUNT) === ACCOUNT, sendAsLabel(ACCOUNT));

  // A record with no main address: nothing to change.
  settings.clear();
  directory({ main: null, addresses: ["abc123@dept.uni.example"] });
  await refreshExchangeOwnAddresses([ACCOUNT]);
  check("no main address shows the connected address", sendAsLabel(ACCOUNT) === ACCOUNT);

  // A mailbox that is no longer connected is not shown under another one.
  directory({ main: MAIN, addresses: [MAIN] });
  await refreshExchangeOwnAddresses([ACCOUNT]);
  await storedExchangeOwnAddresses(["dana@example.org"]);
  check("a removed mailbox's answer is not used", sendAsLabel(ACCOUNT) === ACCOUNT);
});
