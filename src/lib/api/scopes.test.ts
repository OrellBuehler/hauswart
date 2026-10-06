import { describe, expect, it } from "vitest";
import {
  SCOPES,
  effectiveScopes,
  isScope,
  missingScopes,
  scopesForRole,
} from "./scopes";

describe("scopes", () => {
  it("lists the documented scopes", () => {
    expect([...SCOPES]).toEqual([
      "read",
      "write",
      "docs:write",
      "costs:write",
      "ha:action",
      "admin",
    ]);
  });

  it("gives admins every scope and members all but admin", () => {
    expect(scopesForRole("admin")).toEqual([...SCOPES]);
    expect(scopesForRole("member")).toEqual(
      SCOPES.filter((s) => s !== "admin"),
    );
  });

  it("caps token scopes by the owner's role", () => {
    expect(effectiveScopes("member", ["read", "admin"])).toEqual(["read"]);
    expect(effectiveScopes("admin", ["read", "admin"])).toEqual([
      "read",
      "admin",
    ]);
    expect(effectiveScopes("admin")).toEqual([...SCOPES]);
  });

  it("reports missing scopes", () => {
    expect(missingScopes(["read"], ["read", "write"])).toEqual(["write"]);
    expect(missingScopes(["read"], [])).toEqual([]);
  });

  it("recognises scope strings", () => {
    expect(isScope("docs:write")).toBe(true);
    expect(isScope("root")).toBe(false);
  });
});
