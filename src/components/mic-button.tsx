"use client";

import { Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MicButton({
  isListening,
  disabled,
  onToggle,
}: {
  isListening: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={isListening ? "Stop listening" : "Speak your answer"}
      aria-pressed={isListening}
      onClick={onToggle}
      disabled={disabled}
      className={cn(isListening && "border-ring text-foreground")}
    >
      <Mic aria-hidden />
    </Button>
  );
}