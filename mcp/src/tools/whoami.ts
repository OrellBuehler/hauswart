import { endpoints } from "../../../src/lib/api/registry";
import { defineTool } from "../tool";

export const whoami = defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "The user this token acts as, the token's scopes, and the household (name, time zone, currency, today's date). Call it first when you need today's date in the household's time zone or to know whether writes are allowed.",
  mode: "read",
  input: {},
  async handler(_args, ctx) {
    const [me, household] = await Promise.all([
      ctx.api.call(endpoints.authMe),
      ctx.api.call(endpoints.householdGet),
    ]);
    const name = me.user.displayName ?? me.user.username;
    return {
      summary: `${name} (${me.user.role}), ${household.name}, today is ${ctx.today()}. ${me.scopes.includes("write") ? "Can read and write." : "Read-only."}`,
      data: {
        user: {
          id: me.user.id,
          username: me.user.username,
          displayName: me.user.displayName,
          role: me.user.role,
        },
        scopes: me.scopes,
        household: {
          name: household.name,
          timezone: household.timezone,
          currency: household.currency,
          handoverDate: household.handoverDate,
          dueSoonDays: household.settings.dueSoonDays,
        },
        today: ctx.today(),
      },
    };
  },
});
