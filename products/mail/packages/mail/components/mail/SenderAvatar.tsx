"use client";

import * as React from "react";
import { avatarStyle, senderInitials } from "@/components/mail/avatar";
import { teamAvatarSrc } from "@/lib/mail/team-avatars";
import { cn } from "@/lib/utils";

/**
 * Sender glyph for list rows: CRM logo when known, otherwise hashed initials
 * (compose contact-list style). Unread sits on the avatar corner.
 */
export function SenderAvatar({
  name,
  email,
  logoUrl,
  unread = false,
  onNavy = false,
  className,
  size,
}: {
  name: string;
  email: string;
  logoUrl?: string;
  unread?: boolean;
  onNavy?: boolean;
  className?: string;
  /** Disc size in px. Initials follow this, not the row. */
  size?: number;
}) {
  const [logoFailed, setLogoFailed] = React.useState(false);
  React.useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);
  const [photoFailed, setPhotoFailed] = React.useState(false);

  const teamPhoto = teamAvatarSrc(email);
  const showLogo = Boolean(logoUrl) && !logoFailed;
  const seed = email || name;

  return (
    <span
      aria-hidden
      className={cn(
        "relative box-border shrink-0",
        size ? undefined : "h-9 w-9",
        className
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      {teamPhoto && !photoFailed ? (
        <img
          src={teamPhoto}
          alt=""
          className="h-full w-full rounded-full object-cover"
          onError={() => setPhotoFailed(true)}
        />
      ) : showLogo ? (
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
          {/*
            The logo's own address, loaded straight.

            This went through the planner's picture proxy, which is a path
            on the planner: fine on the web, where the page is the planner,
            and a dead end in a desktop pane, whose origin is the app itself
            — every logo there was a broken-image mark. A logo is a public
            picture and an <img> needs no permission to show one, so it is
            asked for directly. No referrer, because the bucket the team's
            own logos live in refuses a referrer it does not know.
          */}
          <img
            src={logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full rounded-full object-cover"
            onError={() => setLogoFailed(true)}
          />
        </span>
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center rounded-full font-semibold",
            !size && "text-[11px]",
            avatarStyle(seed.toLowerCase())
          )}
          style={
            size
              ? { fontSize: Math.max(7, Math.round((size * 11) / 36)) }
              : undefined
          }
        >
          {senderInitials(name, email)}
        </span>
      )}
      {unread ? (
        <span
          className={cn(
            // One teal in both themes — see --mail-accent. It was a lighter
            // one on navy, which made the same mark two colours depending
            // on which theme you had.
            "absolute right-0 top-0 h-2 w-2 rounded-full bg-[var(--mail-accent)] ring-2",
            onNavy ? "ring-reddNavy" : "ring-[#faf8f5]"
          )}
        />
      ) : null}
    </span>
  );
}

/** Empty selection means every connected mailbox is in scope. */
