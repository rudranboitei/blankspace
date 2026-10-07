"use client";

import { CircleAlert, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      visibleToasts={3}
      icons={{
        success: <Check aria-hidden className="size-4 text-correct" />,
        error: <CircleAlert aria-hidden className="size-4 text-fix" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-4 py-3 font-sans text-[15px] leading-[22px] text-card-foreground",
          icon: "flex size-4 shrink-0",
          content: "flex min-w-0 flex-1 flex-col gap-1",
          title: "font-normal",
          description: "text-[13px] leading-[18px] text-muted-foreground",
          actionButton:
            "shrink-0 rounded-md border border-border px-3 py-1 text-[13px] leading-[18px] text-foreground hover:bg-secondary",
          closeButton: "shrink-0 text-muted-foreground",
        },
      }}
    />
  );
}