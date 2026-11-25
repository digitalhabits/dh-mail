/**
 * A searched Outlook thread opens on its newest match.
 *
 * Microsoft's search answers in no promised order, and the thread opened
 * on the first message it named: in a long thread, the top, where the word
 * first came up (a tester, 2026-11-24). The people here are invented.
 */

import { listOutlookConversationSummaries } from "@/lib/outlook/api";

import { check, suite } from "./harness.mjs";

const message = (id, at) => ({
  id,
  conversationId: "conv-1",
  receivedDateTime: at,
  sentDateTime: at,
  isRead: true,
  isDraft: false,
  subject: "Brobygning",
  from: { emailAddress: { name: "Ida Holm", address: "ida@north.example" } },
});

suite(async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        // Best match first, as a search may answer: the oldest message.
        value: [
          message("first", "2026-11-01T09:00:00Z"),
          message("newest", "2026-11-20T09:00:00Z"),
          message("middle", "2026-11-10T09:00:00Z"),
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const { conversations } = await listOutlookConversationSummaries("at", { q: "brobygning", maxConversations: 10 });
  check("one conversation", conversations.length === 1);
  check("it opens on the newest match", conversations[0]?.focusMessageId === "newest");
  check("and that is its latest message too", conversations[0]?.latest.id === "newest");
  check("all three counted", conversations[0]?.messageCount === 3);
});
