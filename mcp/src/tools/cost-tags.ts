import { endpoints } from "../../../src/lib/api/registry";
import { plural } from "../format";
import { defineTool } from "../tool";

export const listCostTags = defineTool({
  name: "list_cost_tags",
  title: "List cost tags",
  description:
    "The tags cost entries can carry (for example a holiday, a tax return, a gift), by name, each with its colour key and the number of entries that carry it. Use a name or id as the tag of create_cost, list_costs and cost_summary. Tags are created in the app; an unknown name is an error, not a new tag.",
  mode: "read",
  input: {},
  async handler(_args, ctx) {
    const { items } = await ctx.api.call(endpoints.costTagsList);
    return {
      summary: `${plural(items.length, "cost tag")}.`,
      data: {
        tags: items.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          entries: t.entryCount,
        })),
      },
    };
  },
});

export const costTagTools = [listCostTags];
