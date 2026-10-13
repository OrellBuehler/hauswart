<script lang="ts">
  import type { CostRecurrence } from "$lib/api/schemas/cost-recurrences";
  import * as Card from "$lib/components/ui/card/index.js";
  import type { RecurrenceRule } from "$lib/costs/recurrence";
  import { upcomingView } from "$lib/costs/recurrences";
  import { formatDateShort } from "$lib/format";
  import { m } from "$lib/paraglide/messages";

  let {
    recurrence,
    rule,
    today,
  }: {
    recurrence: Pick<CostRecurrence, "active" | "nextDate">;
    rule: RecurrenceRule;
    today: string;
  } = $props();

  const view = $derived(upcomingView(recurrence, rule, today));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-base">{m.recurrence_upcoming()}</Card.Title>
  </Card.Header>
  <Card.Content>
    {#if view.kind === "dates"}
      <ol class="flex flex-col gap-1.5 text-sm tabular-nums">
        {#each view.dates as date (date)}
          <li>{formatDateShort(date, { today })}</li>
        {/each}
      </ol>
    {:else}
      <p class="text-muted-foreground text-sm text-pretty">
        {view.kind === "paused"
          ? m.recurrence_upcoming_paused()
          : m.recurrence_upcoming_none()}
      </p>
    {/if}
    <p class="text-muted-foreground mt-4 text-xs text-pretty">
      {m.recurrence_entries_note()}
    </p>
  </Card.Content>
</Card.Root>
