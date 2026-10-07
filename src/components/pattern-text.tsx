import { Fragment, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const SLOT_PATTERN = /\{([^{}]+)\}/g;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "slot"; text: string; index: number };

function splitSlots(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let slotIndex = 0;

  for (const match of text.matchAll(SLOT_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, start) });
    }
    segments.push({ kind: "slot", text: match[1], index: slotIndex });
    slotIndex += 1;
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments;
}

/**
 * Renders `{braces}` from the API as marked slots. With `reveal`, the slot
 * underlines draw in, the one animated moment in the app.
 */
export function PatternText({
  text,
  className,
  reveal = false,
  children,
}: {
  text: string;
  className?: string;
  reveal?: boolean;
  children?: ReactNode;
}) {
  const segments = splitSlots(text);

  return (
    <span className={cn(reveal && "slot-reveal", className)}>
      {segments.map((segment, position) =>
        segment.kind === "slot" ? (
          <span
            key={position}
            className="slot"
            style={{ "--i": segment.index } as CSSProperties}
          >
            {segment.text}
          </span>
        ) : (
          <Fragment key={position}>{segment.text}</Fragment>
        ),
      )}
      {children}
    </span>
  );
}