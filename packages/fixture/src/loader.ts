import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFixture, type Fixture } from "./validator.js";

/**
 * Load and validate a JSON fixture from disk. Node-only (uses fs).
 * For browsers, import the JSON some other way and call `parseFixture`.
 */
export function loadFixture(path: string): Fixture {
  const abs = resolve(path);
  const raw: unknown = JSON.parse(readFileSync(abs, "utf8"));
  return parseFixture(raw, path);
}
