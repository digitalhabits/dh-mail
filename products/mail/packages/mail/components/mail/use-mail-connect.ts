import * as React from "react";

import { startMailConnect } from "@/lib/mail/connect-mailbox";
// The type comes from the contract, not from the module a host replaces: a
// replacement implements the functions, it does not re-export the types.
import type { MailConnectProvider } from "@/lib/mail/host/contracts";

/**
 * Which provider is being connected, so a button can say so.
 *
 * Connecting is slow and mostly invisible: a web host leaves the page for the
 * provider's sign-in, and the desktop app waits on a browser window somewhere
 * else. Without this a click looks like nothing happened, and the natural
 * response to that is to click again.
 *
 * On a host that navigates away, `startMailConnect` never settles and the
 * button stays busy until the page is replaced. That is the wanted behaviour,
 * not a leak: there is no "after" to reset for.
 */
export function useMailConnect(): {
  connecting: MailConnectProvider | null;
  connect: (provider: MailConnectProvider, email?: string) => void;
} {
  const [connecting, setConnecting] = React.useState<MailConnectProvider | null>(
    null
  );
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const connect = React.useCallback(
    (provider: MailConnectProvider, email?: string) => {
      setConnecting(provider);
      void startMailConnect(provider, email).finally(() => {
        if (alive.current) setConnecting(null);
      });
    },
    []
  );

  return { connecting, connect };
}
