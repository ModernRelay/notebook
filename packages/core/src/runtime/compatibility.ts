import type { Notebook } from "../spec/index.js";
import type { SourceCapabilities } from "./types.js";
import { cellMutations } from "./mutations.js";

interface CompatibilityResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate a notebook against a source's declared capabilities. Returns
 * blocking `errors` (the runtime goes `fatal`) and non-blocking `warnings`
 * (e.g. deprecated raw `.gq`).
 */
export function validateNotebookCompatibility(
  notebook: Notebook,
  capabilities: SourceCapabilities,
): CompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const cell of notebook.cells) {
    if (cell.query?.ref !== undefined && !capabilities.namedQueries) {
      errors.push(
        `${cell.id}: selected source does not support named catalog queries (query.ref)`,
      );
    }
    if (cell.query?.rawGq !== undefined) {
      if (!capabilities.rawGq) {
        // Off by default in production/operator contexts — fatal unless the
        // explicit dev/CLI escape hatch is enabled.
        errors.push(
          `${cell.id}: raw .gq is disabled — enable the dev/CLI escape hatch (--allow-raw-gq or ?allowRawGq) or use a catalog query.ref`,
        );
      } else {
        warnings.push(
          `${cell.id}: query.rawGq is a capability-gated escape hatch; prefer a catalog query.ref`,
        );
      }
    }
    if (cell.query?.branch !== undefined && !capabilities.branchReads) {
      errors.push(`${cell.id}: selected source does not support branch reads`);
    }
    if (cell.query?.snapshot !== undefined && !capabilities.snapshotReads) {
      errors.push(`${cell.id}: selected source does not support snapshot reads`);
    }

    // Mutations mirror the read gate: `ref` needs named-query support; `rawGq`
    // is the capability-gated escape hatch (off by default).
    for (const mutation of cellMutations(cell)) {
      if (mutation.ref !== undefined && !capabilities.namedQueries) {
        errors.push(
          `${cell.id}: selected source does not support named catalog mutations (mutation.ref)`,
        );
      }
      if (mutation.rawGq !== undefined) {
        if (!capabilities.rawGq) {
          errors.push(
            `${cell.id}: raw .gq is disabled — enable the dev/CLI escape hatch (--allow-raw-gq or ?allowRawGq) or use a catalog mutation.ref`,
          );
        } else {
          warnings.push(
            `${cell.id}: mutation.rawGq is a capability-gated escape hatch; prefer a catalog mutation.ref`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}
