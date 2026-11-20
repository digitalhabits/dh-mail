"use client";

import * as React from "react";
import { avatarStyle, senderInitials } from "@/components/mail/avatar";
import { pictureAddress } from "@/lib/mail/image-proxy";
import { teamAvatarSrc } from "@/lib/mail/team-avatars";
import { cn } from "@/lib/utils";

/**
 * Sender glyph for list rows: a logo when known, otherwise hashed initials
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
  /*
    The initials stay until the logo has loaded, and not only until it
    fails. A picture that the page's policy refuses is not drawn, and the
    webview tells no error for it. With no initials under it, the face is
    an empty place: every contact with a logo was blank in the list.
  */
  const [logoLoaded, setLogoLoaded] = React.useState(false);
  React.useEffect(() => {
    setLogoFailed(false);
    setLogoLoaded(false);
  }, [logoUrl]);
  const [photoFailed, setPhotoFailed] = React.useState(false);

  const teamPhoto = teamAvatarSrc(email);
  const showLogo = Boolean(logoUrl) && !logoFailed;
  const seed = email || name;
  const initials = (
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
  );

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
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
          {logoLoaded ? null : initials}
          {/*
            Asked for through the host's picture channel (pictureAddress).
            On the web that is the logo's own address. In the desktop app
            it is the channel native code answers, because the app's page
            may not load a picture from the bucket the logos live in.
          */}
          <img
            src={pictureAddress(logoUrl ?? "")}
            alt=""
            referrerPolicy="no-referrer"
            className={cn(
              "h-full w-full rounded-full object-cover",
              logoLoaded ? undefined : "absolute inset-0 opacity-0"
            )}
            onLoad={() => setLogoLoaded(true)}
            onError={() => setLogoFailed(true)}
          />
        </span>
      ) : (
        initials
      )}
      {unread ? (
        <span
          className={cn(
            // One teal in both themes — see --mail-accent. A lighter one on
            // navy makes the same mark two colours, one for each theme.
            "absolute right-0 top-0 h-2 w-2 rounded-full bg-[var(--mail-accent)] ring-2",
            onNavy ? "ring-brandNavy" : "ring-[#f5f1ea]"
          )}
        />
      ) : null}
    </span>
  );
}

/** Empty selection means every connected mailbox is in scope. */
