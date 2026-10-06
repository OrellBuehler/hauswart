<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import type { ExternalEntity } from "$lib/connections/types";
  import EntityPicker from "$lib/components/connections/entity-picker.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { commonStates } from "$lib/connections/entities";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import type { AutoCompleteDraft, AutoCompleteRuleDraft } from "./types";

  const MAX_RULES = 5;

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: AutoCompleteDraft; errors: Record<string, string> } = $props();

  let seq = 0;
  const nextKey = () => `rule-${++seq}`;
  let keys = $state<string[]>((trigger.autoComplete ?? []).map(nextKey));
  let resolved = $state<Record<string, ExternalEntity | null | undefined>>({});

  const rules = $derived(trigger.autoComplete ?? []);
  const legacyReset = $derived(
    trigger.type === "counter_delta" ? trigger.autoCompleteOnReset : undefined,
  );
  const typeOptions = $derived([
    { value: "counter_reset", label: m.auto_complete_type_counter_reset() },
    { value: "state_change", label: m.auto_complete_type_state_change() },
  ]);

  function add(type: AutoCompleteRuleDraft["type"]) {
    if (rules.length >= MAX_RULES) return;
    const rule: AutoCompleteRuleDraft =
      type === "counter_reset"
        ? { type, entityId: "" }
        : { type, entityId: "", to: "" };
    trigger.autoComplete = [...rules, rule];
    keys = [...keys, nextKey()];
  }

  function remove(index: number) {
    trigger.autoComplete = rules.filter((_, i) => i !== index);
    keys = keys.filter((_, i) => i !== index);
    if (trigger.autoComplete.length === 0) trigger.autoComplete = undefined;
  }

  function retype(index: number, type: string) {
    const current = rules[index];
    if (!current || current.type === type) return;
    const next: AutoCompleteRuleDraft =
      type === "counter_reset"
        ? { type: "counter_reset", entityId: current.entityId }
        : { type: "state_change", entityId: current.entityId, to: "" };
    trigger.autoComplete = rules.map((rule, i) => (i === index ? next : rule));
  }

  function chipsFor(key: string, entityId: string): string[] {
    const chips = commonStates(entityId.split(".")[0] ?? "");
    const current = resolved[key]?.state;
    if (
      current &&
      !chips.includes(current) &&
      Number.isNaN(Number(current)) &&
      current !== "unavailable" &&
      current !== "unknown"
    ) {
      return [...chips, current];
    }
    return chips;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-dashed p-3 sm:p-4"
  aria-labelledby="auto-complete-title"
>
  <div class="flex items-start gap-3">
    <SparklesIcon
      class="text-muted-foreground mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-col gap-1">
      <h3 id="auto-complete-title" class="text-sm font-medium">
        {m.auto_complete_title()}
        <span class="text-muted-foreground font-normal"
          >({m.common_optional()})</span
        >
      </h3>
      <p class="text-muted-foreground text-xs text-pretty">
        {m.auto_complete_description()}
      </p>
    </div>
  </div>

  {#if legacyReset}
    <div
      class="bg-muted/50 flex items-start justify-between gap-3 rounded-md px-3 py-2"
    >
      <p class="text-sm text-pretty">
        {m.auto_complete_legacy({ minDrop: legacyReset.minDrop })}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="-my-1 size-9 shrink-0"
        aria-label={m.auto_complete_remove()}
        onclick={() => {
          if (trigger.type === "counter_delta")
            trigger.autoCompleteOnReset = undefined;
        }}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </div>
  {/if}

  {#if rules.length === 0 && !legacyReset}
    <p class="text-muted-foreground text-xs text-pretty">
      {m.auto_complete_example()}
    </p>
  {/if}

  {#if rules.length > 0}
    <ul class="flex flex-col gap-3">
      {#each rules as rule, index (keys[index] ?? index)}
        {@const key = keys[index] ?? String(index)}
        <li class="bg-card flex flex-col gap-4 rounded-lg border p-3 sm:p-4">
          <div class="flex items-end gap-2">
            <Field
              id={`auto-type-${key}`}
              label={m.auto_complete_rule_label({ n: index + 1 })}
              class="flex-1"
            >
              {#snippet children({ describedby })}
                <OptionSelect
                  id={`auto-type-${key}`}
                  value={rule.type}
                  options={typeOptions}
                  {describedby}
                  onchange={(value) => retype(index, value)}
                />
              {/snippet}
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-10 shrink-0"
              aria-label={m.auto_complete_remove_rule({ n: index + 1 })}
              onclick={() => remove(index)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>

          <p class="text-muted-foreground -mt-2 text-xs text-pretty">
            {rule.type === "counter_reset"
              ? m.auto_complete_counter_reset_hint()
              : m.auto_complete_state_change_hint()}
          </p>

          <Field
            id={`auto-entity-${key}`}
            label={rule.type === "counter_reset"
              ? m.auto_complete_counter_entity()
              : m.auto_complete_state_entity()}
            error={errors[`autoComplete.${index}.entityId`]}
          >
            {#snippet children({ describedby, invalid })}
              <EntityPicker
                id={`auto-entity-${key}`}
                bind:value={rule.entityId}
                placeholder={rule.type === "counter_reset"
                  ? "sensor.example_filter_counter"
                  : "binary_sensor.example_filter_due"}
                {invalid}
                {describedby}
                onresolve={(entity) => (resolved[key] = entity)}
              />
            {/snippet}
          </Field>

          {#if rule.type === "counter_reset"}
            <Field
              id={`auto-drop-${key}`}
              label={m.auto_complete_min_drop()}
              hint={m.auto_complete_min_drop_hint()}
              error={errors[`autoComplete.${index}.minDrop`]}
              class="sm:max-w-xs"
            >
              {#snippet children({ describedby, invalid })}
                <NumberField
                  id={`auto-drop-${key}`}
                  decimal
                  bind:value={rule.minDrop}
                  {invalid}
                  {describedby}
                />
              {/snippet}
            </Field>
          {:else}
            <div class="grid gap-4 sm:grid-cols-2">
              <Field
                id={`auto-to-${key}`}
                label={m.auto_complete_to()}
                error={errors[`autoComplete.${index}.to`]}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id={`auto-to-${key}`}
                    class="h-10"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    maxlength={255}
                    placeholder="off"
                    bind:value={rule.to}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                  />
                  {#if chipsFor(key, rule.entityId).length > 0}
                    <div
                      class="flex flex-wrap items-center gap-1.5"
                      role="group"
                      aria-label={m.trigger_form_value_suggestions()}
                    >
                      {#each chipsFor(key, rule.entityId) as chip (chip)}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          class="h-8 font-mono text-xs"
                          onclick={() => (rule.to = chip)}
                        >
                          {chip}
                        </Button>
                      {/each}
                    </div>
                  {/if}
                {/snippet}
              </Field>
              <Field
                id={`auto-from-${key}`}
                label={m.auto_complete_from()}
                hint={m.auto_complete_from_hint()}
                optional
                error={errors[`autoComplete.${index}.from`]}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id={`auto-from-${key}`}
                    class="h-10"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    maxlength={255}
                    placeholder="on"
                    value={rule.from ?? ""}
                    oninput={(event) =>
                      (rule.from =
                        event.currentTarget.value.trim() === ""
                          ? undefined
                          : event.currentTarget.value)}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                  />
                {/snippet}
              </Field>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if rules.length < MAX_RULES}
    <div class="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        onclick={() => add("counter_reset")}
      >
        <PlusIcon />{m.auto_complete_add_counter_reset()}
      </Button>
      <Button
        type="button"
        variant="outline"
        onclick={() => add("state_change")}
      >
        <PlusIcon />{m.auto_complete_add_state_change()}
      </Button>
    </div>
  {/if}
</section>
