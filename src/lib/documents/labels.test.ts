import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_OWNER_TYPES,
  DOCUMENT_LINK_OWNER_TYPES,
  DOCUMENT_LINK_ROLES,
} from "$lib/api/enums";
import {
  defaultRoleFor,
  documentOwnerLabels,
  documentRoleLabels,
  isLinkableOwner,
} from "./labels";

describe("document labels", () => {
  it("names every role and every owner type", () => {
    for (const role of DOCUMENT_LINK_ROLES) {
      expect(documentRoleLabels[role]().trim()).not.toBe("");
    }
    for (const owner of DOCUMENT_LINK_OWNER_TYPES) {
      expect(documentOwnerLabels[owner]().trim()).not.toBe("");
    }
  });

  it("suggests a role that exists for every owner type", () => {
    for (const owner of DOCUMENT_LINK_OWNER_TYPES) {
      expect(DOCUMENT_LINK_ROLES).toContain(defaultRoleFor(owner));
    }
    expect(defaultRoleFor("asset")).toBe("manual");
    expect(defaultRoleFor("room")).toBe("other");
  });
});

describe("isLinkableOwner", () => {
  it("accepts the owners a document can be linked to", () => {
    for (const owner of DOCUMENT_LINK_OWNER_TYPES) {
      expect(isLinkableOwner(owner)).toBe(true);
    }
  });

  it("refuses the care hints, which the server refuses too", () => {
    expect(isLinkableOwner("asset_hint")).toBe(false);
    const refused = ATTACHMENT_OWNER_TYPES.filter((o) => !isLinkableOwner(o));
    expect(refused).toEqual(["asset_hint"]);
  });
});
