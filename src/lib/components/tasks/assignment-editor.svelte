<script lang="ts">
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import XIcon from "@lucide/svelte/icons/x";
  import type { AssignMode, RotationStrategy } from "$lib/api/enums";
  import { ROTATION_STRATEGIES } from "$lib/api/enums";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { m } from "$lib/paraglide/messages";
  import {
    assignModeLabels,
    rotationHints,
    rotationLabels,
  } from "$lib/tasks/labels";
  import AssigneeAvatar from "./assignee-avatar.svelte";
  import Field from "./field.svelte";
  import OptionSelect from "./option-select.svelte";
  import Segmented from "./segmented.svelte";

  let {
    mode = $bindable(),
    assigneeUserId = $bindable(),
    rotationOrder = $bindable(),
    strategy = $bindable(),
    people,
    errors,
  }: {
    mode: AssignMode;
    assigneeUserId: string;
    rotationOrder: string[];
    strategy: RotationStrategy;
    people: DirectoryUser[];
    errors: Record<string, string>;
  } = $props();

  const names = $derived(new Map(people.map((p) => [p.id, p.displayName])));
  const remaining = $derived(
    people
      .filter((p) => !rotationOrder.includes(p.id))
      .map((p) => ({ value: p.id, label: p.displayName })),
  );
  const personOptions = $derived(
    people.map((p) => ({ value: p.id, label: p.displayName })),
  );
  const modeOptions = $derived(
    (["none", "fixed", "rotate"] as const).map((value) => ({
      value,
      label: assignModeLabels[value](),
    })),
  );
  const strategyOptions = $derived(
    ROTATION_STRATEGIES.map((value) => ({
      value,
      label: rotationLabels[value](),
    })),
  );

  let adding = $state("");

  function add(id: string) {
    if (!id) return;
    rotationOrder = [...rotationOrder, id];
    adding = "";
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...rotationOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    rotationOrder = next;
  }

  function remove(index: number) {
    rotationOrder = rotationOrder.filter((_, i) => i !== index);
  }
</script>

<div class="flex flex-col gap-5">
  <Segmented
    label={m.task_assignment()}
    options={modeOptions}
    bind:value={mode}
  />

  {#if mode === "fixed"}
    <Field
      id="task-assignee"
      label={m.task_assignee()}
      error={errors.assigneeUserId}
    >
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="task-assignee"
          bind:value={assigneeUserId}
          options={personOptions}
          placeholder={m.task_assignee_placeholder()}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  {:else if mode === "rotate"}
    <div class="flex flex-col gap-3">
      <span class="text-sm font-medium" id="rotation-label"
        >{m.task_rotation_members()}</span
      >
      <p class="text-muted-foreground -mt-2 text-xs text-pretty">
        {m.task_rotation_hint()}
      </p>
      {#if rotationOrder.length > 0}
        <ol class="flex flex-col gap-2" aria-labelledby="rotation-label">
          {#each rotationOrder as id, index (id)}
            {@const name = names.get(id) ?? "?"}
            <li
              class="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-1.5"
            >
              <span class="text-muted-foreground w-5 text-xs tabular-nums"
                >{index + 1}.</span
              >
              <AssigneeAvatar {name} {id} />
              <span class="min-w-0 flex-1 truncate text-sm">{name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                class="max-sm:hidden"
                disabled={index === 0}
                aria-label={m.task_rotation_up({ name })}
                onclick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                class="max-sm:hidden"
                disabled={index === rotationOrder.length - 1}
                aria-label={m.task_rotation_down({ name })}
                onclick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                class="max-sm:hidden"
                aria-label={m.task_rotation_remove({ name })}
                onclick={() => remove(index)}
              >
                <XIcon />
              </Button>
              <div class="sm:hidden">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        aria-label={m.task_rotation_actions({ name })}
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      class="min-h-10"
                      disabled={index === 0}
                      onSelect={() => move(index, -1)}
                    >
                      <ArrowUpIcon />{m.task_rotation_up({ name })}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      class="min-h-10"
                      disabled={index === rotationOrder.length - 1}
                      onSelect={() => move(index, 1)}
                    >
                      <ArrowDownIcon />{m.task_rotation_down({ name })}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      class="min-h-10"
                      variant="destructive"
                      onSelect={() => remove(index)}
                    >
                      <XIcon />{m.task_rotation_remove({ name })}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
      {#if remaining.length > 0}
        <OptionSelect
          id="rotation-add"
          bind:value={adding}
          options={remaining}
          placeholder={m.task_rotation_add()}
          onchange={add}
        />
      {/if}
      {#if errors.rotationOrder}
        <p class="text-destructive text-xs">{errors.rotationOrder}</p>
      {/if}
    </div>
    <Field
      id="task-strategy"
      label={m.task_rotation_strategy()}
      hint={rotationHints[strategy]()}
      error={errors.rotationStrategy}
    >
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="task-strategy"
          bind:value={strategy}
          options={strategyOptions}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  {/if}
</div>
