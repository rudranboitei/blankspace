"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TOPICS, TOPIC_LABELS, type Topic } from "@/lib/topics";

export function TopicTabs({
  value,
  onChange,
  disabled,
}: {
  value: Topic;
  onChange: (topic: Topic) => void;
  disabled?: boolean;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as Topic)}
      aria-label="Practice topic"
    >
      <TabsList className="w-full">
        {TOPICS.map((topic) => (
          <TabsTrigger key={topic} value={topic} disabled={disabled}>
            {TOPIC_LABELS[topic]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}