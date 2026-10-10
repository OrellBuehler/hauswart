<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { PREPARATION_KINDS } from "$lib/api/enums";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PreparationDraft } from "$lib/tasks/draft";
  import { preparationKindLabels } from "$lib/tasks/labels";
  import Field from "./field.svelte";
  import NumberField from "./number-field.svelte";
  import OptionSelect from "./option-select.svelte";

  let {
    preparations = $bindable(),
    errors,
  }: {
    preparations: PreparationDraft[];
    errors: Record<string, string>;
  } = $props();

  const kindOptions = $derived(
    PREPARATION_KINDS.map((value) => ({
      value,
      label: preparationKindLabels[value](),
    })),
  );

  function add() {
    preparations = [
      ...preparations,
      {
        key: crypto.getRandomValues(new Uint32Array(1))[0].toString(36),
        title: "",
        kind: "generic",
        leadDays: 7,
      },
    ];
  }

  function remove(key: string) {
    preparations = preparations.filter((p) => p.key !== key);
  }
</script>

<div class="@container flex flex-col gap-4">
  {#if preparations.length === 0}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.prep_editor_empty()}
    </p>
  {/if}
  {#each preparations as prep, index (prep.key)}
    <div
      class="bg-muted/40 grid grid-cols-2 items-start gap-3 rounded-lg border p-3 max-sm:border-0 max-sm:p-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <Field
        id={`prep-${prep.key}-title`}
        label={m.prep_editor_title()}
        error={errors[`prep.${prep.key}.title`]}
        class="col-span-2 @lg:col-span-1"
      >
        {#snippet children({ describedby, invalid })}
          <div class="flex items-center gap-1">
            <Input
              id={`prep-${prep.key}-title`}
              class="h-10 min-w-0 flex-1"
              maxlength={200}
              placeholder={m.prep_editor_title_placeholder()}
              bind:value={prep.title}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              class="shrink-0"
              aria-label={m.prep_editor_remove({
                title: prep.title || String(index + 1),
              })}
              onclick={() => remove(prep.key)}
            >
              <Trash2Icon />
            </Button>
          </div>
        {/snippet}
      </Field>
      <Field id={`prep-${prep.key}-kind`} label={m.prep_editor_kind()}>
        {#snippet children({ describedby })}
          <OptionSelect
            id={`prep-${prep.key}-kind`}
            bind:value={prep.kind}
            options={kindOptions}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id={`prep-${prep.key}-lead`}
        label={m.prep_editor_lead()}
        hint={index === 0 ? m.prep_editor_lead_hint() : undefined}
        error={errors[`prep.${prep.key}.leadDays`]}
      >
        {#snippet children({ describedby, invalid })}
          <NumberField
            id={`prep-${prep.key}-lead`}
            bind:value={prep.leadDays}
            placeholder="0"
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </div>
  {/each}
  <div>
    <Button type="button" variant="outline" size="lg" onclick={add}>
      <PlusIcon />
      {m.prep_editor_add()}
    </Button>
  </div>
</div>
