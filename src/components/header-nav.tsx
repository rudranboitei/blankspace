"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Practice" },
  { href: "/library", label: "Library" },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex items-baseline gap-3">
      {LINKS.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-sm text-[15px] leading-[22px] transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}