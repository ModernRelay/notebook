import { describe, it, expect } from "vitest";
import { translateMutation, UnsupportedTranslationError } from "./translate.js";

describe("translateMutation", () => {
  it("set_field becomes a parameterized update", () => {
    const r = translateMutation({
      kind: "set_field",
      target_type: "PolicyClause",
      field: "status",
      value: "approved",
      target_id: "pdr-c1",
    });
    expect(r.query_source).toContain(
      "update PolicyClause set { status: $value } where slug = $target_id",
    );
    expect(r.query_source).toContain("$value: String");
    expect(r.query_source).toContain("$target_id: String");
    expect(r.params).toEqual({ value: "approved", target_id: "pdr-c1" });
  });

  it("rejects a suspicious field name", () => {
    expect(() =>
      translateMutation({
        kind: "set_field",
        target_type: "PolicyClause",
        field: "bad field",
        value: "x",
        target_id: "c1",
      }),
    ).toThrow(UnsupportedTranslationError);
  });
});
