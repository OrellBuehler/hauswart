import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import type { Contact } from "../../../src/lib/api/schemas/contacts";
import type { Part } from "../../../src/lib/api/schemas/parts";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";

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
  const found = await byIdFirst(ref, (id) =>
    ctx.api.call(endpoints.contactsGet, { params: { id } }),
  );
  if (found) return found;
  const { items } = await ctx.api.call(endpoints.contactsList, {
    query: { q: ref, limit: 50 },
  });
  return pick(
    "Contact",
    ref,
    items,
    (c) => same(c.name, ref) || same(c.company, ref),
    (c) => c.name,
  );
}

/** A spare part by id, name or part number. */
export async function resolvePart(
  ctx: ToolContext,
  ref: string,
): Promise<Part> {
  const found = await byIdFirst(ref, (id) =>
    ctx.api.call(endpoints.partsGet, { params: { id } }),
  );
  if (found) return found;
  const { items } = await ctx.api.call(endpoints.partsList, {
    query: { q: ref, limit: 50 },
  });
  return pick(
    "Part",
    ref,
    items,
    (p) => same(p.name, ref) || same(p.partNumber, ref),
    (p) => p.name,
  );
}
