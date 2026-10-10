<script lang="ts" generics="T extends string">
  import * as Select from "$lib/components/ui/select/index.js";
  import { cn } from "$lib/utils";

  const NONE = "__none";

  let {
    options,
    value = $bindable(null),
    noneLabel,
    id,
    class: className,
    disabled = false,
  }: {
    options: { value: T; label: string }[];
    value?: T | null;
    /** When set, adds an option with this label that selects null. */
    noneLabel?: string;
    id?: string;
    class?: string;
    disabled?: boolean;
  } = $props();

  const label = $derived(
    options.find((option) => option.value === value)?.label ?? noneLabel ?? "",
  );
</script>

<Select.Root
  type="single"
  {disabled}
  bind:value={
    () => value ?? NONE, (next) => (value = next === NONE ? null : (next as T))
  }
>
  <Select.Trigger {id} class={cn("w-full min-w-0", className)}>
    <span class="truncate">{label}</span>
  </Select.Trigger>
  <Select.Content>
    {#if noneLabel}
      <Select.Item value={NONE} label={noneLabel} class="min-h-10" />
    {/if}
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label} class="min-h-10" />
    {/each}
  </Select.Content>
</Select.Root>
