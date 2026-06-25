// @modernrelay/notebook-core — the notebook engine and front door.
// Three internal modules, one public surface:
//   spec/     Zod schemas + YAML parser for the notebook wire format + ref/rawGq query model
//   catalog/  renderer-agnostic component/action definitions + spec assembler
//   runtime/  capability-aware execution, state, dependency invalidation, mutations
export * from "./spec/index.js";
export * from "./catalog/index.js";
export * from "./runtime/index.js";
