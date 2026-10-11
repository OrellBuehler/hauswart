import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import type { Contact } from "../../../src/lib/api/schemas/contacts";
import type { InsurancePolicy } from "../../../src/lib/api/schemas/insurance";
import type { Part } from "../../../src/lib/api/schemas/parts";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { searchText, type SearchText } from "../search-text";

const same = (a: string | null | undefined, b: string) =>
  a?.trim().toLowerCase() === b.trim().toLowerCase();

function pick<T extends { id: string }>(
  kind: string,
  ref: string,
  items: T[],
  exact: (item: T) => boolean,
  label: (item: T) => string,
): T {
  const exactHits = items.filter(exact);
  const hits = exactHits.length > 0 ? exactHits : items;
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new ToolError(
      "invalid_request",
      `${kind} "${ref}" is ambiguous; use the id. Candidates: ${hits.map((h) => `${label(h)} (${h.id})`).join(", ")}`,
    );
  }
  throw new ToolError(
    "not_found",
    `No ${kind.toLowerCase()} matches "${ref}".`,
  );
}

/** The hits of a search whose text had to be cut short, narrowed to those that match the whole reference. */
function narrowed<T>(
  search: SearchText,
  items: T[],
  isExact: (item: T) => boolean,
): T[] {
  return search.cut ? items.filter(isExact) : items;
}

async function byIdFirst<T>(
  ref: string,
  get: (id: string) => Promise<T>,
): Promise<T | undefined> {
  if (ref.length > 64) return undefined;
  try {
    return await get(ref);
  } catch (err) {
    if (!isApiError(err) || err.code !== "not_found") throw err;
    return undefined;
  }
}

/** A contact by id, name or company. */
export async function resolveContact(
  ctx: ToolContext,
  ref: string,
): Promise<Contact> {
  const search = searchText("give the contact's id, name or company", ref);
  const found = await byIdFirst(search.text, (id) =>
    ctx.api.call(endpoints.contactsGet, { params: { id } }),
  );
  if (found) return found;
  const { items } = await ctx.api.call(endpoints.contactsList, {
    query: { q: search.q, limit: 50 },
  });
  const isExact = (c: Contact) =>
    same(c.name, search.text) || same(c.company, search.text);
  return pick(
    "Contact",
    ref,
    narrowed(search, items, isExact),
    isExact,
    (c) => c.name,
  );
}

/** A spare part by id, name or part number. */
export async function resolvePart(
  ctx: ToolContext,
  ref: string,
): Promise<Part> {
  const search = searchText("give the part's id, name or part number", ref);
  const found = await byIdFirst(search.text, (id) =>
    ctx.api.call(endpoints.partsGet, { params: { id } }),
  );
  if (found) return found;
  const { items } = await ctx.api.call(endpoints.partsList, {
    query: { q: search.q, limit: 50 },
  });
  const isExact = (p: Part) =>
    same(p.name, search.text) || same(p.partNumber, search.text);
  return pick(
    "Part",
    ref,
    narrowed(search, items, isExact),
    isExact,
    (p) => p.name,
  );
}

/** An insurance policy by id, title or policy number; archived policies are looked at when no active one matches. */
export async function resolvePolicy(
  ctx: ToolContext,
  ref: string,
): Promise<InsurancePolicy> {
  const search = searchText(
    "give the policy's id, title or policy number",
    ref,
  );
  const found = await byIdFirst(search.text, (id) =>
    ctx.api.call(endpoints.insurancePoliciesGet, { params: { id } }),
  );
  if (found) return found;
  const isExact = (p: InsurancePolicy) =>
    same(p.title, search.text) || same(p.policyNumber, search.text);
  const matches = async (archived: boolean) => {
    const { items } = await ctx.api.call(endpoints.insurancePoliciesList, {
      query: {
        q: search.q,
        archived: archived ? "true" : undefined,
        limit: 50,
      },
    });
    return narrowed(search, items, isExact);
  };
  let items = await matches(false);
  if (items.length === 0) items = await matches(true);
  return pick("Insurance policy", ref, items, isExact, (p) => p.title);
}
