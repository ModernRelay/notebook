/**
 * Translate a notebook mutation spec into omnigraph `.gq` source.
 *
 * Reads no longer translate client-side — they invoke server-owned catalog
 * queries by name (`ServerSource.read` → `og.queries.invoke`). Only the
 * interim `set_field` write path still compiles `.gq` here; it moves
 * server-side with the Phase 3 write model (dash-books-canon.md §4.5).
 */

import type { MutationParams } from "@modernrelay/notebook-core";

export interface TranslatedQuery {
  query_source: string;
  query_name: string;
  params: Record<string, unknown>;
}

export class UnsupportedTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTranslationError";
  }
}

const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * MutationParams → one `.gq` mutation.
 *
 *   set_field { target_type, field, value, target_id }
 *     →  update <target_type> set { <field>: $value } where slug = $target_id
 *
 * Server commits one manifest version per call (atomic).
 */
export function translateMutation(
  params: MutationParams,
  queryName = "ng_mutate",
): TranslatedQuery {
  switch (params.kind) {
    case "set_field": {
      if (!FIELD_PATTERN.test(params.field)) {
        throw new UnsupportedTranslationError(
          `translateMutation: invalid field name '${params.field}'`,
        );
      }
      // v0.7 only supports String-typed values (covers enum + plain text);
      // numeric/boolean field types land alongside richer mutation kinds.
      const decls = `($value: String, $target_id: String)`;
      // The server-side @key field is conventionally named `slug` (Lance
      // reserves `id` for the row-id). Mutations identify rows by slug; the
      // cell author writes `target_id` from the row's exposed `id` column
      // (projected from `slug`).
      const body =
        `update ${params.target_type} set { ${params.field}: $value } where slug = $target_id`;
      return {
        query_name: queryName,
        query_source: `query ${queryName}${decls} {\n${body}\n}\n`,
        params: { value: params.value, target_id: params.target_id },
      };
    }
  }
}
