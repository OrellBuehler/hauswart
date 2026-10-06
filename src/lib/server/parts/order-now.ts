import { and, eq, isNull } from "drizzle-orm";
import { orderNowItems, type OrderTask } from "$lib/tasks/engine";
import { parts, taskParts, taskState, tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { stateToDue, toStateRecord } from "$lib/server/tasks/state";

export interface OrderNowRecord {
  taskId: string;
  taskTitle: string;
  partId: string;
  partName: string;
  quantity: number;
  neededBy: string;
  orderBy: string;
  late: boolean;
  stockCount: number;
  supplier: string | null;
  shopUrl: string | null;
  unitPriceMinor: number | null;
  currency: string;
}

/**
 * Parts to order now. For every active task with linked parts the engine
 * compares the part's stock with what the task needs plus the minimum stock;
 * what is already on order counts as stock. A part is listed once today has
 * reached the order-by date (the task's due date, or its estimate, minus the
 * part's lead time). Sorted by order-by date.
 */
export function listOrderNow(
  ctx: Pick<ServiceContext, "db" | "now">,
): OrderNowRecord[] {
  const { today } = clockAt(ctx.now);
  const rows = ctx.db
    .select({
      task: tasks,
      state: taskState,
      part: parts,
      qty: taskParts.qty,
    })
    .from(taskParts)
    .innerJoin(tasks, eq(tasks.id, taskParts.taskId))
    .innerJoin(taskState, eq(taskState.taskId, tasks.id))
    .innerJoin(parts, eq(parts.id, taskParts.partId))
    .where(and(isNull(tasks.archivedAt), isNull(parts.archivedAt)))
    .all();

  const byTask = new Map<string, OrderTask>();
  const titles = new Map<string, string>();
  const partsById = new Map<string, (typeof rows)[number]["part"]>();
  for (const row of rows) {
    titles.set(row.task.id, row.task.title);
    partsById.set(row.part.id, row.part);
    const entry = byTask.get(row.task.id) ?? {
      taskId: row.task.id,
      due: stateToDue(toStateRecord(row.state)),
      parts: [],
    };
    entry.parts.push({
      id: row.part.id,
      stock: row.part.stockCount + row.part.orderedQty,
      minStock: row.part.minStock,
      leadTimeDays: row.part.leadTimeDays,
      qty: row.qty,
    });
    byTask.set(row.task.id, entry);
  }

  return orderNowItems([...byTask.values()], today).map((item) => {
    const part = partsById.get(item.partId)!;
    return {
      taskId: item.taskId,
      taskTitle: titles.get(item.taskId)!,
      partId: item.partId,
      partName: part.name,
      quantity: item.quantity,
      neededBy: item.neededBy,
      orderBy: item.orderBy,
      late: item.late,
      stockCount: part.stockCount,
      supplier: part.supplier,
      shopUrl: part.shopUrl,
      unitPriceMinor: part.unitPriceMinor,
      currency: part.currency,
    };
  });
}
