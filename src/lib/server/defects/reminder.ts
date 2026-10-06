import { and, eq } from "drizzle-orm";
import type { TaskPriority } from "$lib/api/enums";
import {
  ACTIVE_DEFECT_STATUSES,
  REMINDER_LEAD_DAYS,
} from "$lib/api/schemas/defects";
import { m } from "$lib/paraglide/messages";
import { tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { createPreparation } from "$lib/server/tasks/preparations";
import { createTask, updateTask } from "$lib/server/tasks/tasks";
import type { DefectRow } from "./defects";

export const DEFECT_EXTERNAL_SOURCE = "defect";

const PRIORITY: Record<DefectRow["severity"], TaskPriority> = {
  low: "low",
  medium: "normal",
  high: "high",
};

/** The system task is stored text, so it is written in the base language of the app. */
const BASE = { locale: "de" } as const;

type ReminderInput = Pick<
  DefectRow,
  | "id"
  | "number"
  | "title"
  | "status"
  | "severity"
  | "roomId"
  | "assetId"
  | "deadlineDate"
>;

/**
 * Keeps one reminder task per defect in step with it: a one-off task on the
 * deadline (with a "report the defect" preparation) while the defect needs
 * attention and has a deadline; archived once it is fixed or rejected or has
 * no deadline; brought back when the defect is reopened.
 */
export async function syncReminder(
  ctx: ServiceContext,
  defect: ReminderInput,
): Promise<void> {
  const existing = ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.externalSource, DEFECT_EXTERNAL_SOURCE),
        eq(tasks.externalRef, defect.id),
      ),
    )
    .get();
  const wanted =
    defect.deadlineDate !== null &&
    (ACTIVE_DEFECT_STATUSES as readonly string[]).includes(defect.status);

  if (!wanted) {
    if (existing && !existing.archivedAt) {
      await updateTask(ctx, existing.id, { archived: true });
    }
    return;
  }

  const fields = {
    title: m.defect_reminder_title(
      { number: defect.number, title: defect.title },
      BASE,
    ),
    priority: PRIORITY[defect.severity],
    assetId: defect.assetId,
    roomId: defect.roomId,
    trigger: {
      v: 1 as const,
      type: "one_off" as const,
      date: defect.deadlineDate as string,
    },
    externalUrl: `/defects/${defect.id}`,
  };
  if (existing) {
    await updateTask(ctx, existing.id, { ...fields, archived: false });
    return;
  }
  const task = await createTask(
    ctx,
    {
      ...fields,
      descriptionMd: "",
      category: "defect",
      assignMode: "none",
      rotationOrder: [],
      rotationStrategy: "alternate",
      notifyMode: "all",
      graceDays: 0,
      source: "system",
      externalSource: DEFECT_EXTERNAL_SOURCE,
      externalRef: defect.id,
    },
    null,
  );
  await createPreparation(ctx, task.id, {
    title: m.defect_reminder_prep({}, BASE),
    kind: "generic",
    leadDays: REMINDER_LEAD_DAYS,
    qty: 1,
  });
}
