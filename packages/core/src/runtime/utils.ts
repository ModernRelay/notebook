/** Small dependency-free helpers shared across the runtime modules. */

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function stringProp(
  props: Record<string, unknown>,
  key: string,
): string | null {
  const value = props[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
