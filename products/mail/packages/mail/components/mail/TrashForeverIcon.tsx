"use client";

import * as React from "react";

/**
 * A red one step softer than the red of an error. The full red (#dc2626)
 * drew the eye to this corner of the toolbar every time the reader opened
 * Trash, for an action they seldom want. A muted brick (#c2665a) went too
 * far the other way: beside the warm grey icons it read as brown, and brown
 * is not a warning. This is halfway between the two.
 */
const WARNING = "#cf4640";

/**
 * The icon for "Delete forever": the bin that Delete uses, with a warning
 * triangle on its corner.
 *
 * The bin is the one the reader already knows from Delete, so the icon says
 * "this deletes" before anything else. The triangle says that this delete is
 * the one with no way back. A different object, such as a shredder, asked the
 * reader to learn a new picture for an action they meet rarely.
 *
 * Drawn to the same grid and stroke as the lucide icons beside it, so it can
 * stand in a toolbar or a menu wherever one of those can. The bin is masked
 * where the triangle sits, so the two do not run into each other on any
 * background. The triangle is a soft red in both themes. The mark in it is cut out,
 * and shows whatever is behind the icon.
 */
export function TrashForeverIcon(props: React.SVGProps<SVGSVGElement>) {
  const id = React.useId();
  const binMask = `${id}-bin`;
  const markMask = `${id}-mark`;
  const triangle = "M17.5 11.5 23.2 21.5H11.8Z";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <defs>
        <mask id={binMask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" stroke="none" />
          <path d={triangle} fill="black" stroke="black" strokeWidth="4" />
        </mask>
        <mask id={markMask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" stroke="none" />
          <path d="M17.5 15.2v2.6" stroke="black" strokeWidth="1.6" />
          <path d="M17.5 19.9h.01" stroke="black" strokeWidth="1.8" />
        </mask>
      </defs>
      <g mask={`url(#${binMask})`}>
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </g>
      <path
        d={triangle}
        fill={WARNING}
        stroke={WARNING}
        strokeWidth="1.5"
        mask={`url(#${markMask})`}
      />
    </svg>
  );
}
