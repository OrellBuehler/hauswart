<script lang="ts">
  import * as Select from "$lib/components/ui/select/index.js";
  import { cn } from "$lib/utils";

  type Option = { value: string; label: string };

  let {
    id,
    value = $bindable(""),
    options,
    placeholder = "",
    disabled = false,
    invalid = false,
    describedby,
    class: className,
    onchange,
  }: {
    id?: string;
    value?: string;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string | undefined;
    class?: string;
    onchange?: (value: string) => void;
  } = $props();

  const current = $derived(options.find((o) => o.value === value));
</script>

<Select.Root
  type="single"
  {disabled}
  bind:value={
    () => value,
    (next) => {
      value = next;
      onchange?.(next);
    }
  }
>
  <Select.Trigger
    {id}
    class={cn("w-full min-w-0 data-[size=default]:h-10", className)}
    aria-invalid={invalid || undefined}
    aria-describedby={describedby}
  >
    {#if current}
      <span class="truncate">{current.label}</span>
    {:else}
      <span class="text-muted-foreground">{placeholder}</span>
    {/if}
  </Select.Trigger>
  <Select.Content>
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label} class="min-h-10" />
    {/each}
  </Select.Content>
</Select.Root>
