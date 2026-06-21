import type { Cell, MutationParams, MutationSpec } from "../spec/index.js";
import { MutationSpecSchema } from "../spec/index.js";

export interface OptimisticPatch {
  key: string;
  targetType: string;
  targetId: string;
  field: string;
  value: unknown;
  saving: boolean;
  error?: string;
}

export function actionListMutations(cell: Cell): MutationSpec[] {
  const actions = Array.isArray(cell.props.actions) ? cell.props.actions : [];
  const out: MutationSpec[] = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const mutation = (action as Record<string, unknown>).mutation;
    if (!mutation || typeof mutation !== "object") continue;
    const parsed = MutationSpecSchema.safeParse(mutation);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function actionListMutationTargetTypes(cell: Cell): Set<string> {
  const out = new Set<string>();
  for (const mutation of actionListMutations(cell)) {
    if ("target_type" in mutation) out.add(mutation.target_type);
  }
  return out;
}

export function patchFromMutation(
  params: MutationParams,
): OptimisticPatch | null {
  switch (params.kind) {
    case "set_field":
      return {
        key: patchKey(params.target_type, params.target_id, params.field),
        targetType: params.target_type,
        targetId: params.target_id,
        field: params.field,
        value: params.value,
        saving: true,
      };
  }
}

export function patchKey(
  targetType: string,
  targetId: string,
  field: string,
): string {
  return `${targetType}:${targetId}:${field}`;
}
