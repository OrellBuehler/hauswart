import { endpoints } from "../../../src/lib/api/registry";
import { plural } from "../format";
import { defineTool } from "../tool";

export const listCalendarTargets = defineTool({
  name: "list_calendar_targets",
  title: "List calendar targets",
  description:
    "The calendars hauswart pushes appointments, due dates and deadlines into (the household's and the token user's own): which calendar, what goes in, whether the last sync worked (status and error code), when, and how many events hauswart keeps there. Read-only; adding, changing and syncing them is done in the web app.",
  mode: "read",
  input: {},
  async handler(_args, ctx) {
    const { items } = await ctx.api.call(endpoints.calendarTargetsList);
    return {
      summary: plural(items.length, "calendar target") + ".",
      data: {
        targets: items.map((t) => ({
          id: t.id,
          name: t.name,
          provider: t.provider,
          level: t.level,
          calendar: t.remoteCalendarId,
          calendarName: t.remoteName,
          enabled: t.enabled,
          kinds: t.config.kinds,
          status: t.status,
          lastError: t.lastError,
          lastOkAt: t.lastOkAt,
          events: t.eventCount,
          canCreate: t.capabilities?.create ?? null,
          canUpdate: t.capabilities?.update ?? null,
          canDelete: t.capabilities?.delete ?? null,
        })),
      },
    };
  },
});
