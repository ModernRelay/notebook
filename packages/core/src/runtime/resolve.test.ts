import { describe, it, expect } from "vitest";
import { resolveMutationParams, resolveParams } from "./resolve.js";

describe("resolveMutationParams", () => {
  const row = { id: "c1", email: "ada@example.com" };
  const state = { sel: "open-source-engine", filters: { status: "open" } };

  it("resolves top-level $row and $state markers", () => {
    expect(
      resolveMutationParams(
        { clause: { $row: "id" }, decision: { $state: "/sel" } },
        row,
        state,
      ),
    ).toEqual({ clause: "c1", decision: "open-source-engine" });
  });

  it("resolves a $row marker nested inside a list", () => {
    expect(
      resolveMutationParams({ ids: [{ $row: "id" }, "x"] }, row, state),
    ).toEqual({ ids: ["c1", "x"] });
  });

  it("resolves a $state marker nested inside an object", () => {
    expect(
      resolveMutationParams(
        { filter: { by: { $state: "/filters/status" } } },
        row,
        state,
      ),
    ).toEqual({ filter: { by: "open" } });
  });

  it("applies $state default when the pointer is empty (nested too)", () => {
    expect(
      resolveMutationParams(
        { a: { $state: "/missing", default: "fallback" } },
        row,
        {},
      ),
    ).toEqual({ a: "fallback" });
  });

  it("passes literals through unchanged", () => {
    expect(
      resolveMutationParams({ n: 5, s: "x", flag: true }, row, state),
    ).toEqual({ n: 5, s: "x", flag: true });
  });

  it("returns {} for absent params", () => {
    expect(resolveMutationParams(undefined, row, state)).toEqual({});
  });
});

describe("resolveParams (read side, same recursive resolver)", () => {
  it("resolves a $state marker nested inside a list", () => {
    expect(
      resolveParams({ tags: [{ $state: "/t" }, "lit"] }, { t: "v" }),
    ).toEqual({ tags: ["v", "lit"] });
  });

  it("leaves a top-level $state marker resolving as before", () => {
    expect(resolveParams({ status: { $state: "/s" } }, { s: "open" })).toEqual({
      status: "open",
    });
  });
});
