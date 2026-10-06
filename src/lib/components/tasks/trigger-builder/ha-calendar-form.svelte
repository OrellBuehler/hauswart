<script lang="ts">
  import EntityPicker from "$lib/components/connections/entity-picker.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import AdvancedNote from "./advanced-note.svelte";
  import type { HaCalendarDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: HaCalendarDraft; errors: Record<string, string> } = $props();

  let match = $state(trigger.summaryMatch ?? "");

  $effect(() => {
    trigger.summaryMatch = match.trim() === "" ? undefined : match;
  });
</script>

<div class="flex flex-col gap-4">
  <AdvancedNote />
  <Field
    id="trigger-entity"
    label={m.trigger_form_calendar_entity()}
    hint={m.trigger_form_calendar_entity_hint()}
    error={errors.entityId}
  >
    {#snippet children({ describedby, invalid })}
      <EntityPicker
        id="trigger-entity"
        source="calendars"
        bind:value={trigger.entityId}
        placeholder="calendar.example_waste"
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>
  <div class="grid gap-4 sm:grid-cols-2">
    <Field
      id="trigger-offset"
      label={m.trigger_form_offset()}
      hint={m.trigger_form_offset_hint()}
      error={errors.offsetDays}
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="trigger-offset"
          bind:value={trigger.offsetDays}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field
      id="trigger-match"
      label={m.trigger_form_summary_match()}
      optional
      error={errors.summaryMatch}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="trigger-match"
          class="h-10"
          autocomplete="off"
          bind:value={match}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>
  </div>
</div>
