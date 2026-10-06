<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import type { WarrantyDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: WarrantyDraft; errors: Record<string, string> } = $props();

  let extended = $state(trigger.extendedUntil ?? "");

  $effect(() => {
    trigger.extendedUntil = extended === "" ? undefined : extended;
  });
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <Field
    id="trigger-until"
    label={m.trigger_form_warranty_until()}
    error={errors.until}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="trigger-until"
        type="date"
        class="h-10"
        bind:value={trigger.until}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
  <Field
    id="trigger-extended"
    label={m.trigger_form_warranty_extended()}
    optional
    error={errors.extendedUntil}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="trigger-extended"
        type="date"
        class="h-10"
        bind:value={extended}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
  <Field
    id="trigger-lead"
    label={m.trigger_form_warranty_lead()}
    hint={m.trigger_form_warranty_lead_hint()}
    optional
    error={errors.leadDays}
  >
    {#snippet children({ describedby, invalid })}
      <NumberField
        id="trigger-lead"
        bind:value={trigger.leadDays}
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>
</div>
