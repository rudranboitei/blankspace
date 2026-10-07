export const TOPICS = ["tech-work", "daily-life", "interview"] as const;

export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  "tech-work": "Tech and work",
  "daily-life": "Daily life",
  interview: "Interview",
};

/** Sent to the model so each topic pulls from a different pool of situations. */
export const TOPIC_BRIEFS: Record<Topic, string> = {
  "tech-work":
    "Workplace and software work: standups, code review, deadlines, deploys, asking for help, meetings, switching tasks, remote work.",
  "daily-life":
    "Everyday spoken Hindi: family, food, shopping, rent, travel, neighbours, plans with friends, small problems and requests.",
  interview:
    "Job interviews and introductions: strengths, gaps, salary, why this company, questions to ask, follow ups, thanking someone.",
};

export const DEFAULT_TOPIC: Topic = "tech-work";