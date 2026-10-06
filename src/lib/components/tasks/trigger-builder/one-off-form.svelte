<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import type { OneOffDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: OneOffDraft; errors: Record<string, string> } = $props();
</script>

<Field id="trigger-date" label={m.trigger_form_date()} error={errors.date}>
  {#snippet children({ describedby, invalid })}
    <Input
      id="trigger-date"
      type="date"
      class="h-10"
      bind:value={trigger.date}
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
    />
  {/snippet}
</Field>
