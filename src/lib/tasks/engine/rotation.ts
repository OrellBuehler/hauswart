import type { Completion } from "./types";

export type RotationConfig = {
  mode: "none" | "fixed" | "rotate";
  assigneeUserId?: string | null;
  rotationOrder: string[];
  strategy: "alternate" | "fair";
};

type RotationCompletion = Pick<Completion, "userId" | "kind" | "completedAt">;

function lastCompleterIndex(
  order: string[],
  completions: RotationCompletion[],
): number {
  let best: RotationCompletion | undefined;
  for (const c of completions) {
    if (c.kind !== "done" || !c.userId || !order.includes(c.userId)) continue;
    if (!best || c.completedAt > best.completedAt) best = c;
  }
  return best ? order.indexOf(best.userId as string) : -1;
}

export function nextAssignee(
  config: RotationConfig,
  completions: RotationCompletion[],
  effortByUser90d: Record<string, number> = {},
): string | null {
  if (config.mode === "none") return null;
  if (config.mode === "fixed") return config.assigneeUserId ?? null;

  const order = [...new Set(config.rotationOrder)];
  if (order.length === 0) return null;

  let candidates = order;
  if (config.strategy === "fair") {
    const effort = (id: string) => effortByUser90d[id] ?? 0;
    const lowest = Math.min(...order.map(effort));
    candidates = order.filter((id) => effort(id) === lowest);
  }

  const last = lastCompleterIndex(order, completions);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(last + step + order.length) % order.length];
    if (candidates.includes(candidate)) return candidate;
  }
  return order[0];
}
