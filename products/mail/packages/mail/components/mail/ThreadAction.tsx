"use client";

import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThreadAction({
  label,
  icon: Icon,
  className,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement>>;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(THREAD_ACTION_CLASS, className)}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}
