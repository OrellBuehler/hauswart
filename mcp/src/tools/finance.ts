import { z } from "zod";
import {
  ASSET_KINDS,
  COST_CATEGORIES,
  COST_DEDUCTIBLE,
  FINANCE_SUGGESTION_KINDS,
  FINANCE_SUGGESTION_STATUSES,
} from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { FinanceSuggestion } from "../../../src/lib/api/schemas/finance";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { money } from "./costs";

const suggestionId = z
  .string()
  .min(1)
  .max(64)
  .describe("Suggestion id, from list_finance_suggestions");

const titleOf = (s: FinanceSuggestion) =>
  s.kind === "asset" ? s.payload.name : s.payload.title;

/** One suggestion as the model reads it: amounts as decimals, the finance app's address only for its owner (the API never sends anybody else's). */
const suggestionRow = (s: FinanceSuggestion) => {
  const base = {
    id: s.id,
    kind: s.kind,
    status: s.status === "pending" ? null : s.status,
    acceptedEntityId: s.acceptedEntityId,
  };
  switch (s.kind) {
    case "cost":
      return {
        ...base,
        title: s.payload.title,
        date: s.payload.date,
        amount: money(s.payload.amountMinor, s.payload.currency),
        category: s.payload.category,
        payee: s.payload.payee,
        origin: s.payload.source,
        assetId: s.payload.assetId,
        url: s.payload.url,
      };
    case "asset":
      return {
        ...base,
        name: s.payload.name,
        purchaseDate: s.payload.purchaseDate,
        price: money(s.payload.priceMinor, s.payload.currency),
        url: s.payload.url,
      };
    case "bill_task":
      return {
        ...base,
        title: s.payload.title,
        dueDate: s.payload.dueDate,
        amount:
          s.payload.amountMinor === null
            ? null
            : money(s.payload.amountMinor, s.payload.currency),
        url: s.payload.url,
      };
  }
};

export const listFinanceSuggestions = defineTool({
  name: "list_finance_suggestions",
  title: "List finance suggestions",
  description:
    "The token user's own inbox from the connected finance app (private: nobody else's suggestions are ever listed). Three kinds: 'cost' (an expense or refund that could be booked as a cost entry), 'asset' (a purchase that could become a device) and 'bill_task' (a bill that could become a payment task). Default: the ones waiting for a decision (status pending), newest first. Decide with accept_finance_suggestion or dismiss_finance_suggestion; sync_finance fetches new ones.",
  mode: "read",
  input: {
    kind: z.enum(FINANCE_SUGGESTION_KINDS).optional(),
    status: z.enum(FINANCE_SUGGESTION_STATUSES).default("pending"),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.financeSuggestionsList, {
      query: args,
    });
    const kinds = FINANCE_SUGGESTION_KINDS.map((kind) => ({
      kind,
      count: page.items.filter((s) => s.kind === kind).length,
    }))
      .filter((k) => k.count > 0)
      .map((k) => `${k.count} ${k.kind}`);
    return {
      summary: `${plural(page.items.length, "suggestion")} (${args.status})${
        kinds.length ? `: ${kinds.join(", ")}` : ""
      }.${moreHint(page.nextCursor)}`,
      data: {
        suggestions: page.items.map(suggestionRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

const ENTITY_NOUN = {
  cost: "cost entry",
  asset: "device",
  task: "payment task",
} as const;

export const acceptFinanceSuggestion = defineTool({
  name: "accept_finance_suggestion",
  title: "Accept a finance suggestion",
  description:
    "Turns one of the token user's pending suggestions into what it offers: a cost entry (paid by the token's user, split by ownership), a device, or a payment task for a bill. Without overrides it is taken exactly as the finance app reported it; an accepted cost is never booked twice. Overrides for a 'cost': title, category, notes, asset and room (by name), paidBy, split (ownership, equal or none), deductible, countsAsExpense. For an 'asset': name, assetKind, room. For a 'bill_task': title. An override of another kind is rejected. Deciding twice is a conflict. Look at list_finance_suggestions first.",
  mode: "create",
  scopes: ["costs:write"],
  input: {
    id: suggestionId,
    title: z.string().trim().min(1).max(200).optional(),
    category: z.enum(COST_CATEGORIES).optional(),
    notes: z.string().max(4000).optional(),
    asset: z.string().min(1).max(120).optional(),
    room: z.string().min(1).max(100).optional(),
    paidBy: z.string().min(1).max(100).optional(),
    split: z.enum(["ownership", "equal", "none"]).optional(),
    deductible: z.enum(COST_DEDUCTIBLE).optional(),
    countsAsExpense: z.boolean().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    assetKind: z.enum(ASSET_KINDS).optional(),
  },
  async handler({ id, asset, room, paidBy, split, ...rest }, ctx) {
    const [a, r, p] = await Promise.all([
      asset ? ctx.resolveAsset(asset) : undefined,
      room ? ctx.resolveRoom(room) : undefined,
      paidBy ? ctx.resolveUser(paidBy) : undefined,
    ]);
    const { suggestion, entity } = await ctx.api.call(
      endpoints.financeSuggestionsAccept,
      {
        params: { id },
        body: {
          ...rest,
          assetId: a?.id,
          roomId: r?.id,
          paidByUserId: p,
          splitMode: split,
        },
      },
    );
    return {
      summary: `Accepted "${titleOf(suggestion)}": created ${ENTITY_NOUN[entity.type]} ${entity.id}.`,
      data: { entity, suggestion: suggestionRow(suggestion) },
    };
  },
});

export const dismissFinanceSuggestion = defineTool({
  name: "dismiss_finance_suggestion",
  title: "Dismiss a finance suggestion",
  description:
    "Rejects one of the token user's pending suggestions for good: it is never offered again, even when the finance app changes the item, and this cannot be undone. Dismissing one that is dismissed already changes nothing; an accepted one is a conflict.",
  mode: "undo",
  scopes: ["costs:write"],
  input: { id: suggestionId },
  async handler({ id }, ctx) {
    const suggestion = await ctx.api.call(endpoints.financeSuggestionsDismiss, {
      params: { id },
    });
    return {
      summary: `Dismissed "${titleOf(suggestion)}".`,
      data: suggestionRow(suggestion),
    };
  },
});

/** What a sync counts, by the names the API reports; zeros are left out of the summary. */
const STAT_TEXT: Record<string, (n: number) => string> = {
  suggestions: (n) => plural(n, "new suggestion"),
  assetSuggestions: (n) => plural(n, "new device suggestion"),
  autoAccepted: (n) => `${n} booked automatically`,
  tasksCreated: (n) => plural(n, "payment task") + " created",
  tasksUpdated: (n) => plural(n, "payment task") + " updated",
  tasksCompleted: (n) => plural(n, "payment task") + " completed",
  tasksReopened: (n) => plural(n, "payment task") + " reopened",
  tasksArchived: (n) => plural(n, "payment task") + " archived",
  linksWritten: (n) => plural(n, "link") + " written back",
  linksRemoved: (n) => plural(n, "link") + " removed",
  linksFailed: (n) => plural(n, "link") + " failed",
};

export const syncFinance = defineTool({
  name: "sync_finance",
  title: "Sync the finance app",
  description:
    "Runs one sync of the token user's own finance connection now (it also runs on its own every half hour): new transactions and paid invoices become suggestions, open bills become payment tasks, booked costs are linked back. Returns what changed. A finance app that cannot be reached is a normal answer (ok false with an error code), not a tool error; no connection of one's own is not_found. Afterwards use list_finance_suggestions.",
  mode: "update",
  scopes: ["costs:write"],
  input: {},
  async handler(_args, ctx) {
    const result = await ctx.api.call(endpoints.financeSync);
    const changes = Object.entries(result.stats)
      .filter(([name, n]) => n > 0 && STAT_TEXT[name])
      .map(([name, n]) => STAT_TEXT[name](n));
    const summary = result.ok
      ? `Finance sync done: ${changes.length ? changes.join(", ") : "nothing new"}.`
      : `Finance sync did not finish (${result.error?.code ?? "unknown"}): ${result.error?.message ?? "no details"}${
          changes.length ? ` Before it stopped: ${changes.join(", ")}.` : ""
        }`;
    return {
      summary,
      data: { ok: result.ok, error: result.error, stats: result.stats },
    };
  },
});

export const financeTools = [
  listFinanceSuggestions,
  acceptFinanceSuggestion,
  dismissFinanceSuggestion,
  syncFinance,
];
