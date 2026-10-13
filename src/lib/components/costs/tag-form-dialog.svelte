<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { COST_TAG_COLORS, type CostTagColor } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import {
    COST_TAG_NAME_MAX,
    type CostTag,
    type UpdateCostTagRequest,
  } from "$lib/api/schemas/cost-tags";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    TAG_COLOR_STYLES,
    nextTagColor,
    tagColorLabels,
    tagNameProblem,
    tagSaveMessage,
  } from "$lib/costs/tags";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";
  import TagChip from "./tag-chip.svelte";

  let {
    open = $bindable(false),
    tag,
    tags,
    onsaved,
  }: {
    open?: boolean;
    /** The tag to change; undefined makes a new one. */
    tag: CostTag | undefined;
    /** Every tag, to tell a name that is taken. */
    tags: readonly CostTag[];
    /** Runs after the tag was saved (the dialog is already closing). */
    onsaved: (saved: CostTag) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let color = $state<CostTagColor>("gray");
  let errors = $state<Record<string, string>>({});

  const editing = $derived(tag !== undefined);

  $effect(() => {
    if (!open) return;
    // A page that refreshes behind the open dialog must not reset what is typed.
    untrack(() => {
      name = tag?.name ?? "";
      color = tag?.color ?? nextTagColor(tags);
      errors = {};
    });
  });

  async function submit(): Promise<string | void> {
    errors = {};
    const trimmed = name.trim();
    const problem = tagNameProblem(trimmed, tags, tag?.id);
    if (problem) {
      errors.name = problem;
      return m.form_check_fields();
    }
    try {
      let saved: CostTag;
      if (tag) {
        const patch: UpdateCostTagRequest = {};
        if (trimmed !== tag.name) patch.name = trimmed;
        if (color !== tag.color) patch.color = color;
        if (Object.keys(patch).length === 0) return;
        saved = await api.call(endpoints.costTagsUpdate, {
          params: { id: tag.id },
          body: patch,
        });
        toast.success(m.costtag_saved_toast({ name: saved.name }));
      } else {
        saved = await api.call(endpoints.costTagsCreate, {
          body: { name: trimmed, color },
        });
        toast.success(m.costtag_created_toast({ name: saved.name }));
      }
      await onsaved(saved);
    } catch (err) {
      const taken = tagSaveMessage(err, tags, !tag);
      if (taken) {
        errors.name = taken;
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      throw err;
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.costtag_edit_title() : m.costtag_create_title()}
  description={editing
    ? m.costtag_edit_description()
    : m.costtag_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  onsubmit={submit}
  class="sm:max-w-md"
>
  <Field id="costtag-name" label={m.costtag_name()} error={errors.name}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="costtag-name"
        class="h-10"
        autocomplete="off"
        required
        maxlength={COST_TAG_NAME_MAX}
        placeholder={m.costtag_name_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={name}
      />
    {/snippet}
  </Field>

  <fieldset class="flex min-w-0 flex-col gap-2">
    <legend class="mb-1 text-sm leading-none font-medium">
      {m.costtag_color()}
    </legend>
    <div
      role="radiogroup"
      aria-label={m.costtag_color()}
      class="grid grid-cols-5 gap-2 sm:grid-cols-9"
    >
      {#each COST_TAG_COLORS as option (option)}
        {@const selected = color === option}
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={tagColorLabels[option]()}
          title={tagColorLabels[option]()}
          class={cn(
            "focus-visible:ring-ring/50 flex aspect-square min-h-10 items-center justify-center rounded-full border-2 border-transparent outline-none focus-visible:ring-[3px]",
            selected && "border-foreground",
          )}
          onclick={() => (color = option)}
        >
          <span
            class={cn(
              "flex size-7 items-center justify-center rounded-full text-white",
              TAG_COLOR_STYLES[option].dot,
            )}
          >
            {#if selected}
              <CheckIcon class="size-4" aria-hidden="true" />
            {/if}
          </span>
        </button>
      {/each}
    </div>
  </fieldset>

  <div class="flex min-w-0 flex-col gap-2" aria-hidden="true">
    <TagChip
      tag={{ name: name.trim() || m.costtag_name(), color }}
      class="w-fit"
    />
  </div>
</FormDialog>
