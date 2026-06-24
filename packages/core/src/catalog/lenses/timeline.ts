import { z } from "zod";

/**
 * Simple chronological activity feed. Each row is one event; the author maps
 * columns to the event's actor / verb / target / timestamp / body. Ordering is
 * the query's job (`order { … desc }`) — the lens renders rows as given.
 * (Richer events — icons, refs, diffs, inline actions — come later.)
 */
export const TimelineAuthorPropsSchema = z.object({
  /** Column for the actor / author of the event. */
  actor_column: z.string().optional(),
  /** Column for the verb / action (e.g. "added context", "made a change"). */
  verb_column: z.string().optional(),
  /** Column for the target the event is about. */
  target_column: z.string().optional(),
  /** Column for the timestamp (rendered as-is for now). */
  timestamp_column: z.string().optional(),
  /** Column for an optional note/body shown beneath the event line. */
  body_column: z.string().optional(),
});
export type TimelineAuthorProps = z.infer<typeof TimelineAuthorPropsSchema>;

export const TimelineRuntimePropsSchema = TimelineAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TimelineRuntimeProps = z.infer<typeof TimelineRuntimePropsSchema>;

export const TimelineDescription =
  "Renders rows as a chronological activity feed — one event per row with an actor, verb, target, timestamp, and optional body. Order the query server-side; rows render top-to-bottom as returned.";
