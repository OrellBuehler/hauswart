<script lang="ts">
  import type { AppointmentStatus } from "$lib/api/enums";
  import { statusLabels, statusTones } from "$lib/appointments/labels";
  import { cn } from "$lib/utils";

  let {
    status,
    class: className,
  }: { status: AppointmentStatus; class?: string } = $props();
</script>

<span
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    statusTones[status].pill,
    className,
  )}
>
  <span
    class={cn("inline-block size-2 rounded-full", statusTones[status].dot)}
    aria-hidden="true"
  ></span>
  {statusLabels[status]()}
</span>
