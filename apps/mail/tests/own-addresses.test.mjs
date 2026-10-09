import {
  isOwnOrgAddress,
  isOwnPersonalAddress,
  normalizeEmail,
  ownMailIdentity,
  setOwnMailIdentity,
} from "@/lib/own-addresses";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- Nothing configured -------------------------------------------------
  // The state a fresh install starts in, and the one an open-source build has
  // until its owner says who they are.
  setOwnMailIdentity({ addresses: [], domains: [] });
  check("with nothing set, no address is yours", !isOwnPersonalAddress("a@b.com"));
  check("and nobody is a colleague", !isOwnOrgAddress("a@b.com"));

  // ---- One person, personal mailboxes -------------------------------------
  setOwnMailIdentity({
    addresses: ["Me@Gmail.com", "me@work.example"],
    domains: [],
  });
  check("your own mailbox is yours", isOwnPersonalAddress("me@gmail.com"));
  check("the case it was written in does not matter", isOwnPersonalAddress("ME@GMAIL.COM"));
  check("a plus tag is the same mailbox", isOwnPersonalAddress("me+newsletters@gmail.com"));
  check("gmail ignores dots", isOwnPersonalAddress("m.e@gmail.com"));
  check("someone else is not you", !isOwnPersonalAddress("you@gmail.com"));

  // The important half of leaving domains empty: with a personal Gmail
  // address, every other Gmail user must stay a stranger.
  check(
    "no colleagues without org domains, even on your own provider",
    !isOwnOrgAddress("someone.else@gmail.com")
  );
  check("but you are still 'you' for org purposes", isOwnOrgAddress("me@gmail.com"));

  // ---- An organization -----------------------------------------------------
  setOwnMailIdentity({
    addresses: ["owner@example.org"],
    domains: ["example.org", "Example.NET"],
  });
  check("anyone on an org domain is a colleague", isOwnOrgAddress("colleague@example.org"));
  check("domains are matched without case", isOwnOrgAddress("colleague@example.net"));
  check("someone outside is not", !isOwnOrgAddress("client@elsewhere.example"));

  // The distinction that matters most: a shared mailbox is the organization's,
  // not one person's. Treating team@ as yours strips it from reply-all, and
  // the colleagues who read it never get the reply.
  check("a shared org mailbox is a colleague", isOwnOrgAddress("team@example.org"));
  check(
    "but it is NOT you, so replies still reach it",
    !isOwnPersonalAddress("team@example.org")
  );

  // ---- Replacing, not accumulating ----------------------------------------
  // A disconnected mailbox has to stop counting, or it keeps being stripped
  // from replies long after it is gone.
  setOwnMailIdentity({ addresses: ["only@me.com"] });
  check("setting addresses replaces them", !isOwnPersonalAddress("owner@example.org"));
  check("with the new one in place", isOwnPersonalAddress("only@me.com"));
  check(
    "and domains are untouched when not given",
    isOwnOrgAddress("colleague@example.org")
  );

  // ---- What a settings screen would read ----------------------------------
  setOwnMailIdentity({ addresses: ["b@x.com", "a@x.com"], domains: ["x.com"] });
  const identity = ownMailIdentity();
  check(
    "the identity reads back, sorted",
    identity.addresses.join() === "a@x.com,b@x.com" && identity.domains.join() === "x.com",
    JSON.stringify(identity)
  );

  // ---- Normalising --------------------------------------------------------
  check("normalize lowercases", normalizeEmail(" A@B.COM ") === "a@b.com");
  check("normalize drops a plus tag", normalizeEmail("a+x@b.com") === "a@b.com");
  check("normalize keeps dots outside gmail", normalizeEmail("a.b@c.com") === "a.b@c.com");
  check("a string with no @ is left alone", normalizeEmail("nonsense") === "nonsense");
});
