<script lang="ts">
  import { getLocale } from "$lib/paraglide/runtime";
  import { describeTrigger } from "$lib/tasks/describe";
  import type { Trigger } from "$lib/tasks/engine/types";

  let { trigger, class: className }: { trigger: Trigger; class?: string } =
    $props();
</script>

<span class={className}>{describeTrigger(trigger, getLocale())}</span>
