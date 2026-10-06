<script lang="ts">
  import { statusLabels } from "$lib/tasks/labels";
  import type { DueStatus } from "$lib/tasks/engine/types";
  import { cn } from "$lib/utils";
  import { statusTones } from "./tones";

  let {
    status,
    labelled = false,
    class: className,
  }: {
    status: DueStatus;
    /** Announce the status to screen readers; leave off when the status is written out next to it. */
    labelled?: boolean;
    class?: string;
  } = $props();
</script>

<span
  class={cn(
    "inline-block size-2.5 shrink-0 rounded-full",
    statusTones[status].dot,
    className,
  )}
  role={labelled ? "img" : undefined}
  aria-label={labelled ? statusLabels[status]() : undefined}
  aria-hidden={labelled ? undefined : "true"}
></span>
