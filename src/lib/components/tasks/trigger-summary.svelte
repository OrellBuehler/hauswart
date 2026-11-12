<script lang="ts">
  import { getLocale } from "#lib/paraglide/runtime.js";
  import { describeTrigger } from "#lib/tasks/describe.ts";
  import type { Trigger } from "#lib/tasks/engine/types.ts";

  let { trigger, class: className }: { trigger: Trigger; class?: string } =
    $props();
</script>

<span class={className}>{describeTrigger(trigger, getLocale())}</span>
