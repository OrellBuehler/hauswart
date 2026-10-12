import { onEvent, type DomainEvents } from "$lib/server/events";
import { releaseLinks } from "./links";

/** A deleted entry cannot be what a link suggestion pointed at: the transaction comes back as a cost suggestion. */
const onCostEntryDeleted = ({
  ctx,
  costId,
}: DomainEvents["costEntryDeleted"]) => releaseLinks(ctx, costId);

/** Wires the finance inbox to the events of the cost service. Safe to call more than once. */
export function registerFinanceEvents(): void {
  onEvent("costEntryDeleted", onCostEntryDeleted);
}
