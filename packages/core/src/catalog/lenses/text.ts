import { z } from "zod";

/**
 * Prose card: renders the first result row's text column as **Markdown** — a
 * node's definition, notes, or body, read as a formatted block. Pair with a
 * single-node query (often bound to a selection via $state). Distinct from Card
 * (a labeled key:value field list) and Quote (a one-line citation feed): Text is
 * one featured prose block.
 */
export const TextAuthorPropsSchema = z.object({
  /** Column used as a heading above the prose (e.g. the node's name). */
  title_column: z.string().optional(),
  /** Column holding the Markdown body — required (a Text card's reason to exist). */
  text_column: z.string().min(1),
  /** Shown when the query returns no row (e.g. nothing selected yet). */
  empty_text: z.string().optional(),
});
export type TextAuthorProps = z.infer<typeof TextAuthorPropsSchema>;

export const TextRuntimePropsSchema = TextAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TextRuntimeProps = z.infer<typeof TextRuntimePropsSchema>;

export const TextDescription =
  "Prose card — renders the first result row's text column as Markdown (a node's definition/notes/body), with an optional title heading. Drive it with a single-node query, often bound to a selection via $state. Distinct from Card (labeled fields) and Quote (citation feed).";
