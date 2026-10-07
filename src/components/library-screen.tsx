"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PatternText } from "@/components/pattern-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLibrary, type SavedPattern } from "@/hooks/use-library";
import { TOPIC_LABELS } from "@/lib/topics";

function matches(pattern: SavedPattern, query: string) {
  if (!query) return true;
  return [pattern.hindi, pattern.correctPhrase, pattern.pattern, pattern.note]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function SavedRow({ pattern, onRemove }: { pattern: SavedPattern; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-4 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Badge variant="outline">{TOPIC_LABELS[pattern.topic]}</Badge>
        <p className="font-sans text-[15px] leading-[22px] text-muted-foreground">
          {pattern.hindi}
        </p>
        <PatternText
          text={pattern.correctPhrase}
          className="block font-serif text-xl leading-[30px]"
        />
        <PatternText
          text={pattern.pattern}
          className="block font-serif text-[15px] leading-[22px] text-muted-foreground"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function ReviewRow({
  pattern,
  isRevealed,
  onReveal,
}: {
  pattern: SavedPattern;
  isRevealed: boolean;
  onReveal: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0">
      <p className="font-sans text-xl leading-[30px] font-medium">{pattern.hindi}</p>

      {isRevealed ? (
        <div className="flex flex-col gap-2">
          <PatternText
            text={pattern.correctPhrase}
            className="block font-serif text-xl leading-[30px]"
          />
          <PatternText
            text={pattern.pattern}
            className="block font-serif text-[15px] leading-[22px] text-muted-foreground"
          />
        </div>
      ) : (
        <div>
          <Button variant="ghost" size="sm" onClick={onReveal}>
            Show answer
          </Button>
        </div>
      )}
    </div>
  );
}

export function LibraryScreen() {
  const { patterns, remove, restore } = useLibrary();
  const [mode, setMode] = useState("saved");
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  const visible = useMemo(
    () => patterns.filter((pattern) => matches(pattern, query.trim().toLowerCase())),
    [patterns, query],
  );

  const handleRemove = (pattern: SavedPattern) => {
    remove(pattern.id);
    toast("Pattern removed", {
      action: {
        label: "Undo",
        onClick: () => restore(pattern),
      },
    });
  };

  const emptyMessage =
    patterns.length === 0
      ? "No saved patterns yet. Save one after you check an answer."
      : "No patterns match that search.";

  return (
    <div className="flex flex-col gap-5">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search patterns"
        aria-label="Search saved patterns"
      />

      <Tabs value={mode} onValueChange={setMode}>
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="saved">Saved</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>
          <Badge variant="outline">
            {patterns.length} {patterns.length === 1 ? "pattern" : "patterns"}
          </Badge>
        </div>

        <TabsContent value="saved">
          {visible.length === 0 ? (
            <p className="text-[15px] leading-[22px] text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div className="flex flex-col">
              {visible.map((pattern) => (
                <SavedRow key={pattern.id} pattern={pattern} onRemove={() => handleRemove(pattern)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="review">
          {visible.length === 0 ? (
            <p className="text-[15px] leading-[22px] text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div className="flex flex-col">
              {visible.map((pattern) => (
                <ReviewRow
                  key={pattern.id}
                  pattern={pattern}
                  isRevealed={revealed.has(pattern.id)}
                  onReveal={() =>
                    setRevealed((previous) => {
                      const next = new Set(previous);
                      next.add(pattern.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}