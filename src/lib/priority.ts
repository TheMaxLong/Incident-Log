import type { Incident, Priority } from "../types";

/**
 * Legacy records carry only `urgent?: boolean`. Never rewrite them — resolve on read.
 * Neutral ("") is a real, chosen state: no marker, no colour.
 */
export function resolvePriority(inc: Pick<Incident, "priority" | "urgent">): Priority {
  return inc.priority ?? (inc.urgent ? "urgent" : "");
}

/** Sort weight. Urgent first, completed last, neutral in between. */
export function priorityRank(p: Priority): number {
  switch (p) {
    case "urgent": return 0;
    case "moderate": return 1;
    case "completed": return 3;
    default: return 2;
  }
}

export const PRIORITY_LABEL: Record<Exclude<Priority, "">, string> = {
  urgent: "URGENT **",
  moderate: "MODERATE",
  completed: "COMPLETED",
};

/** Dark-app palette (screen). */
export const PRIORITY_UI: Record<Exclude<Priority, "">, { fg: string; bg: string; border: string; rail: string }> = {
  urgent:    { fg: "#dc2626", bg: "#1a0000", border: "#7f1d1d", rail: "#dc2626" },
  moderate:  { fg: "#eab308", bg: "#1a1400", border: "#713f12", rail: "#eab308" },
  completed: { fg: "#22c55e", bg: "#001a0a", border: "#14532d", rail: "#22c55e" },
};

/** The three buttons, in the order they appear on the form. */
export const PRIORITY_OPTIONS: Exclude<Priority, "">[] = ["urgent", "moderate", "completed"];
