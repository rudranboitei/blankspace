"use client";

import { Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ListenButton({
  isSpeaking,
  disabled,
  onToggle,
  label,
}: {
  isSpeaking: boolean;
  disabled?: boolean;
  onToggle: () => void;
  /** Names the phrase for screen readers, e.g. "the phrase" or "the pattern". */
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("size-9 shrink-0", isSpeaking && "border-ring text-foreground")}
      aria-label={isSpeaking ? `Stop reading ${label}` : `Hear ${label}`}
      aria-pressed={isSpeaking}
      onClick={onToggle}
      disabled={disabled}
    >
      {isSpeaking ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
    </Button>
  );
}