// Browser-safe surface. Node-only `loadFixture` lives at
// `@modernrelay/notebook-fixture/node` so bundlers don't pull in `node:fs` / `node:path`.
export {
  parseFixture,
  FixtureSchema,
  FixtureNodeSchema,
  FixtureEdgeSchema,
  type Fixture,
  type FixtureNode,
  type FixtureEdge,
} from "./validator.js";

export {
  runFixtureQuery,
  type QueryResult,
  type ResultRow,
} from "./runner.js";

export {
  FixtureSource,
  type FixtureReadInput,
  type FixtureReadOutput,
} from "./source.js";
