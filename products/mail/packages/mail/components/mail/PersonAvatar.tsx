"use client";

import { SenderAvatar } from "@/components/mail/SenderAvatar";

import { type PersonRow } from "@/lib/mail/person-participants";
import { cn } from "@/lib/utils";

export function PersonAvatar({
  row,
  onNavy = false,
  size = 36,
}: {
  row: PersonRow;
  onNavy?: boolean;
  /** Side of the square, in px. Layouts below are for 36. */
  size?: number;
}) {
  // A person under several addresses is still one face; only a group row
  // shows a pile.
  const people = row.isGroup
    ? row.people
    : row.email
      ? [{ name: row.name, email: row.email }]
      : row.people.slice(0, 1);
  const count = row.participantCount || people.length;
  const scale = size / 36;
  const px = (n: number) => Math.round(n * scale);
  const ring =
    "0 0 0 1.5px var(--mail-person-stack-ring, var(--mail-chrome))";

  type Slot = {
    left: number;
    top: number;
    disc: number;
    person?: { name: string; email: string };
    extra?: number;
  };
  let slots: Slot[];
  if (count <= 1) {
    // Full box. Insetting the common case shrinks every ordinary row.
    slots = [{ left: 0, top: 0, disc: size, person: people[0] }];
  } else if (count === 2) {
    const disc = px(24);
    slots = [
      { left: 0, top: 0, disc, person: people[0] },
      { left: px(12), top: px(12), disc, person: people[1] },
    ];
  } else {
    const disc = px(22);
    slots = [
      { left: px(6), top: 0, disc, person: people[0] },
      { left: 0, top: px(14), disc, person: people[1] },
    ];
    if (count === 3) {
      slots.push({ left: px(14), top: px(14), disc, person: people[2] });
    } else {
      slots.push({ left: px(14), top: px(14), disc, extra: count - 2 });
    }
  }

  return (
    <span
      aria-hidden
      className="relative box-border shrink-0"
      style={{ width: size, height: size }}
    >
      {slots.map((slot, i) =>
        slot.extra != null ? (
          <span
            key="more"
            className="absolute box-border inline-flex items-center justify-center rounded-full bg-[var(--mail-chrome)] font-bold text-[var(--mail-chrome-muted)]"
            style={{
              left: slot.left,
              top: slot.top,
              width: slot.disc,
              height: slot.disc,
              fontSize: Math.max(8, Math.round(slot.disc * 0.38)),
              boxShadow: ring,
            }}
          >
            +{slot.extra}
          </span>
        ) : slot.person ? (
          <span
            key={slot.person.email || String(i)}
            className="absolute box-border overflow-hidden rounded-full"
            style={{
              left: slot.left,
              top: slot.top,
              width: slot.disc,
              height: slot.disc,
              boxShadow: ring,
            }}
          >
            <SenderAvatar
              name={slot.person.name}
              email={slot.person.email}
              logoUrl={
                people.length === 1 ||
                slot.person.email.toLowerCase() === row.email.toLowerCase()
                  ? row.crmLogoUrl
                  : undefined
              }
              onNavy={onNavy}
              size={slot.disc}
            />
          </span>
        ) : null
      )}
      {row.unread ? (
        <span
          className={cn(
            "absolute h-2 w-2 rounded-full bg-[var(--mail-accent)] ring-2",
            onNavy ? "ring-reddNavy" : "ring-[#faf8f5]"
          )}
          style={{ top: 0, left: size - 8 }}
        />
      ) : null}
    </span>
  );
}
