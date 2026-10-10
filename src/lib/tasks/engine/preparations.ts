import { addDays } from "$lib/dates";
import { shownDate } from "./shown";
import { evalPredicate } from "./state-condition";
import type { ConditionOp, DueResult, Signals } from "./types";

export type PrepConfig = {
  leadDays?: number;
  leadValue?: { entityId: string; op: ConditionOp; value: string | number };
  kind: "generic" | "order_part";
  partStock?: number;
  qty?: number;
};

export type PrepState = "not_yet" | "now" | "done" | "in_stock_skip";

export function prepState(input: {
  due: DueResult;
  prep: PrepConfig;
  prepCompletions: string[];
  signals: Signals;
  today: string;
}): PrepState {
  const { due, prep, prepCompletions, signals, today } = input;
  if (prepCompletions.includes(due.occurrenceKey)) return "done";
  if (
    prep.kind === "order_part" &&
    prep.partStock !== undefined &&
    prep.partStock >= (prep.qty ?? 1)
  ) {
    return "in_stock_skip";
  }

  const effective = shownDate(due);
  if (prep.leadValue) {
    const signal = signals[prep.leadValue.entityId];
    if (
      signal &&
      evalPredicate(signal, prep.leadValue.op, prep.leadValue.value) === true
    ) {
      return "now";
    }
  }
  const lead = prep.leadDays ?? (prep.leadValue ? undefined : 0);
  if (effective !== null && lead !== undefined) {
    return today >= addDays(effective, -lead) ? "now" : "not_yet";
  }
  return "not_yet";
}

export type OrderPart = {
  id: string;
  stock: number;
  minStock: number;
  leadTimeDays: number;
  qty?: number;
};

export type OrderTask = {
  taskId: string;
  due: DueResult;
  parts: OrderPart[];
};

export type OrderNowItem = {
  taskId: string;
  partId: string;
  quantity: number;
  neededBy: string;
  orderBy: string;
  late: boolean;
};

export function orderNowItems(
  tasks: OrderTask[],
  today: string,
): OrderNowItem[] {
  const items: OrderNowItem[] = [];
  for (const task of tasks) {
    const neededBy = shownDate(task.due);
    if (neededBy === null) continue;
    for (const part of task.parts) {
      const quantity = (part.qty ?? 1) + part.minStock - part.stock;
      if (quantity <= 0) continue;
      const orderBy = addDays(neededBy, -part.leadTimeDays);
      if (today < orderBy) continue;
      items.push({
        taskId: task.taskId,
        partId: part.id,
        quantity,
        neededBy,
        orderBy,
        late: today > orderBy,
      });
    }
  }
  return items.sort(
    (a, b) =>
      a.orderBy.localeCompare(b.orderBy) ||
      a.taskId.localeCompare(b.taskId) ||
      a.partId.localeCompare(b.partId),
  );
}
