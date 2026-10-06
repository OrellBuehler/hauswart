import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import {
  signalReactionSchema,
  type SignalReaction,
} from "$lib/api/schemas/hints";
import type { UserLocale } from "$lib/api/enums";
import {
  assetHints,
  assets,
  pendingReactions,
  signals,
  taskState,
  users,
} from "$lib/server/db";
import { createNotification } from "$lib/server/notifications/notifications";
import { deliverToChannels } from "$lib/server/notifications/deliveries";
import type { DeliverableNotification } from "$lib/server/notifications/channels";
import type { ServiceContext } from "$lib/server/service";
import type { SignalChange } from "./service";

const same = (a: string | null, b: string): boolean =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

interface ReactiveHint {
  id: string;
  assetId: string;
  assetName: string;
  title: string;
  taskId: string | null;
  reaction: SignalReaction;
}

function reactiveHints(
  ctx: Pick<ServiceContext, "db">,
  entityIds?: readonly string[],
): ReactiveHint[] {
  const out: ReactiveHint[] = [];
  for (const row of ctx.db
    .select({
      id: assetHints.id,
      assetId: assetHints.assetId,
      assetName: assets.name,
      title: assetHints.title,
      taskId: assetHints.taskId,
      reaction: assetHints.reaction,
    })
    .from(assetHints)
    .innerJoin(assets, eq(assets.id, assetHints.assetId))
    .where(and(isNotNull(assetHints.reaction), isNull(assets.archivedAt)))
    .all()) {
    const parsed = signalReactionSchema.safeParse(row.reaction);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "signals.reaction_invalid",
          hintId: row.id,
          name: "ZodError",
        }),
      );
      continue;
    }
    if (entityIds && !entityIds.includes(parsed.data.entityId)) continue;
    out.push({ ...row, reaction: parsed.data });
  }
  return out;
}

/**
 * Turns signal transitions into pending reactions: a hint whose reaction
 * names the signal, whose `toState` the signal just reached (from `fromState`
 * when given). The reaction fires after `delayMinutes` (default 0), once per
 * hint and transition. When the signal leaves `toState` before that, the
 * pending reaction is cancelled (the door was closed again). The first sight
 * of a signal is not a transition. Returns how many reactions were scheduled.
 */
export function scheduleReactions(
  ctx: Pick<ServiceContext, "db" | "now">,
  changes: readonly SignalChange[],
): number {
  const moved = changes.filter((c) => c.prev !== null);
  if (moved.length === 0) return 0;
  let scheduled = 0;
  for (const hint of reactiveHints(
    ctx,
    moved.map((c) => c.key),
  )) {
    const { reaction } = hint;
    for (const change of moved) {
      if (change.key !== reaction.entityId) continue;
      const prev = change.prev!;
      const arrived =
        same(change.next.text, reaction.toState) &&
        !same(prev.text, reaction.toState) &&
        (reaction.fromState === undefined ||
          same(prev.text, reaction.fromState));
      if (arrived) {
        const inserted = ctx.db
          .insert(pendingReactions)
          .values({
            hintId: hint.id,
            entityId: reaction.entityId,
            transitionKey: `${reaction.entityId}:${change.next.changedAt}`,
            fireAt: new Date(ctx.now + (reaction.delayMinutes ?? 0) * 60_000),
          })
          .onConflictDoNothing()
          .returning({ id: pendingReactions.id })
          .get();
        if (inserted) scheduled += 1;
      } else if (!same(change.next.text, reaction.toState)) {
        ctx.db
          .update(pendingReactions)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(pendingReactions.hintId, hint.id),
              eq(pendingReactions.entityId, reaction.entityId),
              eq(pendingReactions.status, "pending"),
            ),
          )
          .run();
      }
    }
  }
  return scheduled;
}

function recipientsOf(
  ctx: Pick<ServiceContext, "db">,
  hint: ReactiveHint,
): { id: string; locale: UserLocale }[] {
  const everyone = ctx.db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .all();
  const { notify } = hint.reaction;
  if (Array.isArray(notify)) {
    const wanted = new Set(notify);
    return everyone.filter((u) => wanted.has(u.id));
  }
  if (notify === "assignee" && hint.taskId) {
    const assignee = ctx.db
      .select({ id: taskState.currentAssigneeUserId })
      .from(taskState)
      .where(eq(taskState.taskId, hint.taskId))
      .get()?.id;
    const person = everyone.find((u) => u.id === assignee);
    if (person) return [person];
  }
  return everyone;
}

/**
 * Fires the pending reactions that are due: an in-app notification of kind
 * `hint` per recipient (and the outward channels), then the reaction counts as
 * sent. A reaction whose hint is gone, whose asset was archived or whose signal
 * is no longer in `toState` is cancelled instead. Marked sent before the
 * delivery, so a crash loses at most one push and never repeats one.
 */
export async function processDueReactions(
  ctx: ServiceContext,
): Promise<{ sent: number; cancelled: number }> {
  const due = ctx.db
    .select()
    .from(pendingReactions)
    .where(
      and(
        eq(pendingReactions.status, "pending"),
        lte(pendingReactions.fireAt, new Date(ctx.now)),
      ),
    )
    .all();
  if (due.length === 0) return { sent: 0, cancelled: 0 };
  const hints = new Map(reactiveHints(ctx).map((h) => [h.id, h] as const));
  const current = new Map(
    ctx.db
      .select({ key: signals.key, text: signals.text })
      .from(signals)
      .where(inArray(signals.key, [...new Set(due.map((r) => r.entityId))]))
      .all()
      .map((s) => [s.key, s.text] as const),
  );
  let sent = 0;
  let cancelled = 0;
  for (const reaction of due) {
    const hint = hints.get(reaction.hintId);
    const status =
      hint &&
      hint.reaction.entityId === reaction.entityId &&
      same(current.get(reaction.entityId) ?? null, hint.reaction.toState)
        ? "sent"
        : "cancelled";
    ctx.db
      .update(pendingReactions)
      .set({ status })
      .where(
        and(
          eq(pendingReactions.id, reaction.id),
          eq(pendingReactions.status, "pending"),
        ),
      )
      .run();
    if (status === "cancelled" || !hint) {
      cancelled += 1;
      continue;
    }
    sent += 1;
    for (const person of recipientsOf(ctx, hint)) {
      const row = createNotification(ctx, {
        userId: person.id,
        kind: "hint",
        taskId: null,
        dedupeKey: `hint:${reaction.id}:${person.id}`,
        titleKey: "notification_hint",
        params: { asset: hint.assetName, title: hint.title },
        url: `/assets/${hint.assetId}`,
      });
      if (!row) continue;
      const deliverable: DeliverableNotification = {
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        taskId: row.taskId,
        titleKey: row.titleKey,
        params: row.paramsJson,
        url: row.url,
        createdAt: row.createdAt,
      };
      await deliverToChannels(ctx, deliverable, [person]);
    }
  }
  return { sent, cancelled };
}
