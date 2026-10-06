<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CheckIcon from "@lucide/svelte/icons/check";
  import type { DefectStatus } from "$lib/api/enums";
  import { statusLabels, statusTones } from "$lib/defects/labels";
  import { formatDateShort } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    status,
    discoveredOn,
    reportedOn,
    fixedOn,
    today,
  }: {
    status: DefectStatus;
    discoveredOn: string;
    reportedOn: string | null;
    fixedOn: string | null;
    today: string;
  } = $props();

  const steps = $derived<DefectStatus[]>([
    "open",
    "reported",
    "in_progress",
    status === "rejected" ? "rejected" : "fixed",
  ]);
  const current = $derived(steps.indexOf(status));

  function dateOf(step: DefectStatus): { label: string; date: string } | null {
    if (step === "open") {
      return { label: m.defect_step_discovered(), date: discoveredOn };
    }
    if (step === "reported" && reportedOn) {
      return { label: m.defect_step_reported(), date: reportedOn };
    }
    if (step === "fixed" && fixedOn) {
      return { label: m.defect_step_fixed(), date: fixedOn };
    }
    return null;
  }
</script>

<ol class="grid grid-cols-4 gap-1" aria-label={m.defect_status()}>
  {#each steps as step, index (step)}
    {@const state =
      index < current ? "done" : index === current ? "current" : "todo"}
    {@const info = dateOf(step)}
    <li
      class="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
      aria-current={state === "current" ? "step" : undefined}
    >
      {#if index > 0}
        <span
          class={cn(
            "absolute -start-1/2 top-4 h-0.5 w-full -translate-y-1/2",
            index <= current ? "bg-foreground/30" : "bg-border",
          )}
          aria-hidden="true"
        ></span>
      {/if}
      <span
        class={cn(
          "relative flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold",
          state === "current" && statusTones[step].step,
          state === "done" && "border-foreground/30 bg-muted",
          state === "todo" &&
            "bg-background text-muted-foreground border-border",
        )}
      >
        {#if state === "done"}
          <CheckIcon class="size-4" aria-hidden="true" />
        {:else if step === "rejected"}
          <BanIcon class="size-4" aria-hidden="true" />
        {:else}
          {index + 1}
        {/if}
      </span>
      <span
        class={cn(
          "text-xs leading-tight font-medium text-balance break-words",
          state === "todo" && "text-muted-foreground",
        )}
      >
        {statusLabels[step]()}
        <span class="sr-only">
          ({state === "done"
            ? m.defect_step_done()
            : state === "current"
              ? m.defect_step_current()
              : m.defect_step_todo()})
        </span>
      </span>
      {#if info}
        <span
          class="text-muted-foreground text-[11px] leading-tight tabular-nums"
        >
          <span class="sr-only">{info.label}: </span>{formatDateShort(
            info.date,
            { today },
          )}
        </span>
      {/if}
    </li>
  {/each}
</ol>
