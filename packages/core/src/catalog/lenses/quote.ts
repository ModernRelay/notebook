import { z } from "zod";

/**
 * Quotation feed: renders each row as a blockquote of its text column with a
 * source citation (+ optional metadata) beneath — for highlights, comments,
 * annotations, or any text-with-provenance. Distinct from Timeline (an event
 * feed of actor/verb/target): Quote is utterance-centric — the text dominates;
 * the source is a small caption.
 */
export const QuoteAuthorPropsSchema = z.object({
  /** Column holding the quotation text — required (the dominant element). */
  text_column: z.string().min(1),
  /** Column holding the source citation (e.g. an artifact title). */
  source_column: z.string().optional(),
  /**
   * Extra citation columns (e.g. author, year), shown after the source and
   * joined with " · ". Empty/absent values are skipped.
   */
  meta_columns: z.array(z.string().min(1)).optional(),
  /** Shown when the query returns no rows. */
  empty_text: z.string().optional(),
});
export type QuoteAuthorProps = z.infer<typeof QuoteAuthorPropsSchema>;

export const QuoteRuntimePropsSchema = QuoteAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type QuoteRuntimeProps = z.infer<typeof QuoteRuntimePropsSchema>;

export const QuoteDescription =
  "Quotation feed — renders each row as a blockquote of its text column with a source citation and optional metadata (author, year) joined by ' · ' beneath. For highlights, comments, or annotations. Unlike Timeline (an actor/verb/target event feed), Quote is utterance-centric: the text dominates.";
