/**
 * A filter can take a recipient list: a link, so it follows the list.
 * All people and lists here are invented.
 */

import { threadMatchesCustomList, withGroupMembers } from "@/lib/mail/custom-lists";
import { check, suite } from "./harness.mjs";

const filter = (members, groups) => ({ id: "f1", name: "Family", members, ...(groups ? { groups } : {}) });
const person = (email, name = "") => ({ email, name });
const thread = (email) => ({ fromEmail: email, externalParticipants: [{ email }] });

suite(async () => {
  const lists = [{ id: "L1", name: "Cousins", members: [person("Ann@Kin.test", "Ann"), person("bo@kin.test", "Bo")] }];

  const plain = filter([person("vera@mail.test")]);
  check("a filter with no lists is the same filter", withGroupMembers(plain, lists) === plain);

  const linked = withGroupMembers(filter([person("vera@mail.test")], [{ id: "L1", name: "Cousins" }]), lists);
  check("a linked list's people are matched", threadMatchesCustomList(thread("ann@kin.test"), linked));
  check("the filter's own people still are", threadMatchesCustomList(thread("vera@mail.test"), linked));
  check("nobody else is", !threadMatchesCustomList(thread("cy@else.test"), linked));

  const onlyList = withGroupMembers(filter([], [{ id: "L1", name: "Cousins" }]), lists);
  check("a filter of only a list works", threadMatchesCustomList(thread("bo@kin.test"), onlyList));

  const grown = [{ ...lists[0], members: [...lists[0].members, person("di@kin.test")] }];
  check(
    "it follows the list when someone joins",
    threadMatchesCustomList(thread("di@kin.test"), withGroupMembers(filter([], [{ id: "L1", name: "Cousins" }]), grown))
  );

  const gone = withGroupMembers(filter([], [{ id: "L9", name: "Deleted" }]), lists);
  check("a list that is gone adds nobody", gone.members.length === 0 && !threadMatchesCustomList(thread("ann@kin.test"), gone));

  const both = withGroupMembers(filter([person("ann@kin.test", "Ann K")], [{ id: "L1", name: "Cousins" }]), lists);
  check("a person on both is there once", both.members.filter((m) => m.email === "ann@kin.test").length === 1);
});
