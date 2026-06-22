import type { Notebook } from "../spec/index.js";
import type { SourceCapabilities } from "./types.js";
import { actionListMutations } from "./mutations.js";

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
      warnings.push(
        `${cell.id}: query.rawGq is a capability-gated escape hatch; prefer a catalog query.ref`,
      );
      if (!capabilities.rawGq) {
        errors.push(`${cell.id}: selected source does not support raw .gq`);
      }
    }
    if (cell.query?.branch !== undefined && !capabilities.branchReads) {
      errors.push(`${cell.id}: selected source does not support branch reads`);
    }
    if (cell.query?.snapshot !== undefined && !capabilities.snapshotReads) {
      errors.push(`${cell.id}: selected source does not support snapshot reads`);
    }

    for (const mutation of actionListMutations(cell)) {
      if (!capabilities.mutationKinds.includes(mutation.kind)) {
        errors.push(
          `${cell.id}: selected source does not support ${mutation.kind} mutations`,
        );
      }
    }
  }

  return { errors, warnings };
}
