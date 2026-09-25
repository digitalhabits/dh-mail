/**
 * The people in a thread, as its heading names them: each other sender by
 * short name, in the order they first wrote, and "You" last when any of
 * the messages are ours.
 *
 * The Gmail, Outlook and local-copy readers all name a thread this way.
 */

export function participantNames(
  messages: { own?: boolean; fromName: string; fromEmail: string }[]
): string[] {
  const names: string[] = [];
  let hasOwn = false;
  for (const m of messages) {
    if (m.own) {
      hasOwn = true;
      continue;
    }
    const short = m.fromName.split("<")[0].trim() || m.fromEmail;
    if (!names.includes(short)) names.push(short);
  }
  if (hasOwn) names.push("You");
  return names;
}
