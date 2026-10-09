import { defaultOwner, personalAllowed } from "../lib/owner";
import type { Organization } from "../lib/rpc";

import {
  canAddItems,
  canEditAllItems,
  checkOwner,
  toStoredOrganization,
  type StoredOrganization,
} from "./orgs";

jest.mock("./vault", () => ({ vault: {}, repositories: {} }));
jest.mock("./ciphers", () => ({}));
jest.mock("./edit", () => ({}));

const member: StoredOrganization = {
  id: "org-1",
  name: "Acme",
  status: 2,
  type: 2,
  enabled: true,
  usePolicies: true,
  editAnyCollection: false,
  allowAdminAccessToAllCollectionItems: true,
};

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Acme",
    ownsItems: false,
    collections: [
      { id: "mine", name: "My Items", canAddItems: true, isDefault: true },
      { id: "team", name: "Team", canAddItems: true, isDefault: false },
      { id: "ro", name: "Read only", canAddItems: false, isDefault: false },
    ],
    ...overrides,
  };
}

describe("toStoredOrganization", () => {
  it("reads PascalCase and nested permissions", () => {
    expect(
      toStoredOrganization({
        Id: "o",
        Name: "Acme",
        Status: 2,
        Type: 4,
        Enabled: true,
        UsePolicies: true,
        Permissions: { editAnyCollection: true },
        AllowAdminAccessToAllCollectionItems: false,
      }),
    ).toEqual({
      id: "o",
      name: "Acme",
      status: 2,
      type: 4,
      enabled: true,
      usePolicies: true,
      editAnyCollection: true,
      allowAdminAccessToAllCollectionItems: false,
    });
  });
});

describe("collection permissions (reference rules)", () => {
  it("lets admins edit everything only when the org allows it", () => {
    expect(canEditAllItems({ ...member, type: 1 })).toBe(true);
    expect(
      canEditAllItems({ ...member, type: 0, allowAdminAccessToAllCollectionItems: false }),
    ).toBe(false);
    expect(canEditAllItems({ ...member, type: 4, editAnyCollection: true })).toBe(true);
    expect(canEditAllItems(member)).toBe(false);
  });

  it("adds to managed or editable collections, not read-only ones", () => {
    expect(canAddItems(member, { manage: false, readOnly: false })).toBe(true);
    expect(canAddItems(member, { manage: true, readOnly: true })).toBe(true);
    expect(canAddItems(member, { manage: false, readOnly: true })).toBe(false);
    expect(canAddItems({ ...member, type: 1 }, { manage: false, readOnly: true })).toBe(true);
  });
});

describe("checkOwner", () => {
  it("allows the personal vault unless an org owns members' items", () => {
    expect(() => checkOwner({ collectionIds: [] }, [org()])).not.toThrow();
    expect(() => checkOwner({ collectionIds: [] }, [org({ ownsItems: true })])).toThrow(/policy/);
  });

  it("requires at least one collection the user can add to", () => {
    expect(() => checkOwner({ organizationId: "org-1", collectionIds: [] }, [org()])).toThrow();
    expect(() =>
      checkOwner({ organizationId: "org-1", collectionIds: ["team"] }, [org()]),
    ).not.toThrow();
    expect(() => checkOwner({ organizationId: "org-1", collectionIds: ["ro"] }, [org()])).toThrow();
  });

  it("lets an item stay in a read-only collection it's already in", () => {
    expect(() =>
      checkOwner({ organizationId: "org-1", collectionIds: ["ro", "team"] }, [org()], ["ro"]),
    ).not.toThrow();
  });

  it("rejects collections from another org, even ones the item was in", () => {
    expect(() =>
      checkOwner({ organizationId: "org-1", collectionIds: ["elsewhere"] }, [org()], ["elsewhere"]),
    ).toThrow();
    expect(() => checkOwner({ organizationId: "nope", collectionIds: ["team"] }, [org()])).toThrow(
      /not found/,
    );
  });
});

describe("defaultOwner", () => {
  it("is the personal vault without a data-ownership policy", () => {
    expect(defaultOwner([org()])).toEqual({ collectionIds: [] });
    expect(personalAllowed([org()])).toBe(true);
  });

  it("is the owning org's default collection with one", () => {
    expect(defaultOwner([org({ id: "a" }), org({ id: "b", ownsItems: true })])).toEqual({
      organizationId: "b",
      collectionIds: ["mine"],
    });
    expect(personalAllowed([org({ ownsItems: true })])).toBe(false);
  });
});
